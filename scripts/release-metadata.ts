import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export const PUBLISHABLE_PACKAGES = [
  "types",
  "crypto",
  "graph",
  "core",
  "http",
  "internal-utils",
  "config",
  "service",
  "cli"
] as const;

export const PRIVATE_PACKAGES = ["testing"] as const;

export type PublishablePackage = (typeof PUBLISHABLE_PACKAGES)[number];
export type PrivatePackage = (typeof PRIVATE_PACKAGES)[number];

type ManifestWithVersion = {
  version?: unknown;
};

export function readReleaseVersion(root = repoRoot): string {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as ManifestWithVersion;
  if (typeof manifest.version !== "string" || manifest.version.trim().length === 0) {
    throw new Error("Root package.json must declare a non-empty release version.");
  }
  return manifest.version;
}
