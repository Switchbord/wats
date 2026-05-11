#!/usr/bin/env bun
import { runCli } from "./index";

type MinimalProcess = Readonly<{
  argv: string[];
  stdout: { write(output: string): void };
  stderr: { write(output: string): void };
  once?(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  exit?(code?: number): never;
}> & { exitCode?: number };

declare const process: MinimalProcess;

const result = await runCli(process.argv.slice(2));

if (result.stdout.length > 0) {
  process.stdout.write(result.stdout);
}

if (result.stderr.length > 0) {
  process.stderr.write(result.stderr);
}

if (result.shutdown !== undefined && typeof process.once === "function") {
  let stopped = false;
  const stopAndExit = (): void => {
    if (!stopped) {
      stopped = true;
      result.shutdown?.();
    }
    process.exit?.(0);
  };
  process.once("SIGINT", stopAndExit);
  process.once("SIGTERM", stopAndExit);
}

process.exitCode = result.exitCode;
