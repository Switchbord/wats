import type { UpdateFilter } from "./base";

export interface MessageTextContainsOptions {
  caseSensitive?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function getFirstMessage(value: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Array.isArray(value.messages) || value.messages.length === 0) {
    return undefined;
  }

  return asRecord(value.messages[0]);
}

function getMessageTextBody(value: unknown): string | undefined {
  const valueRecord = asRecord(value);
  if (valueRecord === undefined) {
    return undefined;
  }

  const firstMessage = getFirstMessage(valueRecord);
  if (firstMessage === undefined) {
    return undefined;
  }

  const textRecord = asRecord(firstMessage.text);
  if (textRecord === undefined || typeof textRecord.body !== "string") {
    return undefined;
  }

  return textRecord.body;
}

function getMessageFrom(value: unknown): string | undefined {
  const valueRecord = asRecord(value);
  if (valueRecord === undefined) {
    return undefined;
  }

  const firstMessage = getFirstMessage(valueRecord);
  if (firstMessage === undefined || typeof firstMessage.from !== "string") {
    return undefined;
  }

  return firstMessage.from;
}

function getContactWaId(value: unknown): string | undefined {
  const valueRecord = asRecord(value);
  if (valueRecord === undefined || !Array.isArray(valueRecord.contacts) || valueRecord.contacts.length === 0) {
    return undefined;
  }

  const firstContact = asRecord(valueRecord.contacts[0]);
  if (firstContact === undefined || typeof firstContact.wa_id !== "string") {
    return undefined;
  }

  return firstContact.wa_id;
}

export const hasMessageText: UpdateFilter = (event) => {
  return typeof getMessageTextBody(event.change.value) === "string";
};

export function messageTextContains(query: string, options: MessageTextContainsOptions = {}): UpdateFilter {
  const safeQuery = typeof query === "string" ? query : undefined;
  const safeOptions = asRecord(options);
  const caseSensitive = safeOptions?.caseSensitive === true;

  if (safeQuery === undefined) {
    return () => false;
  }

  const normalizedQuery = caseSensitive ? safeQuery : safeQuery.toLowerCase();

  return (event) => {
    const body = getMessageTextBody(event.change.value);
    if (body === undefined) {
      return false;
    }

    if (caseSensitive) {
      return body.includes(normalizedQuery);
    }

    return body.toLowerCase().includes(normalizedQuery);
  };
}

export function messageFromWaId(waId: string): UpdateFilter {
  return (event) => {
    const messageFrom = getMessageFrom(event.change.value);
    if (messageFrom === waId) {
      return true;
    }

    return getContactWaId(event.change.value) === waId;
  };
}
