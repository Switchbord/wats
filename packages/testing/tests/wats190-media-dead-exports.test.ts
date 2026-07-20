// WATS-190 — dead media exports removed from the @wats/graph public surface.
//
// MediaNotImplementedError and the MEDIA_LINEAR_ISSUE_* constants were
// dead weight (no runtime path threw MediaNotImplementedError; the
// constants only held Linear ticket ids). This consumer-fixture asserts
// they are gone from both @wats/graph and the @wats/graph/endpoints/media
// subpath, and pins a regression guard that the live media exports
// (uploadMedia, MediaValidationError, DEFAULT_MAX_MEDIA_UPLOAD_BYTES)
// remain present. The MediaNotImplementedCode type is erased at runtime;
// its removal is enforced by `bun run typecheck:full` (no consumer
// references it).

import { describe, expect, test } from "bun:test";
import * as graph from "@wats/graph";
import * as media from "@wats/graph/endpoints/media";

const REMOVED_RUNTIME_EXPORTS = [
  "MediaNotImplementedError",
  "MEDIA_LINEAR_ISSUE_UPLOAD",
  "MEDIA_LINEAR_ISSUE_DOWNLOAD",
  "MEDIA_LINEAR_ISSUE_DELETE",
  "MEDIA_LINEAR_ISSUE_DECRYPT"
] as const;

describe("WATS-190 dead media exports removed from @wats/graph", () => {
  for (const name of REMOVED_RUNTIME_EXPORTS) {
    test(`@wats/graph does not export ${name}`, () => {
      expect(name in graph, `${name} must not be re-exported by the barrel`).toBe(false);
      expect((graph as Record<string, unknown>)[name]).toBeUndefined();
    });

    test(`@wats/graph/endpoints/media does not export ${name}`, () => {
      expect(name in media, `${name} must not be exported by the media module`).toBe(false);
      expect((media as Record<string, unknown>)[name]).toBeUndefined();
    });
  }

  test("live media runtime exports are still present (regression guard)", () => {
    expect("uploadMedia" in graph).toBe(true);
    expect("downloadMedia" in graph).toBe(true);
    expect("deleteMedia" in graph).toBe(true);
    expect("downloadMediaBytes" in graph).toBe(true);
    expect("MediaValidationError" in graph).toBe(true);
    expect("MediaCryptoError" in graph).toBe(true);
    expect("MediaIntegrityError" in graph).toBe(true);
    expect("DEFAULT_MAX_MEDIA_UPLOAD_BYTES" in graph).toBe(true);
    expect("DEFAULT_MAX_MEDIA_DOWNLOAD_BYTES" in graph).toBe(true);
    expect(typeof graph.uploadMedia).toBe("function");
    expect(typeof graph.MediaValidationError).toBe("function");
    expect(typeof graph.DEFAULT_MAX_MEDIA_UPLOAD_BYTES).toBe("number");
  });

  test("live media exports are present on the @wats/graph/endpoints/media subpath", () => {
    expect("uploadMedia" in media).toBe(true);
    expect("MediaValidationError" in media).toBe(true);
    expect("DEFAULT_MAX_MEDIA_UPLOAD_BYTES" in media).toBe(true);
  });
});
