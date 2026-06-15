// F-13 RED — asserts site/content/docs/reference/pagination.mdx + site/content/docs/reference/media.mdx
// content, parity matrix update, CHANGELOG entry, and the graph-consumer
// fixture coverage of the F-13 surfaces. These checks fail until the
// GREEN doc/parity commit ships the reference docs, the parity rows
// for WATS-25 (pagination) + WATS-24 (media sketch), the
// [0.2.0-f13] entry, and the extended fixture assertions.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonFile(filePath: string): JsonRecord {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!isJsonRecord(parsed)) {
    throw new Error(`Expected JSON object at ${filePath}`);
  }
  return parsed;
}

function includesWorkspacePackagesGlob(workspaces: unknown): boolean {
  if (Array.isArray(workspaces)) {
    return workspaces.includes("packages/*");
  }
  if (isJsonRecord(workspaces) && Array.isArray(workspaces.packages)) {
    return workspaces.packages.includes("packages/*");
  }
  return false;
}

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);
  while (true) {
    const manifestPath = join(currentDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = parseJsonFile(manifestPath);
      if (includesWorkspacePackagesGlob(manifest.workspaces)) {
        return currentDir;
      }
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Could not locate workspace root from ${startDir}`);
    }
    currentDir = parentDir;
  }
}

function runBun(args: string[], cwd: string): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const completed = Bun.spawnSync(["bun", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe"
  });
  return {
    exitCode: completed.exitCode ?? -1,
    stdout: new TextDecoder().decode(completed.stdout),
    stderr: new TextDecoder().decode(completed.stderr)
  };
}

// ---------------------------------------------------------------------
// site/content/docs/reference/pagination.mdx
// ---------------------------------------------------------------------

describe("F-13 pagination.md reference guide", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const docPath = join(repoRoot, "site/content/docs/reference/pagination.mdx");

  test("file exists", () => {
    expect(existsSync(docPath)).toBe(true);
  });

  test("contains a Pagination section + primitive API surface", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toMatch(/##\s+Pagination|#\s+Pagination/i);
    expect(doc).toContain("paginate");
    expect(doc).toContain("paginateAll");
    expect(doc).toContain("PaginationError");
  });

  test("documents the PaginationOptions surface", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("maxPages");
    expect(doc).toContain("pageSize");
    expect(doc).toContain("AbortSignal");
    expect(doc).toMatch(/default\s*(?:=|is|:)?\s*1000|1[_,]?000/);
  });

  test("documents error taxonomy codes", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("invalid_endpoint");
    expect(doc).toContain("invalid_max_pages");
    expect(doc).toContain("invalid_page_size");
    expect(doc).toContain("invalid_signal");
    expect(doc).toContain("aborted");
    expect(doc).toContain("page_fetch_failed");
  });

  test("documents PaginatedResult summary fields", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("pagesConsumed");
    expect(doc).toContain("pageLimitReached");
    expect(doc).toMatch(/items/);
  });

  test("documents cursor-extraction semantics from paging.next", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("paging.next");
    expect(doc).toContain("after");
  });

  test("documents streaming-iteration (no in-memory accumulation)", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toMatch(/stream|one at a time|no accumulation|never accumulates/i);
  });

  test("contains a usage code sample importing from @wats/graph", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toMatch(/```[ \t]*(ts|typescript)/i);
    expect(doc).toContain("@wats/graph");
    expect(doc).toMatch(/for\s+await/);
  });

  test("documents the cursor-paginated Graph list provenance", () => {
    // Voice pass deliberately removed WATS-nn ticket refs and F-nn/Arch-K phase
    // labels (pure provenance), preserving the feature docs. Guard the surviving
    // pagination substance that the provenance line used to anchor.
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toMatch(/cursor/i);
    expect(doc).toContain("paginate");
    expect(doc).toContain("Graph");
  });

  test("documents scope ledger (non-goals)", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toMatch(/persist|cross[- ]process|resumable|not (a )?cache/i);
  });
});

// ---------------------------------------------------------------------
// site/content/docs/reference/media.mdx
// ---------------------------------------------------------------------

