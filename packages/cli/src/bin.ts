#!/usr/bin/env bun
import { runCli, type CliPromptProvider, type CliPromptRequest } from "./index.js";

type MinimalStdin = Readonly<{
  isTTY?: boolean;
}>;

type MinimalProcess = Readonly<{
  argv: string[];
  stdin?: MinimalStdin;
  stdout: { write(output: string): void };
  stderr: { write(output: string): void };
  once?(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  exit?(code?: number): never;
}> & { exitCode?: number };

type ReadlineInterface = {
  question(query: string): Promise<string>;
  close(): void;
  _writeToOutput?: (output: string) => void;
};

type ReadlinePromisesModule = Readonly<{
  createInterface(options: { input: unknown; output: unknown; terminal?: boolean }): ReadlineInterface;
}>;

declare const process: MinimalProcess;

function promptText(request: CliPromptRequest): string {
  const label = request.label ?? request.message ?? "value";
  const defaultSuffix = request.defaultValue === undefined ? "" : ` [${request.defaultValue}]`;
  return `${label}${defaultSuffix}: `;
}

async function createReadlineInterface(): Promise<ReadlineInterface> {
  const readlineSpecifier = "node:readline/promises";
  const readline = await import(
    /* @vite-ignore */ readlineSpecifier
  ) as ReadlinePromisesModule;
  return readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin?.isTTY === true });
}

function createProcessPrompt(): CliPromptProvider {
  return async (request: CliPromptRequest): Promise<string> => {
    const rl = await createReadlineInterface();
    try {
      const text = promptText(request);
      if (request.secret === true && process.stdin?.isTTY === true) {
        process.stdout.write(text);
        rl._writeToOutput = (): void => undefined;
        const answer = await rl.question("");
        process.stdout.write("\n");
        return answer;
      }
      return await rl.question(text);
    } finally {
      rl.close();
    }
  };
}

const result = await runCli(process.argv.slice(2), { prompt: createProcessPrompt() });

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
