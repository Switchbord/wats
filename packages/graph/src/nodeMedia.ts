// WATS-159: Node/Bun-only filesystem-path media upload-and-send helpers.
//
// This module is the ONLY place in `@wats/graph` that touches `node:fs`. It is
// exposed through the explicit `@wats/graph/node-media` subpath so the root
// `@wats/graph` entrypoint stays runtime-neutral and browser-safe: a consumer
// that never imports `@wats/graph/node-media` will never pull `node:fs` into
// their bundle or type graph.
//
// `node:fs/promises` and `node:path` are loaded via DYNAMIC imports with
// variable specifiers (matching the `@wats/crypto` Node-adapter precedent).
// This keeps the module's static import graph free of `node:*` specifiers so
// the publishable `types: []` release typecheck never needs `@types/node`,
// and bundlers for edge runtimes cannot accidentally pull `node:fs` from the
// root entry.
//
// Each helper accepts a `PhoneNumberClient` (WATS-19) plus a filesystem path,
// reads + validates the file locally, then delegates to the WATS-152
// in-memory `uploadAndSend*` methods, which perform exactly two Graph
// requests in order:
//   1. POST /{phoneNumberId}/media   (multipart/form-data upload)
//   2. POST /{phoneNumberId}/messages (send by returned media id)
//
// All rejections are typed as `MediaValidationError` and surface BEFORE any
// transport request. Full filesystem paths are NEVER echoed in error
// messages — only the lowercase extension (when relevant) and generic labels
// appear, so logs/metrics cannot leak host paths.

import type { EndpointInvokeOptions } from "./endpoint.js";
import type { GraphMessagesSendResponse } from "./endpoints/messages.js";
import {
  DEFAULT_MAX_MEDIA_UPLOAD_BYTES,
  MediaValidationError
} from "./endpoints/media.js";
import type { PhoneNumberClient } from "./subclients/phoneNumberClient.js";

/**
 * Base input for every path-based upload-and-send helper. `path` is a
 * filesystem path resolved by `node:fs`; `mimeType` optionally overrides the
 * extension-derived MIME (the extension must still be in the helper's
 * allowlist). `maxBytes` optionally tightens the upload-size cap.
 */
export interface NodeMediaFromPathBaseInput {
  readonly to: string;
  readonly path: string;
  readonly mimeType?: string;
  readonly replyToMessageId?: string;
  readonly maxBytes?: number;
}

export interface NodeImageFromPathInput extends NodeMediaFromPathBaseInput {
  readonly caption?: string;
}

export interface NodeVideoFromPathInput extends NodeMediaFromPathBaseInput {
  readonly caption?: string;
}

export interface NodeAudioFromPathInput extends NodeMediaFromPathBaseInput {
  /** Graph v24+ voice-message designation for audio sends. */
  readonly voice?: boolean;
}

export interface NodeDocumentFromPathInput extends NodeMediaFromPathBaseInput {
  readonly caption?: string;
  readonly filename?: string;
}

export type NodeStickerFromPathInput = NodeMediaFromPathBaseInput;

// Structural interfaces for the Node `fs/promises` + `path` surface this
// module consumes. Declared locally (not imported from `@types/node`) so the
// release typecheck (`types: []`) stays clean.
interface NodeStatInfo {
  isDirectory(): boolean;
  isFile(): boolean;
  readonly size: number;
}

interface NodeFsPromisesModule {
  readFile(path: string): Promise<Uint8Array>;
  stat(path: string): Promise<NodeStatInfo>;
}

interface NodePathModule {
  extname(path: string): string;
}

const IMAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"]
]);

const VIDEO_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["mp4", "video/mp4"]
]);

const AUDIO_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["mp3", "audio/mpeg"],
  ["ogg", "audio/ogg"],
  ["m4a", "audio/mp4"]
]);

const DOCUMENT_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["pdf", "application/pdf"]
]);

const STICKER_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["webp", "image/webp"]
]);

// Memoized loaders for the Node built-in modules. The specifiers are held in
// variables so TypeScript does not attempt to resolve them against
// `@types/node` (not installed under the release typecheck) and so bundlers
// cannot statically rewrite them.
const FS_PROMISES_SPECIFIER = "node:fs/promises";
const PATH_SPECIFIER = "node:path";

let fsPromisesLoader: Promise<NodeFsPromisesModule> | undefined;
let pathModuleLoader: Promise<NodePathModule> | undefined;

function loadFsPromises(): Promise<NodeFsPromisesModule> {
  if (fsPromisesLoader === undefined) {
    fsPromisesLoader = import(
      /* @vite-ignore */ FS_PROMISES_SPECIFIER
    ).then((mod: unknown) => mod as NodeFsPromisesModule);
  }
  return fsPromisesLoader;
}

