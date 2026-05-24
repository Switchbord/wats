#!/usr/bin/env bun
import { runCli, type CliPromptProvider, type CliPromptRequest } from "./index.js";

type MinimalStdin = Readonly<{
  isTTY?: boolean;
  on?(event: "data" | "end" | "error", listener: (...args: unknown[]) => void): unknown;
  off?(event: "data" | "end" | "error", listener: (...args: unknown[]) => void): unknown;
  pause?(): unknown;
  resume?(): unknown;
  setEncoding?(encoding: "utf8"): unknown;
}>;

type PromptWithClose = CliPromptProvider & { close?: () => void };

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
  if (request.hint === undefined) return `${label}${defaultSuffix}: `;
  return `${label}${defaultSuffix}\n  ${request.hint}\n${label}${defaultSuffix}: `;
}

async function createReadlineInterface(): Promise<ReadlineInterface> {
  const readlineSpecifier = "node:readline/promises";
  const readline = await import(
    /* @vite-ignore */ readlineSpecifier
  ) as ReadlinePromisesModule;
  return readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
}

function createTtyPrompt(): CliPromptProvider {
  let readlinePromise: Promise<ReadlineInterface> | undefined;
  let readline: ReadlineInterface | undefined;
  const getReadline = async (): Promise<ReadlineInterface> => {
    if (readlinePromise === undefined) {
      readlinePromise = createReadlineInterface().then((created) => {
        readline = created;
        return created;
      });
    }
    return readlinePromise;
  };

  const prompt = async (request: CliPromptRequest): Promise<string> => {
    const rl = await getReadline();
    const text = promptText(request);
    if (request.secret === true) {
      process.stdout.write(text);
      const originalWriteToOutput = rl._writeToOutput;
      rl._writeToOutput = (): void => undefined;
      try {
        const answer = await rl.question("");
        process.stdout.write("\n");
        return answer;
      } finally {
        if (originalWriteToOutput === undefined) {
          delete (rl as { _writeToOutput?: (output: string) => void })._writeToOutput;
        } else {
          rl._writeToOutput = originalWriteToOutput;
        }
      }
    }
    return await rl.question(text);
  };
  (prompt as PromptWithClose).close = (): void => {
    readline?.close();
    readline = undefined;
    readlinePromise = undefined;
  };
  return prompt;
}

type BufferedInput = {
  readLine(): Promise<string>;
};

function createBufferedInput(stdin: MinimalStdin | undefined): BufferedInput & { close(): void } {
  let buffer = "";
  let ended = false;
  let streamError = false;
  const waiters: Array<() => void> = [];
  const wake = (): void => {
    while (waiters.length > 0) waiters.shift()?.();
  };
  const onData = (chunk: unknown): void => {
    buffer += typeof chunk === "string" ? chunk : String(chunk);
    wake();
  };
  const onEnd = (): void => {
    ended = true;
    wake();
  };
  const onError = (): void => {
    streamError = true;
    ended = true;
    wake();
  };
  stdin?.setEncoding?.("utf8");
  stdin?.on?.("data", onData);
  stdin?.on?.("end", onEnd);
  stdin?.on?.("error", onError);
  stdin?.resume?.();
  return Object.freeze({
    readLine: async (): Promise<string> => {
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/u, "");
          buffer = buffer.slice(newlineIndex + 1);
          return line;
        }
        if (ended) {
          const line = buffer.replace(/\r$/u, "");
          buffer = "";
          return streamError ? "" : line;
        }
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },
    close: (): void => {
      stdin?.off?.("data", onData);
      stdin?.off?.("end", onEnd);
      stdin?.off?.("error", onError);
      stdin?.pause?.();
      ended = true;
      wake();
    }
  });
}

function createBufferedPrompt(): CliPromptProvider {
  const input = createBufferedInput(process.stdin);
  const prompt = async (request: CliPromptRequest): Promise<string> => {
    process.stdout.write(promptText(request));
    return await input.readLine();
  };
  (prompt as PromptWithClose).close = input.close;
  return prompt;
}

const processPrompt = process.stdin?.isTTY === true ? createTtyPrompt() : createBufferedPrompt();
const result = await runCli(process.argv.slice(2), { prompt: processPrompt }).finally(() => {
  (processPrompt as PromptWithClose).close?.();
});

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
