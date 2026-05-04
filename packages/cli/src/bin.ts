#!/usr/bin/env bun
import { runCli } from "./index";

type MinimalProcess = Readonly<{
  argv: string[];
  stdout: { write(output: string): void };
  stderr: { write(output: string): void };
}> & { exitCode?: number };

declare const process: MinimalProcess;

const result = await runCli(process.argv.slice(2));

if (result.stdout.length > 0) {
  process.stdout.write(result.stdout);
}

if (result.stderr.length > 0) {
  process.stderr.write(result.stderr);
}

process.exitCode = result.exitCode;