function loadPathModule(): Promise<NodePathModule> {
  if (pathModuleLoader === undefined) {
    pathModuleLoader = import(
      /* @vite-ignore */ PATH_SPECIFIER
    ).then((mod: unknown) => mod as NodePathModule);
  }
  return pathModuleLoader;
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function assertPhoneNumberClient(
  client: unknown,
  method: string
): asserts client is PhoneNumberClient {
  if (client === null || typeof client !== "object") {
    throw new MediaValidationError(
      "invalid_client",
      "Invalid client: expected a PhoneNumberClient instance."
    );
  }
  const fn = (client as Record<string, unknown>)[method];
  if (typeof fn !== "function") {
    throw new MediaValidationError(
      "invalid_client",
      `Invalid client: expected a PhoneNumberClient with ${method}().`
    );
  }
}

function assertRecipient(input: NodeMediaFromPathBaseInput): void {
  if (
    typeof input.to !== "string" ||
    input.to.length === 0 ||
    input.to.trim().length === 0
  ) {
    throw new MediaValidationError(
      "invalid_params",
      "Invalid recipient: expected a non-empty string."
    );
  }
}

function resolveMaxBytes(
  input: NodeMediaFromPathBaseInput,
  defaultMaxBytes: number
): number {
  const candidate = input.maxBytes;
  if (candidate === undefined) return defaultMaxBytes;
  if (
    typeof candidate !== "number" ||
    !Number.isFinite(candidate) ||
    !Number.isInteger(candidate) ||
    candidate <= 0
  ) {
    throw new MediaValidationError(
      "invalid_params",
      "Invalid maxBytes: expected a positive integer."
    );
  }
  return candidate;
}

interface ResolvedMediaFile {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

/**
 * Validate the path string, stat the file (rejecting directories and
 * non-regular files), enforce the size cap, read the bytes, and infer the
 * MIME from the extension (honouring an explicit override). Every failure
 * throws a `MediaValidationError` and none of them reach the network.
 */
async function resolveMediaFile(
  input: NodeMediaFromPathBaseInput,
  allowedExtensions: ReadonlyMap<string, string>,
  defaultMaxBytes: number,
  label: string
): Promise<ResolvedMediaFile> {
  if (
    typeof input.path !== "string" ||
    input.path.length === 0 ||
    input.path.trim().length === 0
  ) {
    throw new MediaValidationError(
      "invalid_params",
      "Invalid media path: expected a non-empty string."
    );
  }
  if (hasControlChar(input.path)) {
    // Includes NUL (0x00) and any other C0/DEL byte — these have no place
    // in a filesystem path supplied to a media helper and are rejected
    // outright to defeat path-injection and log-injection tricks.
    throw new MediaValidationError(
      "invalid_file",
      "Invalid media path: control characters (including NUL) are not allowed."
    );
  }

  // Reject parent-directory (`..`) segments anywhere in the path. Absolute
  // paths and relative paths without `..` are accepted; traversal-ish input
  // is refused before any filesystem access.
  const segments = input.path.split(/[\\/]/u);
  if (segments.some((segment) => segment === "..")) {
    throw new MediaValidationError(
      "invalid_file",
      "Invalid media path: parent-directory segments are not allowed."
    );
  }

  const pathModule = await loadPathModule();
  const ext = pathModule.extname(input.path).toLowerCase().replace(/^\./u, "");
  const inferred = allowedExtensions.get(ext);
  if (inferred === undefined) {
    throw new MediaValidationError(
      "unsupported_media_type",
      `Unsupported media extension: ${
        ext.length === 0 ? "<none>" : ext
      } is not allowed for ${label} sends.`
    );
  }

  const mimeType =
    typeof input.mimeType === "string" && input.mimeType.trim().length > 0
      ? input.mimeType.trim()
      : inferred;

  const maxBytes = resolveMaxBytes(input, defaultMaxBytes);

  const fsPromises = await loadFsPromises();
  let info: NodeStatInfo;
  try {
    info = await fsPromises.stat(input.path);
  } catch {
    // Intentionally swallow the fs cause: Node ENOENT messages echo the
    // full path, which we must never surface.
    throw new MediaValidationError(
      "invalid_file",
      "Media file could not be accessed."
    );
  }
  if (info.isDirectory()) {
    throw new MediaValidationError(
      "invalid_file",
      "Invalid media path: expected a regular file, not a directory."
    );
  }
  if (!info.isFile()) {
    throw new MediaValidationError(
      "invalid_file",
      "Invalid media path: expected a regular file."
    );
  }
  if (info.size > maxBytes) {
    throw new MediaValidationError(
      "upload_too_large",
      "Media file exceeds the maximum upload size."
    );
  }

  let raw: Uint8Array;
  try {
    raw = await fsPromises.readFile(input.path);
  } catch {
    throw new MediaValidationError(
      "invalid_file",
      "Media file could not be read."
    );
  }
  // TOCTOU guard: re-check the actual byte length after the read.
  if (raw.byteLength > maxBytes) {
    throw new MediaValidationError(
      "upload_too_large",
      "Media file exceeds the maximum upload size."
    );
  }

  // Copy into a plain Uint8Array so the downstream multipart builder never
  // aliases a Node Buffer's potentially-shared backing ArrayBuffer.
  const bytes = new Uint8Array(raw);
  return { bytes, mimeType };
}

/**
 * Upload an image file from the local filesystem and send it. Performs
 * exactly two Graph requests (media upload, then message send). Supported
 * extensions: `.jpg`, `.jpeg`, `.png`, `.webp`.
 */
export async function uploadAndSendImageFromPath(
  client: PhoneNumberClient,
  input: NodeImageFromPathInput,
  opts?: EndpointInvokeOptions
): Promise<GraphMessagesSendResponse> {
  assertPhoneNumberClient(client, "uploadAndSendImage");
  assertRecipient(input);
  const { bytes, mimeType } = await resolveMediaFile(
    input,
    IMAGE_EXTENSIONS,
    DEFAULT_MAX_MEDIA_UPLOAD_BYTES,
    "image"
  );
  return client.uploadAndSendImage(
    {
      to: input.to,
      file: bytes,
      mimeType,
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.replyToMessageId !== undefined
        ? { replyToMessageId: input.replyToMessageId }
        : {})
    },
    opts
  );
}

/**
 * Upload a video file from the local filesystem and send it. Performs
 * exactly two Graph requests. Supported extension: `.mp4`.
 */
export async function uploadAndSendVideoFromPath(
  client: PhoneNumberClient,
  input: NodeVideoFromPathInput,
  opts?: EndpointInvokeOptions
): Promise<GraphMessagesSendResponse> {
  assertPhoneNumberClient(client, "uploadAndSendVideo");
  assertRecipient(input);
  const { bytes, mimeType } = await resolveMediaFile(
    input,
    VIDEO_EXTENSIONS,
    DEFAULT_MAX_MEDIA_UPLOAD_BYTES,
    "video"
  );
  return client.uploadAndSendVideo(
    {
      to: input.to,
      file: bytes,
      mimeType,
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.replyToMessageId !== undefined
        ? { replyToMessageId: input.replyToMessageId }
        : {})
    },
    opts
  );
}

