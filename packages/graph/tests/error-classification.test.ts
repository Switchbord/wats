// F-5 RED: error classification tightening (WATS-11 L5).
//
// Exercises createGraphApiError under the tightened classification rules:
// - OAuthException only classifies as GraphAuthError when status is 4xx.
// - Rate-limit codes only classify as GraphRateLimitError when HTTP
//   status is 429 or 4xx.
// - Registry-backed codes return their registered subclass.
// - Unknown codes at 4xx → GraphApiError with classification "ClientError".
// - Unknown codes at 5xx → GraphApiError with classification "ServerError".
//
// Sibling-assertion pattern required: every positive identity check is
// paired with at least one `not.toBeInstanceOf` against a sibling class.

import { describe, expect, test } from "bun:test";
import {
  createGraphApiError,
  GraphApiError,
  GraphAuthError,
  GraphRateLimitError,
  GraphRequestValidationError,
  type GraphApiErrorPayload
} from "../src/errors";
import {
  ExpiredAccessTokenError,
  InvalidParameterError,
  TemplateParamCountMismatchError,
  ToManyAPICallsError,
  UnsupportedMessageTypeError
} from "../src/errorSubclasses";

function asPayload(value: {
  message: string;
  code?: number;
  type?: string;
  error_subcode?: number;
}): GraphApiErrorPayload {
  return value as GraphApiErrorPayload;
}

describe("F-5 classification: OAuth gated to 4xx (WATS-11 L5)", () => {
  test("OAuthException at 401 classifies as GraphAuthError", () => {
    const err = createGraphApiError({
      status: 401,
      payload: asPayload({
        message: "Invalid OAuth access token.",
        type: "OAuthException",
        code: 190
      })
    });
    expect(err).toBeInstanceOf(GraphAuthError);
    // Sibling: not a rate-limit error.
    expect(err).not.toBeInstanceOf(GraphRateLimitError);
  });

  test("OAuthException at 400 classifies as GraphAuthError", () => {
    const err = createGraphApiError({
      status: 400,
      payload: asPayload({
        message: "Invalid OAuth access token.",
        type: "OAuthException",
        code: 190
      })
    });
    expect(err).toBeInstanceOf(GraphAuthError);
    expect(err).not.toBeInstanceOf(GraphRateLimitError);
  });

  test("OAuthException at 500 does NOT classify as GraphAuthError", () => {
    const err = createGraphApiError({
      status: 500,
      payload: asPayload({
        message: "Internal server error with stray OAuthException type.",
        type: "OAuthException"
      })
    });
    expect(err).toBeInstanceOf(GraphApiError);
    // Sibling: explicitly NOT auth.
    expect(err).not.toBeInstanceOf(GraphAuthError);
    // Sibling: explicitly NOT rate-limit.
    expect(err).not.toBeInstanceOf(GraphRateLimitError);
  });

  test("OAuthException at 503 does NOT classify as GraphAuthError", () => {
    const err = createGraphApiError({
      status: 503,
      payload: asPayload({
        message: "Service unavailable.",
        type: "OAuthException"
      })
    });
    expect(err).not.toBeInstanceOf(GraphAuthError);
    expect(err).toBeInstanceOf(GraphApiError);
  });
});

describe("F-5 classification: rate-limit requires HTTP status coherence", () => {
  test("rate-limit code 4 at HTTP 429 classifies as GraphRateLimitError", () => {
    const err = createGraphApiError({
      status: 429,
      payload: asPayload({ message: "Too many calls", code: 4 })
    });
    expect(err).toBeInstanceOf(GraphRateLimitError);
    expect(err).not.toBeInstanceOf(GraphAuthError);
  });

  test("rate-limit code 131048 at HTTP 400 classifies as GraphRateLimitError", () => {
    const err = createGraphApiError({
      status: 400,
      payload: asPayload({ message: "Message spam rate-limit (pywa 131048)", code: 131048 })
    });
    expect(err).toBeInstanceOf(GraphRateLimitError);
    expect(err).not.toBeInstanceOf(GraphAuthError);
  });

  test("rate-limit code 4 at HTTP 500 does NOT classify as GraphRateLimitError", () => {
    const err = createGraphApiError({
      status: 500,
      payload: asPayload({ message: "Server failure, stray code", code: 4 })
    });
    expect(err).not.toBeInstanceOf(GraphRateLimitError);
    expect(err).toBeInstanceOf(GraphApiError);
  });

  test("HTTP 429 without a known code still classifies as GraphRateLimitError", () => {
    const err = createGraphApiError({
      status: 429,
      payload: asPayload({ message: "throttled without code" })
    });
    expect(err).toBeInstanceOf(GraphRateLimitError);
  });
});

