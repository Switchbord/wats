export type UpdateParserErrorCode =
  | "invalid_envelope"
  | "unsupported_object"
  | "entries_limit_exceeded"
  | "changes_limit_exceeded"
  | "events_limit_exceeded";

export interface UpdateParserError {
  code: UpdateParserErrorCode;
  message: string;
}

export interface UpdateParserOptions {
  maxEntries?: number;
  maxChangesPerEntry?: number;
  maxTotalEvents?: number;
  supportedObjects?: readonly string[];
}

export interface ParsedUpdateDiscriminator {
  field: string;
  subtype?: string;
  eventType: string;
}

export interface ParsedUpdateEntryMetadata {
  index: number;
  id?: string;
  time?: number;
}

export interface ParsedUpdateChangeMetadata {
  index: number;
  value: Record<string, unknown>;
}

export interface ParsedUpdateRawRefs {
  entry: Record<string, unknown>;
  change: Record<string, unknown>;
}

export interface ParsedUpdateEvent {
  object: string;
  discriminator: ParsedUpdateDiscriminator;
  entry: ParsedUpdateEntryMetadata;
  change: ParsedUpdateChangeMetadata;
  raw: ParsedUpdateRawRefs;
}

export type ParseWebhookUpdateResult =
  | {
      ok: true;
      events: ParsedUpdateEvent[];
      skippedEntries: number;
      skippedChanges: number;
    }
  | {
      ok: false;
      events: [];
      error: UpdateParserError;
    };

const DEFAULT_SUPPORTED_OBJECTS = ["whatsapp_business_account"] as const;

const DEFAULT_PARSER_LIMITS = {
  maxEntries: 100,
  maxChangesPerEntry: 250,
  maxTotalEvents: 5_000
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getDiscriminator(field: string, change: Record<string, unknown>): ParsedUpdateDiscriminator {
  const subtype = typeof change.event === "string" ? change.event : undefined;
  return {
    field,
    subtype,
    eventType: subtype ? `${field}.${subtype}` : field
  };
}

function toPositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function toSupportedObjects(value: readonly string[] | undefined): readonly string[] {
  if (value === undefined || value.length === 0) {
    return DEFAULT_SUPPORTED_OBJECTS;
  }

  return value;
}

export function parseWebhookUpdate(rawEnvelope: unknown, options: UpdateParserOptions = {}): ParseWebhookUpdateResult {
  if (!isRecord(rawEnvelope) || !Array.isArray(rawEnvelope.entry)) {
    return {
      ok: false,
      events: [],
      error: {
        code: "invalid_envelope",
        message: "Webhook envelope must include an entry array."
      }
    };
  }

  const supportedObjects = toSupportedObjects(options.supportedObjects);
  if (typeof rawEnvelope.object !== "string" || !supportedObjects.includes(rawEnvelope.object)) {
    return {
      ok: false,
      events: [],
      error: {
        code: "unsupported_object",
        message: `Unsupported webhook object: ${String(rawEnvelope.object)}.`
      }
    };
  }

  const limits = {
    maxEntries: toPositiveInteger(options.maxEntries, DEFAULT_PARSER_LIMITS.maxEntries),
    maxChangesPerEntry: toPositiveInteger(options.maxChangesPerEntry, DEFAULT_PARSER_LIMITS.maxChangesPerEntry),
    maxTotalEvents: toPositiveInteger(options.maxTotalEvents, DEFAULT_PARSER_LIMITS.maxTotalEvents)
  };

  if (rawEnvelope.entry.length > limits.maxEntries) {
    return {
      ok: false,
      events: [],
      error: {
        code: "entries_limit_exceeded",
        message: `Envelope entry count ${rawEnvelope.entry.length} exceeds maxEntries ${limits.maxEntries}.`
      }
    };
  }

  const objectType = rawEnvelope.object;
  const events: ParsedUpdateEvent[] = [];

  let skippedEntries = 0;
  let skippedChanges = 0;

  for (let entryIndex = 0; entryIndex < rawEnvelope.entry.length; entryIndex += 1) {
    const entryValue = rawEnvelope.entry[entryIndex];
    if (!isRecord(entryValue) || !Array.isArray(entryValue.changes)) {
      skippedEntries += 1;
      continue;
    }

    if (entryValue.changes.length > limits.maxChangesPerEntry) {
      return {
        ok: false,
        events: [],
        error: {
          code: "changes_limit_exceeded",
          message: `Entry ${entryIndex} change count ${entryValue.changes.length} exceeds maxChangesPerEntry ${limits.maxChangesPerEntry}.`
        }
      };
    }

    for (let changeIndex = 0; changeIndex < entryValue.changes.length; changeIndex += 1) {
      const changeValue = entryValue.changes[changeIndex];
      if (!isRecord(changeValue)) {
        skippedChanges += 1;
        continue;
      }

      if (typeof changeValue.field !== "string") {
        skippedChanges += 1;
        continue;
      }

      if (!isRecord(changeValue.value)) {
        skippedChanges += 1;
        continue;
      }

      if (events.length >= limits.maxTotalEvents) {
        return {
          ok: false,
          events: [],
          error: {
            code: "events_limit_exceeded",
            message: `Normalized event count exceeds maxTotalEvents ${limits.maxTotalEvents}.`
          }
        };
      }

      events.push({
        object: objectType,
        discriminator: getDiscriminator(changeValue.field, changeValue),
        entry: {
          index: entryIndex,
          id: typeof entryValue.id === "string" ? entryValue.id : undefined,
          time: typeof entryValue.time === "number" ? entryValue.time : undefined
        },
        change: {
          index: changeIndex,
          value: changeValue.value
        },
        raw: {
          entry: entryValue,
          change: changeValue
        }
      });
    }
  }

  return {
    ok: true,
    events,
    skippedEntries,
    skippedChanges
  };
}
