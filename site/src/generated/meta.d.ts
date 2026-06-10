// Typed shape for the generated meta.json (written by scripts/gen-meta.ts, T10).
// Ambient wildcard module so we don't need resolveJsonModule in the shared
// tsconfig while a sibling task owns config files.
declare module "*/generated/meta.json" {
  const meta: {
    version: string
    testCount: number
    testCountRounded: number
    generatedAt: string
    source: { cmd: string; commit: string }
  }
  export default meta
}
