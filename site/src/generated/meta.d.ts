// Typed shape for the generated meta.json (stub now; T10 generates it).
// Ambient wildcard module so we don't need to touch the shared tsconfig
// (resolveJsonModule) while a sibling task owns config files.
declare module "*/generated/meta.json" {
  const meta: { version: string }
  export default meta
}