describe("F-5 classification: ClientError vs ServerError axis", () => {
  test("unknown code at HTTP 400 becomes GraphApiError with ClientError classification", () => {
    const err = createGraphApiError({
      status: 400,
      payload: asPayload({ message: "Unknown client failure" })
    });
    expect(err).toBeInstanceOf(GraphApiError);
    expect(err).not.toBeInstanceOf(GraphAuthError);
    expect(err).not.toBeInstanceOf(GraphRateLimitError);
    expect((err as GraphApiError & { classification?: string }).classification).toBe(
      "ClientError"
    );
  });

  test("unknown code at HTTP 500 becomes GraphApiError with ServerError classification", () => {
    const err = createGraphApiError({
      status: 500,
      payload: asPayload({ message: "Unknown server failure" })
    });
    expect(err).toBeInstanceOf(GraphApiError);
    expect(err).not.toBeInstanceOf(GraphAuthError);
    expect(err).not.toBeInstanceOf(GraphRateLimitError);
    expect((err as GraphApiError & { classification?: string }).classification).toBe(
      "ServerError"
    );
  });

  test("unknown code at HTTP 503 becomes ServerError classification", () => {
    const err = createGraphApiError({
      status: 503,
      payload: asPayload({ message: "Upstream 503" })
    });
    expect((err as GraphApiError & { classification?: string }).classification).toBe(
      "ServerError"
    );
  });
});

describe("F-5 classification: registry-first resolution", () => {
  test("code 100 constructs InvalidParameterError via the registry", () => {
    const err = createGraphApiError({
      status: 400,
      payload: asPayload({ message: "Invalid parameter.", code: 100 })
    });
    expect(err).toBeInstanceOf(InvalidParameterError);
    expect(err).toBeInstanceOf(GraphApiError);
    // Sibling assertions across the taxonomy.
    expect(err).not.toBeInstanceOf(GraphAuthError);
    expect(err).not.toBeInstanceOf(GraphRateLimitError);
  });

  test("code 132000 constructs TemplateParamCountMismatchError", () => {
    const err = createGraphApiError({
      status: 400,
      payload: asPayload({
        message: "Template parameter count mismatch.",
        code: 132000
      })
    });
    expect(err).toBeInstanceOf(TemplateParamCountMismatchError);
    expect(err).not.toBeInstanceOf(GraphAuthError);
  });

  test("code 131051 constructs UnsupportedMessageTypeError (sibling: not Auth)", () => {
    const err = createGraphApiError({
      status: 400,
      payload: asPayload({
        message: "The message type is not supported.",
        code: 131051
      })
    });
    expect(err).toBeInstanceOf(UnsupportedMessageTypeError);
    expect(err).not.toBeInstanceOf(GraphAuthError);
    expect(err).not.toBeInstanceOf(GraphRateLimitError);
  });

  test("code 190 at 401 constructs ExpiredAccessTokenError subclass of GraphAuthError", () => {
    const err = createGraphApiError({
      status: 401,
      payload: asPayload({
        message: "Invalid access token.",
        code: 190,
        type: "OAuthException"
      })
    });
    expect(err).toBeInstanceOf(ExpiredAccessTokenError);
    expect(err).toBeInstanceOf(GraphAuthError);
    // Sibling.
    expect(err).not.toBeInstanceOf(GraphRateLimitError);
  });

  test("code 4 at 429 constructs ToManyAPICallsError subclass of GraphRateLimitError", () => {
    const err = createGraphApiError({
      status: 429,
      payload: asPayload({
        message: "Application request limit reached.",
        code: 4
      })
    });
    expect(err).toBeInstanceOf(ToManyAPICallsError);
    expect(err).toBeInstanceOf(GraphRateLimitError);
    // Sibling.
    expect(err).not.toBeInstanceOf(GraphAuthError);
  });
});

describe("F-5 classification: GraphRequestValidationError is independent", () => {
  test("construction-time validation errors are not affected by registry", () => {
    const err = new GraphRequestValidationError("bad url");
    expect(err).toBeInstanceOf(GraphRequestValidationError);
    expect(err).toBeInstanceOf(GraphApiError);
    // Sibling: not auth, not rate-limit.
    expect(err).not.toBeInstanceOf(GraphAuthError);
    expect(err).not.toBeInstanceOf(GraphRateLimitError);
  });
});
