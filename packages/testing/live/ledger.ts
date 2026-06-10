// WATS-80 live-testing harness — env gating + evidence ledger.
//
// FAIL-CLOSED CONTRACT: a live probe runs ONLY when WATS_LIVE_ENABLE=1 AND
// WATS_YES_LIVE=1 are both present. Absent either, `liveGate()` returns a
// blocked result carrying the marker PASS_SHAPE_ENV_BLOCKED, which callers
// must surface as "skipped, not validated" — never as live parity. Mutating
// phases additionally require their own domain flag (checked by the caller).
//
// The ledger is written OUTSIDE the repository (default
// ~/.hermes/notes/wats-live/) so redacted evidence never lands in git. Each
// recorded entry is sanitized through redact.ts before it touches disk.

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sanitizeForLedger, shapeSkeleton } from "./redact.ts";

export const ENV_BLOCKED_MARKER = "PASS_SHAPE_ENV_BLOCKED";

export interface LiveGateResult {
  readonly enabled: boolean;
  readonly reason: string;
}

/** Both the live-enable and the yes-live acknowledgement must be set. */
export function liveGate(env: NodeJS.ProcessEnv = process.env): LiveGateResult {
  if (env.WATS_LIVE_ENABLE !== "1") {
    return { enabled: false, reason: `${ENV_BLOCKED_MARKER}: WATS_LIVE_ENABLE != 1` };
  }
  if (env.WATS_YES_LIVE !== "1") {
    return { enabled: false, reason: `${ENV_BLOCKED_MARKER}: WATS_YES_LIVE != 1` };
  }
  return { enabled: true, reason: "live-enabled" };
}

/** A mutating phase needs its domain flag in addition to the live gate. */
export function mutationGate(flagName: string, env: NodeJS.ProcessEnv = process.env): LiveGateResult {
  const base = liveGate(env);
  if (!base.enabled) return base;
  if (env[flagName] !== "1") {
    return { enabled: false, reason: `${ENV_BLOCKED_MARKER}: ${flagName} != 1` };
  }
  return { enabled: true, reason: `live-enabled + ${flagName}` };
}

export interface LedgerEntry {
  readonly phase: string;
  readonly surface: string;
  readonly op: string;
  readonly outcome: "pass" | "fail" | "blocked" | "info";
  readonly httpStatus?: number;
  readonly metaCode?: number | null;
  readonly metaSubcode?: number | null;
  readonly note?: string;
  readonly requestShape?: unknown;
  readonly responseShape?: unknown;
  readonly sanitizedResponse?: unknown;
}

export class LiveLedger {
  readonly runId: string;
  readonly runSalt: string;
  private readonly path: string;

  constructor(runId: string, dir?: string) {
    this.runId = runId;
    // The salt is the run id plus a fixed namespace; per-run hashes only.
    this.runSalt = `wats-live::${runId}`;
    const base = dir ?? join(homedir(), ".hermes", "notes", "wats-live");
    mkdirSync(base, { recursive: true });
    this.path = join(base, `${runId}.jsonl`);
  }

  get filePath(): string {
    return this.path;
  }

  /** Append one sanitized entry. Returns the sanitized record for printing. */
  record(entry: LedgerEntry): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {
      at: new Date().toISOString(),
      runId: this.runId,
      phase: entry.phase,
      surface: entry.surface,
      op: entry.op,
      outcome: entry.outcome,
      httpStatus: entry.httpStatus ?? null,
      metaCode: entry.metaCode ?? null,
      metaSubcode: entry.metaSubcode ?? null,
      note: entry.note ?? null
    };
    if (entry.requestShape !== undefined) {
      sanitized.requestShape = shapeSkeleton(entry.requestShape);
    }
    if (entry.responseShape !== undefined) {
      sanitized.responseShape = shapeSkeleton(entry.responseShape);
    }
    if (entry.sanitizedResponse !== undefined) {
      sanitized.sanitizedResponse = sanitizeForLedger(entry.sanitizedResponse, this.runSalt);
    }
    appendFileSync(this.path, `${JSON.stringify(sanitized)}\n`, "utf8");
    return sanitized;
  }
}

/** Pull a Meta error code/subcode off an unknown thrown value, fail-closed. */
export function metaErrorFields(err: unknown): { metaCode: number | null; metaSubcode: number | null; httpStatus?: number; name: string } {
  let name = "Error";
  try {
    name = err instanceof Error ? err.name : String(typeof err);
  } catch {
    name = "Error";
  }
  const read = (k: string): number | null => {
    try {
      const v = (err as Record<string, unknown>)[k];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  };
  const out: { metaCode: number | null; metaSubcode: number | null; httpStatus?: number; name: string } = {
    metaCode: read("code"),
    metaSubcode: read("errorSubcode"),
    name
  };
  const status = read("status");
  if (status !== null) out.httpStatus = status;
  return out;
}
