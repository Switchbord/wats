import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const PUBLISHABLE_PACKAGES = [
  "types",
  "crypto",
  "graph",
  "core",
  "http",
  "internal-utils",
  "config",
  "persistence",
  "service",
  "cli"
] as const;

type PackageName = (typeof PUBLISHABLE_PACKAGES)[number];

function collectTypeScriptSources(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptSources(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

const packageEntrypoints: Record<PackageName, readonly string[]> = {
  types: ["index", "config", "webhook", "entities", "messages/index", "statuses", "contacts", "errors"],
  crypto: ["index", "provider", "errors", "adapters/node/index", "adapters/webcrypto/index"],
  graph: [
    "index",
    "client",
    "errors",
    "endpoints/messages",
    "endpoints/media",
    "endpoints/templates",
    "endpoints/flows",
    "endpoints/calling",
    "endpoints/businessManagement",
    "transport",
    "createMockTransport"
  ],
  core: [
    "index",
    "updateParser",
    "router",
    "filters/index",
    "filtersTyped/index",
    "webhookNormalizer",
    "typedRouter",
    "whatsappFacade",
    "listener"
  ],
  http: [
    "index",
    "webhookServer",
    "signature",
    "adapters/webhookAdapter",
    "adapters/fetchAdapter",
    "adapters/bunAdapter",
    "adapters/nodeAdapter"
  ],
  "internal-utils": ["index", "isRecord"],
  config: ["index"],
  persistence: ["index", "sqlite"],
  service: ["index"],
  cli: ["index", "bin"]
};

function run(command: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR ?? join(repoRoot, ".bun-cache") }
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function buildPackage(pkg: PackageName): void {
  const packageDir = join(repoRoot, "packages", pkg);
  const distDir = join(packageDir, "dist");
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  // Build every source file without bundling so package-internal relative imports remain transparent.
  for (const source of collectTypeScriptSources(join(packageDir, "src"))) {
    const relativeSource = relative(join(packageDir, "src"), source).replace(/\.ts$/u, "");
    const outFile = join(distDir, `${relativeSource}.js`);
    mkdirSync(dirname(outFile), { recursive: true });
    run("bun", ["build", source, "--target", "bun", "--format", "esm", "--no-bundle", "--outfile", outFile], repoRoot);
    const sourceText = readFileSync(source, "utf8");
    if (sourceText.startsWith("#!")) {
      const shebang = sourceText.slice(0, sourceText.indexOf("\n"));
      const builtText = readFileSync(outFile, "utf8");
      if (!builtText.startsWith("#!")) {
        writeFileSync(outFile, `${shebang}\n${builtText}`);
      }
    }
  }

  const tempDir = mkdtempSync(join(repoRoot, ".tmp-wats83-tsconfig-"));
  const tempConfigPath = join(tempDir, `${pkg}.json`);
  const srcDir = join(packageDir, "src");
  const tempConfig = {
    compilerOptions: {
      declaration: true,
      emitDeclarationOnly: true,
      module: "ESNext",
      target: "ES2022",
      moduleResolution: "Bundler",
      strict: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      ignoreDeprecations: "6.0",
      baseUrl: repoRoot,
      paths: {
        "@wats/*": ["./packages/*/src/index.ts"],
        "@wats/graph/*": ["./packages/graph/src/*"],
        "@wats/core/*": ["./packages/core/src/*"],
        "@wats/http/*": ["./packages/http/src/*"],
        "@wats/crypto/*": ["./packages/crypto/src/*"],
        "@wats/types/*": ["./packages/types/src/*"],
        "@wats/config/*": ["./packages/config/src/*"],
        "@wats/persistence/*": ["./packages/persistence/src/*"],
        "@wats/service/*": ["./packages/service/src/*"],
        "@wats/cli/*": ["./packages/cli/src/*"]
      },
      rootDir: repoRoot,
      outDir: join(distDir, "__types")
    },
    include: [join(srcDir, "**/*.ts")],
    exclude: [join(srcDir, "**/*.d.ts")]
  };
  try {
    writeFileSync(tempConfigPath, JSON.stringify(tempConfig, null, 2));
    run("bunx", ["tsc", "-p", tempConfigPath], repoRoot);
    const declarationRoot = join(distDir, "__types", "packages", pkg, "src");
    if (existsSync(declarationRoot)) {
      cpSync(declarationRoot, distDir, { recursive: true });
    }
    rmSync(join(distDir, "__types"), { recursive: true, force: true });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

for (const pkg of PUBLISHABLE_PACKAGES) {
  buildPackage(pkg);
}

console.log(`built publishable package artifacts for ${PUBLISHABLE_PACKAGES.length} packages`);
