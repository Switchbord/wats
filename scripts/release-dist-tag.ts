import { readReleaseVersion } from "./release-metadata.js";

/** Prereleases must never move npm's stable latest tag. */
export function releaseDistTag(version: string): string {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/.exec(version);
  if (!match) throw new Error("Invalid release version");
  if (!match[4]) return "latest";
  const channel = match[4].split(".")[0];
  if (channel !== "alpha" && channel !== "beta" && channel !== "rc") {
    throw new Error("Unsupported prerelease channel; use alpha, beta, or rc");
  }
  return channel;
}

if (import.meta.main) {
  console.log(`RELEASE_DIST_TAG=${releaseDistTag(readReleaseVersion())}`);
}
