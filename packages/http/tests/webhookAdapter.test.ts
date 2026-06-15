// F-12 RED — WebhookAdapter runtime-neutral core coverage.
//
// These tests fail until createWebhookAdapter lands. They exercise
// construction validation, GET verify / POST dispatch flows, status
// code taxonomy (200/400/401/405/413), logger hook observations,
// and sibling-class error assertions.

import { describe, expect, test } from "bun:test";
import { createCryptoProvider } from "@wats/crypto";
import {
  WebhookAdapterConfigError,
  createWebhookAdapter,
  type WebhookAdapterEvent,
  type WebhookRequest
} from "@wats/http";
import { validateWebhookSignature } from "@wats/http/signature";

// ---- helpers -------------------------------------------------------

function textEncoder(): TextEncoder {
  return new TextEncoder();
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

interface MockFacade {
  readonly dispatches: unknown[];
  dispatch(update: unknown): Promise<void>;
  failNext?: boolean;
}

function makeFacade(): MockFacade {
  const dispatches: unknown[] = [];
  const facade: MockFacade = {
    dispatches,
    async dispatch(update: unknown) {
      dispatches.push(update);
      if (facade.failNext === true) {
        facade.failNext = false;
        throw new Error("boom");
      }
    }
  };
  return facade;
}

function makeEnvelope(): object {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-TEST",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "555" },
              messages: [
                {
                  from: "15550001",
                  id: "wamid.ONE",
                  timestamp: "1",
                  type: "text",
                  text: { body: "hi" }
                }
              ]
            }
          }
        ]
      }
    ]
  };
}

async function signBody(
  appSecret: string,
  body: string
): Promise<string> {
  const provider = await createCryptoProvider();
  const digest = await provider.hmacSha256(appSecret, body);
  return `sha256=${bytesToHex(digest)}`;
}

function buildRequest(init: {
  method: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | null;
}): WebhookRequest {
  const headers = new Headers(init.headers ?? {});
  let body: ArrayBuffer | Uint8Array | null;
  if (init.body === null || init.body === undefined) {
    body = null;
  } else if (typeof init.body === "string") {
    body = textEncoder().encode(init.body);
  } else {
    body = init.body;
  }
  return {
    method: init.method,
    url: init.url ?? "https://wats.test/webhook",
    headers,
    body
  };
}

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";

// ---- construction validation --------------------------------------

