import type { UpdateFilter } from "./base.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function getStatuses(value: unknown): readonly Record<string, unknown>[] {
  const valueRecord = asRecord(value);
  if (valueRecord === undefined || !Array.isArray(valueRecord.statuses)) {
    return [];
  }

  const statuses: Record<string, unknown>[] = [];

  for (const status of valueRecord.statuses) {
    const parsedStatus = asRecord(status);
    if (parsedStatus !== undefined) {
      statuses.push(parsedStatus);
    }
  }

  return statuses;
}

export const hasMessageStatus: UpdateFilter = (event) => {
  for (const status of getStatuses(event.change.value)) {
    if (typeof status.status === "string") {
      return true;
    }
  }

  return false;
};

export function messageStatusIn(...statuses: readonly string[]): UpdateFilter {
  const expected = new Set(statuses);

  return (event) => {
    if (expected.size === 0) {
      return false;
    }

    for (const status of getStatuses(event.change.value)) {
      if (typeof status.status === "string" && expected.has(status.status)) {
        return true;
      }
    }

    return false;
  };
}