describe("F-13 media.md reference guide", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const docPath = join(repoRoot, "site/content/docs/reference/media.mdx");

  test("file exists", () => {
    expect(existsSync(docPath)).toBe(true);
  });

  test("is marked experimental and documents the full media runtime", () => {
    // Voice pass dropped the "runtime-complete" status word and WATS-37 ticket
    // ref. The fact survives: experimental DocMeta status + a credential-free
    // runtime covering upload/download/delete/decrypt/sessions.
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toMatch(/experimental/i);
    expect(doc).toMatch(/credential-free media runtime|media runtime/i);
  });

  test("documents the four typed primitives", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("uploadMedia");
    expect(doc).toContain("downloadMedia");
    expect(doc).toContain("deleteMedia");
    expect(doc).toContain("decryptEncryptedMedia");
  });

  test("documents media validation, crypto, integrity, and download/session taxonomy", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("MediaValidationError");
    expect(doc).toContain("MediaCryptoError");
    expect(doc).toContain("MediaIntegrityError");
    expect(doc).toContain("upload_too_large");
    expect(doc).toContain("download_too_large");
    expect(doc).toMatch(/decryptEncryptedMedia/);
  });

  test("documents decrypt, binary download, and resumable session runtime", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toMatch(/decryptEncryptedMedia/);
    expect(doc).toMatch(/downloadMediaBytes/);
    expect(doc).toMatch(/createUploadSession/);
    expect(doc).toMatch(/uploadFileToSession/);
    expect(doc).toMatch(/getUploadSession/);
  });

  test("documents the not-yet-implemented live-credentialed surface", () => {
    // Voice pass removed the WATS-37 Linear tracking ref. The intent — that the
    // doc flags what remains unproven — survives in the status-taxonomy note.
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toMatch(/Not implemented yet|live credential/i);
  });

  test("documents the encrypted-media decrypt history surface", () => {
    // Voice pass removed WATS-24/Arch-J provenance + WATS-37 ref. The guarded
    // fact (encrypted media decrypt path is documented) survives as the API.
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("decryptEncryptedMedia");
    expect(doc).toMatch(/encrypted/i);
  });

  test("contains a usage code sample showing the runtime path", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toMatch(/```[ \t]*(ts|typescript)/i);
    expect(doc).toContain("@wats/graph");
    expect(doc).toMatch(/uploadMedia|downloadMedia/);
    expect(doc).toContain("DEFAULT_MAX_MEDIA_UPLOAD_BYTES");
  });

  test("documents body matrix, defaults, and remaining non-goals", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("Blob");
    expect(doc).toContain("ArrayBuffer");
    expect(doc).toContain("Uint8Array");
    expect(doc).toContain("DataView");
    expect(doc).toContain("16 MiB");
    expect(doc).toMatch(/resumable|downloadMediaBytes|encrypted/i);
  });
});

// ---------------------------------------------------------------------
// graph-consumer fixture extension
// ---------------------------------------------------------------------

describe("F-13 graph-consumer fixture coverage", () => {
  test("fixture imports paginate + media primitives from @wats/graph", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const verifyPath = join(
      repoRoot,
      "packages/testing/fixtures/graph-consumer/verify-imports.ts"
    );
    const source = readFileSync(verifyPath, "utf8");
    expect(source).toContain("paginate");
    expect(source).toContain("paginateAll");
    expect(source).toContain("PaginationError");
    expect(source).toContain("uploadMedia");
    expect(source).toContain("downloadMedia");
    expect(source).toContain("deleteMedia");
    expect(source).toContain("decryptEncryptedMedia");
    expect(source).toContain("MediaCryptoError");
    expect(source).toContain("MediaIntegrityError");
    expect(source).toContain("MediaValidationError");
    expect(source).toContain("downloadMediaBytes");
    expect(source).toContain("createUploadSession");
    expect(source).toContain("uploadFileToSession");
    expect(source).toContain("getUploadSession");
    expect(source).toContain("DEFAULT_MAX_MEDIA_UPLOAD_BYTES");
  });

  test("running the fixture emits graph-consumer:ok and runs F-13 assertions", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const fixtureDir = join(
      repoRoot,
      "packages/testing/fixtures/graph-consumer"
    );
    const result = runBun(["run", "verify-imports"], fixtureDir);
    expect(
      result.exitCode,
      `fixture verify-imports failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    ).toBe(0);
    const lines = result.stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const lastLine = lines.at(-1);
    expect(lastLine).toBe("graph-consumer:ok");

    const jsonLine = lines.at(-2);
    expect(typeof jsonLine).toBe("string");
    const parsed = JSON.parse(jsonLine as string) as {
      ok: boolean;
      sentinel: string;
      checks: Record<string, boolean>;
    };
    expect(parsed.ok).toBe(true);

    const labels = Object.keys(parsed.checks);
    expect(labels).toContain("paginate iterates 3 pages with cursors in order");
    expect(labels).toContain(
      "paginate extracts cursor from paging.next across requests"
    );
    expect(labels).toContain(
      "paginateAll respects maxPages cap with pageLimitReached=true"
    );
    expect(labels).toContain(
      "paginate(maxPages:0) rejects with PaginationError(invalid_max_pages)"
    );
    expect(labels).toContain("uploadMedia returns Graph media id on happy path");
    expect(labels).toContain("uploadMedia POSTs multipart to /{phoneNumberId}/media");
    expect(labels).toContain("downloadMedia resolves metadata via GET /{mediaId}");
    expect(labels).toContain("deleteMedia DELETEs /{mediaId} and returns success");
    expect(labels).toContain("downloadMediaBytes fetches binary media and validates sha256");
    expect(labels).toContain("decryptEncryptedMedia rejects malformed bundle with MediaCryptoError");
    expect(labels).toContain("resumable upload session helpers run through @wats/graph");
    for (const [label, ok] of Object.entries(parsed.checks)) {
      expect(ok, `fixture check "${label}" must report true`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------
// CHANGELOG
// ---------------------------------------------------------------------

describe("F-13 CHANGELOG", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const changelogPath = join(repoRoot, "CHANGELOG.md");

  test("contains a [0.2.0-f13] section header", () => {
    const changelog = readFileSync(changelogPath, "utf8");
    expect(changelog).toMatch(/\[0\.2\.0-f13\]/);
  });

  test("mentions paginate + PaginationError + maxPages", () => {
    const changelog = readFileSync(changelogPath, "utf8");
    expect(changelog).toContain("paginate");
    expect(changelog).toContain("PaginationError");
    expect(changelog).toContain("maxPages");
  });

  test("mentions WATS-37 complete media runtime", () => {
    const changelog = readFileSync(changelogPath, "utf8");
    expect(changelog).toContain("MediaValidationError");
    expect(changelog).toContain("MediaCryptoError");
    expect(changelog).toContain("MediaIntegrityError");
    expect(changelog).toMatch(/WATS-37/);
    expect(changelog).toMatch(/uploadMedia|downloadMediaBytes|decryptEncryptedMedia|createUploadSession/);
  });
});

// ---------------------------------------------------------------------
// parity matrix
// ---------------------------------------------------------------------

describe("F-13 parity matrix", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const matrixPath = join(repoRoot, "site/content/docs/parity.mdx");

  test("pagination row documents the paginate primitives with a status tag", () => {
    // Voice pass removed F-13/WATS-25 phase+ticket labels from the matrix rows.
    // The pagination row's substance (paginate/paginateAll + status taxonomy)
    // survives.
    const matrix = readFileSync(matrixPath, "utf8");
    expect(matrix).toMatch(/[Pp]agination/);
    expect(matrix).toMatch(/paginate/);
    expect(matrix).toMatch(/shape-only|live-validated|planned/);
  });

  test("media row documents the media runtime with a status tag", () => {
    // Voice pass removed WATS-37 ref + "runtime-complete"/"credential-gated"
    // phrasing. The media-runtime row and its live/shape status tag survive.
    const matrix = readFileSync(matrixPath, "utf8");
    expect(matrix).toMatch(/[Mm]edia runtime/);
    expect(matrix).toMatch(/uploadMedia|downloadMedia/);
    expect(matrix).toMatch(/live-validated|shape-only/);
  });
});
