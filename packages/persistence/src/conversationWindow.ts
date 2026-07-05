import {
  PersistenceError,
  type ConversationWindowInput,
  type ConversationWindowState,
  type PersistenceStore
} from "./index";

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_WINDOW_MS = 1;
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STRING_LENGTH = 1024;

function hasControlChars(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === null || prototype === Object.prototype;
}

function validatePhone(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_STRING_LENGTH || hasControlChars(value)) {
    throw new PersistenceError("invalid_record", "phone must be a safe non-empty string.");
  }
  return value;
}

function validateTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_STRING_LENGTH || hasControlChars(value)) {
    throw new PersistenceError("invalid_record", `${label} must be an ISO timestamp.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new PersistenceError("invalid_record", `${label} must be an ISO timestamp.`);
  }
  if (new Date(value).toISOString() !== value) {
    throw new PersistenceError("invalid_record", `${label} must be an ISO timestamp.`);
  }
  return value;
}

function validateWindowMs(value: unknown): number {
  if (value === undefined) return DEFAULT_WINDOW_MS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_WINDOW_MS || value > MAX_WINDOW_MS) {
    throw new PersistenceError("invalid_record", "windowMs must be an integer from 1 to 604800000.");
  }
  return value;
}

function validateConversationWindowInput(input: ConversationWindowInput): {
  phone: string;
  now: string;
  windowMs: number;
} {
  if (!isRecord(input)) {
    throw new PersistenceError("invalid_record", "conversation window input must be an object.");
  }
  return Object.freeze({
    phone: validatePhone(input.phone),
    now: validateTimestamp(input.now, "now"),
    windowMs: validateWindowMs(input.windowMs)
  });
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Compute the 24-hour customer-service-window state for a phone number.
 *
 * The window is open when the most recent inbound message from `phone` is less
 * than `windowMs` (default 24h) before `now`. The boundary is strict: an
 * inbound exactly `windowMs` ago closes the window (you need a template).
 *
 * Clock skew: if `lastInboundAt` is in the future relative to `now`, the window
 * is treated as open with the full remaining duration. This is the safe choice
 * for a WhatsApp ops caller — a free-form send that Meta rejects costs a
 * retry, while wrongly forcing a template silences a live conversation.
 */
export async function getConversationWindowState(
  store: PersistenceStore,
  input: ConversationWindowInput
): Promise<ConversationWindowState> {
  const validated = validateConversationWindowInput(input);
  const lastInboundAt = await store.getLatestInboundMessageAt({ phone: validated.phone });
  if (lastInboundAt === null) {
    return Object.freeze({
      open: false,
      lastInboundAt: null,
      expiresAt: null,
      remainingMs: 0
    });
  }
  const lastMs = new Date(lastInboundAt).getTime();
  const nowMs = new Date(validated.now).getTime();
  // Clock skew: the customer's last inbound landed after our `now`. Treat the
  // window as freshly open so a slightly-behind operator clock does not strand
  // a live conversation behind a template gate.
  if (lastMs > nowMs) {
    return Object.freeze({
      open: true,
      lastInboundAt,
      expiresAt: isoFromMs(lastMs + validated.windowMs),
      remainingMs: validated.windowMs
    });
  }
  const elapsed = nowMs - lastMs;
  const remainingMs = validated.windowMs - elapsed;
  if (remainingMs > 0) {
    return Object.freeze({
      open: true,
      lastInboundAt,
      expiresAt: isoFromMs(lastMs + validated.windowMs),
      remainingMs
    });
  }
  return Object.freeze({
    open: false,
    lastInboundAt,
    expiresAt: isoFromMs(lastMs + validated.windowMs),
    remainingMs: 0
  });
}

/**
 * True when free-form messages are allowed right now (the 24h window is open).
 * Outside the window, send an approved template.
 */
export async function canSendFreeForm(
  store: PersistenceStore,
  input: ConversationWindowInput
): Promise<boolean> {
  const state = await getConversationWindowState(store, input);
  return state.open;
}
