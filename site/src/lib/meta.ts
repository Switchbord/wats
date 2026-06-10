// Single import point for generated site metrics (T10).
// TrustStrip (T07) and the SiteNav version badge read from here so the
// generated-numbers contract lives in one place.
import meta from "../generated/meta.json"

/** Published @wats/* version (packages/graph/package.json at generation time). */
export const version: string = meta.version

/** Real `bun test` pass count floored to the nearest 100, for "N+ tests" copy. */
export const testCountRounded: number = meta.testCountRounded