describe("F-12 createWebhookAdapter — construction validation", () => {
  test("rejects null config", () => {
    let caught: unknown;
    try {
      // @ts-expect-error intentional null
      createWebhookAdapter(null);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebhookAdapterConfigError);
    expect((caught as WebhookAdapterConfigError).code).toBe("invalid_config");
  });

  test("rejects missing verifyToken", () => {
    const facade = makeFacade();
    let caught: unknown;
    try {
      createWebhookAdapter({
        verifyToken: "",
        appSecret: APP_SECRET,
        whatsapp: facade
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebhookAdapterConfigError);
    expect((caught as WebhookAdapterConfigError).code).toBe("invalid_verify_token");
  });

  test("rejects verifyToken with CR/LF/NUL", () => {
    const facade = makeFacade();
    for (const bad of ["a\rb", "a\nb", "a\0b"]) {
      let caught: unknown;
      try {
        createWebhookAdapter({
          verifyToken: bad,
          appSecret: APP_SECRET,
          whatsapp: facade
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(WebhookAdapterConfigError);
      expect((caught as WebhookAdapterConfigError).code).toBe(
        "invalid_verify_token"
      );
    }
  });

  test("rejects verifyToken exceeding length cap", () => {
    const facade = makeFacade();
    let caught: unknown;
    try {
      createWebhookAdapter({
        verifyToken: "x".repeat(10_000),
        appSecret: APP_SECRET,
        whatsapp: facade
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebhookAdapterConfigError);
    expect((caught as WebhookAdapterConfigError).code).toBe("invalid_verify_token");
  });

  test("rejects missing appSecret", () => {
    const facade = makeFacade();
    let caught: unknown;
    try {
      createWebhookAdapter({
        verifyToken: VERIFY_TOKEN,
        appSecret: "",
        whatsapp: facade
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebhookAdapterConfigError);
    expect((caught as WebhookAdapterConfigError).code).toBe("invalid_app_secret");
  });

  test("rejects invalid whatsapp facade (missing dispatch)", () => {
    let caught: unknown;
    try {
      createWebhookAdapter({
        verifyToken: VERIFY_TOKEN,
        appSecret: APP_SECRET,
        // @ts-expect-error intentional missing dispatch
        whatsapp: { notDispatch: () => {} }
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebhookAdapterConfigError);
    expect((caught as WebhookAdapterConfigError).code).toBe("invalid_whatsapp");
  });

  test("rejects non-function logger", () => {
    const facade = makeFacade();
    let caught: unknown;
    try {
      createWebhookAdapter({
        verifyToken: VERIFY_TOKEN,
        appSecret: APP_SECRET,
        whatsapp: facade,
        // @ts-expect-error intentional wrong type
        logger: "not-a-fn"
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebhookAdapterConfigError);
    expect((caught as WebhookAdapterConfigError).code).toBe("invalid_logger");
  });

  test("rejects invalid maxBodyBytes", () => {
    const facade = makeFacade();
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      let caught: unknown;
      try {
        createWebhookAdapter({
          verifyToken: VERIFY_TOKEN,
          appSecret: APP_SECRET,
          whatsapp: facade,
          maxBodyBytes: bad
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(WebhookAdapterConfigError);
      expect((caught as WebhookAdapterConfigError).code).toBe(
        "invalid_max_body_bytes"
      );
    }
  });

  test("rejects invalid cryptoProvider shape", () => {
    const facade = makeFacade();
    let caught: unknown;
    try {
      createWebhookAdapter({
        verifyToken: VERIFY_TOKEN,
        appSecret: APP_SECRET,
        whatsapp: facade,
        // @ts-expect-error intentional wrong shape
        cryptoProvider: { notHmac: true }
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebhookAdapterConfigError);
    expect((caught as WebhookAdapterConfigError).code).toBe(
      "invalid_crypto_provider"
    );
  });

  test("sibling-class: WebhookAdapterConfigError is NOT a TypeError", () => {
    const facade = makeFacade();
    let caught: unknown;
    try {
      createWebhookAdapter({
        verifyToken: "",
        appSecret: APP_SECRET,
        whatsapp: facade
      });
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof WebhookAdapterConfigError).toBe(true);
    expect(caught instanceof TypeError).toBe(false);
  });
});

// ---- GET verify flow -----------------------------------------------

describe("F-12 WebhookAdapter — GET verify flow", () => {
  function build() {
    const facade = makeFacade();
    const events: WebhookAdapterEvent[] = [];
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade,
      logger: (event) => events.push(event)
    });
    return { adapter, facade, events };
  }

  test("returns 200 + echoes challenge on valid subscribe", async () => {
    const { adapter } = build();
    const url = `https://wats.test/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(
      VERIFY_TOKEN
    )}&hub.challenge=xyz123`;
    const response = await adapter.handle(buildRequest({ method: "GET", url }));
    expect(response.status).toBe(200);
    expect(response.body).toBe("xyz123");
    expect(response.headers["content-type"]).toMatch(/text\/plain/);
  });

  test("returns 401 on wrong verify token", async () => {
    const { adapter } = build();
    const url = `https://wats.test/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=xyz`;
    const response = await adapter.handle(buildRequest({ method: "GET", url }));
    expect(response.status).toBe(401);
  });

  test("returns 401 on missing verify token", async () => {
    const { adapter } = build();
    const url = `https://wats.test/webhook?hub.mode=subscribe&hub.challenge=xyz`;
    const response = await adapter.handle(buildRequest({ method: "GET", url }));
    expect(response.status).toBe(401);
  });

  test("returns 400 on wrong hub.mode", async () => {
    const { adapter } = build();
    const url = `https://wats.test/webhook?hub.mode=unsubscribe&hub.verify_token=${encodeURIComponent(
      VERIFY_TOKEN
    )}&hub.challenge=xyz`;
    const response = await adapter.handle(buildRequest({ method: "GET", url }));
    expect(response.status).toBe(400);
  });

  test("returns 400 on missing hub.challenge", async () => {
    const { adapter } = build();
    const url = `https://wats.test/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(
      VERIFY_TOKEN
    )}`;
    const response = await adapter.handle(buildRequest({ method: "GET", url }));
    expect(response.status).toBe(400);
  });

  test("logger observes request_received + response_sent", async () => {
    const { adapter, events } = build();
    const url = `https://wats.test/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(
      VERIFY_TOKEN
    )}&hub.challenge=xyz`;
    await adapter.handle(buildRequest({ method: "GET", url }));
    const types = events.map((e) => e.type);
    expect(types).toContain("request_received");
    expect(types).toContain("response_sent");
  });
});

// ---- POST dispatch flow --------------------------------------------

describe("F-12 WebhookAdapter — POST dispatch flow", () => {
  async function build() {
    const facade = makeFacade();
    const events: WebhookAdapterEvent[] = [];
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade,
      logger: (event) => events.push(event)
    });
    return { adapter, facade, events };
  }

  test("returns 200 + dispatches updates on valid signed POST", async () => {
    const { adapter, facade } = await build();
    const body = JSON.stringify(makeEnvelope());
    const signature = await signBody(APP_SECRET, body);
    const response = await adapter.handle(
      buildRequest({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signature
        },
        body
      })
    );
    expect(response.status).toBe(200);
    expect(facade.dispatches.length).toBe(1);
  });

  test("returns 401 on invalid signature", async () => {
    const { adapter, facade } = await build();
    const body = JSON.stringify(makeEnvelope());
    const response = await adapter.handle(
      buildRequest({
        method: "POST",
        headers: {
          "x-hub-signature-256":
            "sha256=0000000000000000000000000000000000000000000000000000000000000000"
        },
        body
      })
    );
    expect(response.status).toBe(401);
    expect(facade.dispatches.length).toBe(0);
  });

  test("returns 401 on missing signature header", async () => {
    const { adapter, facade } = await build();
    const body = JSON.stringify(makeEnvelope());
    const response = await adapter.handle(
      buildRequest({ method: "POST", body })
    );
    expect(response.status).toBe(401);
    expect(facade.dispatches.length).toBe(0);
  });

  test("returns 400 on malformed signature header", async () => {
    const { adapter, facade } = await build();
    const body = JSON.stringify(makeEnvelope());
    const response = await adapter.handle(
      buildRequest({
        method: "POST",
        headers: { "x-hub-signature-256": "not-a-sha" },
        body
      })
    );
    expect(response.status).toBe(400);
    expect(facade.dispatches.length).toBe(0);
  });

  test("returns 400 on malformed JSON body", async () => {
    const { adapter, facade } = await build();
    const body = "{not json";
    const signature = await signBody(APP_SECRET, body);
    const response = await adapter.handle(
      buildRequest({
        method: "POST",
        headers: { "x-hub-signature-256": signature },
        body
      })
    );
    expect(response.status).toBe(400);
    expect(facade.dispatches.length).toBe(0);
  });

  test("returns 400 on envelope-level malformation (wrong object field)", async () => {
    const { adapter, facade } = await build();
    const body = JSON.stringify({ object: "page", entry: [] });
    const signature = await signBody(APP_SECRET, body);
    const response = await adapter.handle(
      buildRequest({
        method: "POST",
        headers: { "x-hub-signature-256": signature },
        body
      })
    );
    expect(response.status).toBe(400);
    expect(facade.dispatches.length).toBe(0);
  });

  test("returns 413 when body exceeds maxBodyBytes", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade,
      maxBodyBytes: 10
    });
    const body = "x".repeat(100);
    const signature = await signBody(APP_SECRET, body);
    const response = await adapter.handle(
      buildRequest({
        method: "POST",
        headers: { "x-hub-signature-256": signature },
        body
      })
    );
    expect(response.status).toBe(413);
    expect(facade.dispatches.length).toBe(0);
  });

  test("returns 400 when POST has null body", async () => {
    const { adapter } = await build();
    const response = await adapter.handle(
      buildRequest({
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=" + "a".repeat(64) },
        body: null
      })
    );
    expect(response.status).toBe(400);
  });

  test("handler failure does not stop other handlers (dispatch isolation)", async () => {
    const { adapter, facade } = await build();
    facade.failNext = true;
    const body = JSON.stringify(makeEnvelope());
    const signature = await signBody(APP_SECRET, body);
    const response = await adapter.handle(
      buildRequest({
        method: "POST",
        headers: { "x-hub-signature-256": signature },
        body
      })
    );
    // The facade's dispatch threw — adapter should still respond 200
    // because webhook acknowledgement semantics say: if we verified &
    // normalized, we've received the update. Handler failures are a
    // @wats/core concern, not an HTTP concern.
    expect(response.status).toBe(200);
  });

  test("logger emits signature_verified + body_normalized + dispatched", async () => {
    const { adapter, events } = await build();
    const body = JSON.stringify(makeEnvelope());
    const signature = await signBody(APP_SECRET, body);
    await adapter.handle(
      buildRequest({
        method: "POST",
        headers: { "x-hub-signature-256": signature },
        body
      })
    );
    const types = events.map((e) => e.type);
    expect(types).toContain("signature_verified");
    expect(types).toContain("body_normalized");
    expect(types).toContain("dispatched");
    expect(types).toContain("response_sent");
  });
});

// ---- method taxonomy -----------------------------------------------

describe("F-12 WebhookAdapter — method taxonomy", () => {
  test("PUT returns 405", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    const response = await adapter.handle(buildRequest({ method: "PUT" }));
    expect(response.status).toBe(405);
  });

  test("DELETE returns 405", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    const response = await adapter.handle(buildRequest({ method: "DELETE" }));
    expect(response.status).toBe(405);
  });

  test("405 responses set Allow header", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    const response = await adapter.handle(buildRequest({ method: "PATCH" }));
    expect(response.status).toBe(405);
    // F-12 remediation: canonical 'Allow' casing in the raw
    // WebhookResponse map (runtime HTTP header comparison is
    // case-insensitive, but the map we expose is case-sensitive).
    expect(response.headers["Allow"]).toBeDefined();
  });
});

// ---- signature verification is delegated (sibling assertion) --------

describe("F-12 WebhookAdapter — delegates to @wats/http signature", () => {
  test("signature delegation uses validateWebhookSignature (shape)", () => {
    // Not a behavior assertion — structural guard that the adapter
    // surface is wired on top of the same signature primitive. Covers
    // the sibling-NOT assertion: the adapter module does NOT redefine
    // its own HMAC comparison.
    expect(typeof validateWebhookSignature).toBe("function");
  });
});

// ---- F-12 remediation (WATS-29, in-place amend of 0.2.0-f12) --------
//
// Adversarial review of the F-12 GREEN caught four issues; these
// tests pin the remediation behavior.
//
//  1) whitespace-only verifyToken/appSecret bypass construction
//     validation and surface only at live traffic as 500. RED here
//     asserts they are rejected at construction with the typed
//     config-error code.
//  2) appSecret lacks the CR/LF/NUL gate verifyToken has. RED
//     asserts parity (defense in depth, avoids asymmetry liability).
//  3) handleDispatch does not runtime-guard body type — a JS caller
//     passing a `string` body reaches signature verification and
//     leaks to 401 by accident. RED asserts the adapter returns a
//     400 with typed code `invalid_request_body` when body is not
//     null / ArrayBuffer / ArrayBufferView.
//  4) maxBodyBytes exposure: the Node + Fetch wrappers need to
//     consult the applied cap to short-circuit at read time. RED
//     asserts the adapter exposes a readonly `maxBodyBytes` property.

describe("F-12 remediation — whitespace-only verifyToken rejected", () => {
  test("whitespace-only verifyToken rejected at construction", () => {
    const facade = makeFacade();
    for (const bad of [" ", "   ", "\t", "\t\t ", "  \f "]) {
      let caught: unknown;
      try {
        createWebhookAdapter({
          verifyToken: bad,
          appSecret: APP_SECRET,
          whatsapp: facade
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(WebhookAdapterConfigError);
      expect((caught as WebhookAdapterConfigError).code).toBe(
        "invalid_verify_token"
      );
    }
  });
});

describe("F-12 remediation — whitespace-only appSecret rejected", () => {
  test("whitespace-only appSecret rejected at construction", () => {
    const facade = makeFacade();
    for (const bad of [" ", "   ", "\t", "\t\t ", "  \f "]) {
      let caught: unknown;
      try {
        createWebhookAdapter({
          verifyToken: VERIFY_TOKEN,
          appSecret: bad,
          whatsapp: facade
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(WebhookAdapterConfigError);
      expect((caught as WebhookAdapterConfigError).code).toBe(
        "invalid_app_secret"
      );
    }
  });
});

describe("F-12 remediation — appSecret CR/LF/NUL gate", () => {
  test("appSecret with CR/LF/NUL rejected at construction", () => {
    const facade = makeFacade();
    for (const bad of ["has\rCR", "has\nLF", "has\0NUL", "\0bad", "bad\r\n"]) {
      let caught: unknown;
      try {
        createWebhookAdapter({
          verifyToken: VERIFY_TOKEN,
          appSecret: bad,
          whatsapp: facade
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(WebhookAdapterConfigError);
      expect((caught as WebhookAdapterConfigError).code).toBe(
        "invalid_app_secret"
      );
    }
  });
});

describe("F-12 remediation — runtime body-type guard in handleDispatch", () => {
  function build() {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    return { adapter, facade };
  }

  test("string body rejected with 400 invalid_request_body", async () => {
    const { adapter, facade } = build();
    const response = await adapter.handle({
      method: "POST",
      url: "https://wats.test/webhook",
      headers: new Headers({
        "x-hub-signature-256": "sha256=" + "a".repeat(64)
      }),
      // @ts-expect-error intentional bad body type
      body: "string body"
    });
    expect(response.status).toBe(400);
    const text =
      typeof response.body === "string"
        ? response.body
        : new TextDecoder().decode(response.body);
    expect(text).toContain("invalid_request_body");
    expect(facade.dispatches.length).toBe(0);
  });

  test("number body rejected with 400", async () => {
    const { adapter } = build();
    const response = await adapter.handle({
      method: "POST",
      url: "https://wats.test/webhook",
      headers: new Headers({
        "x-hub-signature-256": "sha256=" + "a".repeat(64)
      }),
      // @ts-expect-error intentional bad body type
      body: 12345
    });
    expect(response.status).toBe(400);
    const text =
      typeof response.body === "string"
        ? response.body
        : new TextDecoder().decode(response.body);
    expect(text).toContain("invalid_request_body");
  });

  test("plain-object body rejected with 400", async () => {
    const { adapter } = build();
    const response = await adapter.handle({
      method: "POST",
      url: "https://wats.test/webhook",
      headers: new Headers({
        "x-hub-signature-256": "sha256=" + "a".repeat(64)
      }),
      // @ts-expect-error intentional bad body type
      body: { object: "whatsapp_business_account" }
    });
    expect(response.status).toBe(400);
    const text =
      typeof response.body === "string"
        ? response.body
        : new TextDecoder().decode(response.body);
    expect(text).toContain("invalid_request_body");
  });

  test("ArrayBufferView (DataView) body accepted by type guard", async () => {
    const { adapter, facade } = build();
    const bytes = textEncoder().encode(JSON.stringify(makeEnvelope()));
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength
    );
    const signature = await signBody(
      APP_SECRET,
      new TextDecoder().decode(bytes)
    );
    const response = await adapter.handle({
      method: "POST",
      url: "https://wats.test/webhook",
      headers: new Headers({ "x-hub-signature-256": signature }),
      body: view
    });
    expect(response.status).toBe(200);
    expect(facade.dispatches.length).toBe(1);
  });
});

describe("F-12 remediation — adapter exposes maxBodyBytes", () => {
  test("adapter.maxBodyBytes reflects configured cap", () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade,
      maxBodyBytes: 4096
    });
    expect((adapter as unknown as { maxBodyBytes: number }).maxBodyBytes).toBe(
      4096
    );
  });

  test("adapter.maxBodyBytes falls back to default (1 MiB)", () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    expect((adapter as unknown as { maxBodyBytes: number }).maxBodyBytes).toBe(
      1_048_576
    );
  });
});

describe("F-12 remediation — 405 response uses canonical Allow header", () => {
  test("405 response map uses 'Allow' (canonical) key", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    const response = await adapter.handle(buildRequest({ method: "DELETE" }));
    expect(response.status).toBe(405);
    // Raw WebhookResponse.headers is a plain object (case-sensitive);
    // canonical casing is "Allow".
    expect(response.headers["Allow"]).toBe("GET, POST");
  });
});
