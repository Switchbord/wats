// WATS-124: opt-in CLI status client for observed message records.
//
// Pure HTTP client for the local WATS service `/api/messages` projection
// surface (WATS-122). No `process` access, no env reads, no retries, no live
// Meta/Graph calls. The caller injects baseUrl + bearerToken (resolved by the
// CLI command from flags/env) and may inject a `fetchImpl` for tests.

export interface StatusMessageRecord {
  readonly rowId: string;
  readonly waMessageId: string;
  readonly direction: "inbound" | "outbound";
  readonly fromPhone: string | null;
  readonly toPhone: string | null;
  readonly type: string;
  readonly status: string;
  readonly graphMessageId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StatusListResult {
  readonly items: readonly StatusMessageRecord[];
  readonly nextCursor: string | null;
}

export interface StatusListInput {
  readonly limit?: number;
  readonly cursor?: string;
}

export class MessagesStatusClientError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`MessagesStatusClientError: service returned ${status}`);
    this.name = "MessagesStatusClientError";
    this.status = status;
    this.body = body;
  }
}

type FetchLike = typeof fetch;

export interface MessagesStatusClient {
  list(input?: StatusListInput): Promise<StatusListResult>;
  get(id: string): Promise<StatusMessageRecord>;
}

export interface CreateMessagesStatusClientOptions {
  readonly baseUrl: string;
  readonly bearerToken: string;
  readonly fetchImpl?: FetchLike;
}

function joinUrl(baseUrl: string, path: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/u, "");
  return `${trimmedBase}${path}`;
}

export function createMessagesStatusClient(options: CreateMessagesStatusClientOptions): MessagesStatusClient {
  const fetchImpl: FetchLike = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl;
  const bearerToken = options.bearerToken;

  async function request(path: string): Promise<unknown> {
    const response = await fetchImpl(joinUrl(baseUrl, path), {
      method: "GET",
      headers: { authorization: `Bearer ${bearerToken}` }
    });
    const bodyText = await response.text();
    if (response.status < 200 || response.status >= 300) {
      throw new MessagesStatusClientError(response.status, bodyText);
    }
    return bodyText.length === 0 ? {} : JSON.parse(bodyText) as unknown;
  }

  return Object.freeze({
    async list(input: StatusListInput = {}): Promise<StatusListResult> {
      const params = new URLSearchParams();
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      if (input.cursor !== undefined) params.set("cursor", input.cursor);
      const query = params.toString();
      const path = query.length === 0 ? "/api/messages" : `/api/messages?${query}`;
      const json = await request(path) as { items?: unknown; nextCursor?: unknown };
      const items = Array.isArray(json.items) ? json.items as readonly StatusMessageRecord[] : [];
      const nextCursor = typeof json.nextCursor === "string" ? json.nextCursor : null;
      return Object.freeze({ items, nextCursor });
    },
    async get(id: string): Promise<StatusMessageRecord> {
      const json = await request(`/api/messages/${encodeURIComponent(id)}`) as StatusMessageRecord;
      return json;
    }
  });
}