/**
 * Upload an audio file from the local filesystem and send it. Performs
 * exactly two Graph requests. Supported extensions: `.mp3`, `.ogg`, `.m4a`.
 */
export async function uploadAndSendAudioFromPath(
  client: PhoneNumberClient,
  input: NodeAudioFromPathInput,
  opts?: EndpointInvokeOptions
): Promise<GraphMessagesSendResponse> {
  assertPhoneNumberClient(client, "uploadAndSendAudio");
  assertRecipient(input);
  const { bytes, mimeType } = await resolveMediaFile(
    input,
    AUDIO_EXTENSIONS,
    DEFAULT_MAX_MEDIA_UPLOAD_BYTES,
    "audio"
  );
  return client.uploadAndSendAudio(
    {
      to: input.to,
      file: bytes,
      mimeType,
      ...(input.voice !== undefined ? { voice: input.voice } : {}),
      ...(input.replyToMessageId !== undefined
        ? { replyToMessageId: input.replyToMessageId }
        : {})
    },
    opts
  );
}

/**
 * Upload a document file from the local filesystem and send it. Performs
 * exactly two Graph requests. Supported extension: `.pdf`.
 */
export async function uploadAndSendDocumentFromPath(
  client: PhoneNumberClient,
  input: NodeDocumentFromPathInput,
  opts?: EndpointInvokeOptions
): Promise<GraphMessagesSendResponse> {
  assertPhoneNumberClient(client, "uploadAndSendDocument");
  assertRecipient(input);
  const { bytes, mimeType } = await resolveMediaFile(
    input,
    DOCUMENT_EXTENSIONS,
    DEFAULT_MAX_MEDIA_UPLOAD_BYTES,
    "document"
  );
  return client.uploadAndSendDocument(
    {
      to: input.to,
      file: bytes,
      mimeType,
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.filename !== undefined ? { filename: input.filename } : {}),
      ...(input.replyToMessageId !== undefined
        ? { replyToMessageId: input.replyToMessageId }
        : {})
    },
    opts
  );
}

/**
 * Upload a sticker file from the local filesystem and send it. Performs
 * exactly two Graph requests. Supported extension: `.webp`.
 */
export async function uploadAndSendStickerFromPath(
  client: PhoneNumberClient,
  input: NodeStickerFromPathInput,
  opts?: EndpointInvokeOptions
): Promise<GraphMessagesSendResponse> {
  assertPhoneNumberClient(client, "uploadAndSendSticker");
  assertRecipient(input);
  const { bytes, mimeType } = await resolveMediaFile(
    input,
    STICKER_EXTENSIONS,
    DEFAULT_MAX_MEDIA_UPLOAD_BYTES,
    "sticker"
  );
  return client.uploadAndSendSticker(
    {
      to: input.to,
      file: bytes,
      mimeType,
      ...(input.replyToMessageId !== undefined
        ? { replyToMessageId: input.replyToMessageId }
        : {})
    },
    opts
  );
}
