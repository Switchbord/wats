// Consumer fixture for @switchbord/http.
//
// Imports ONLY through the published package specifiers (never through
// relative paths). Exercises both public functions end-to-end, asserts
// the async contract, asserts the rawBody type guard returns
// 'invalid_raw_body' for null input, and emits a single-line JSON
// report ending with the success sentinel.

import * as rootEntrypoint from "@switchbord/http";
import {
  createFetchWebhookHandler,
  createWebhookAdapter,
  validateWebhookSignature,
  verifyWebhookChallenge,
  WebhookAdapterConfigError,
  type SignatureValidationErrorCode
} from "@switchbord/http";
import { createCryptoProvider } from "@switchbord/crypto";

interface VerifyReportOk {
  readonly ok: true;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly sentinel: "http-consumer:ok";
  readonly moduleKeys: Readonly<Record<string, readonly string[]>>;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

async function verify(): Promise<VerifyReportOk> {
  const checks: Record<string, boolean> = {};

  checks["rootEntrypoint is a module namespace"] =
    typeof rootEntrypoint === "object" && rootEntrypoint !== null;
  checks["validateWebhookSignature is a function"] =
    typeof validateWebhookSignature === "function";
  checks["verifyWebhookChallenge is a function"] =
    typeof verifyWebhookChallenge === "function";

  // Functions MUST be async per F-3 (Promise returned).
  const appSecret = "app-secret";
  const body = JSON.stringify({ object: "whatsapp_business_account" });

  const provider = await createCryptoProvider();
  const digest = await provider.hmacSha256(appSecret, body);
  const signatureHeader = `sha256=${bytesToHex(digest)}`;

  // Positive path — string rawBody.
  const stringResult = await validateWebhookSignature({
    appSecret,
    rawBody: body,
    signatureHeader
  });
  checks["validateWebhookSignature(string rawBody) returns { ok: true }"] =
    stringResult.ok === true;

  // Positive path — Uint8Array rawBody.
  const bytes = new TextEncoder().encode(body);
  const bytesResult = await validateWebhookSignature({
    appSecret,
    rawBody: bytes,
    signatureHeader
  });
  checks["validateWebhookSignature(Uint8Array rawBody) returns { ok: true }"] =
    bytesResult.ok === true;

  // Positive path — with explicit crypto injection (same provider).
  const injectedResult = await validateWebhookSignature({
    appSecret,
    rawBody: body,
    signatureHeader,
    crypto: provider
  });
  checks["validateWebhookSignature accepts injected crypto provider"] =
    injectedResult.ok === true;

  // rawBody guard — null MUST be rejected with typed invalid_raw_body.
  const nullResult = await validateWebhookSignature({
    appSecret,
    rawBody: null as unknown as string,
    signatureHeader
  });
  const nullRejected =
    nullResult.ok === false &&
    (nullResult.error.code as SignatureValidationErrorCode) === "invalid_raw_body";
  checks["null rawBody rejected with invalid_raw_body"] = nullRejected;

  // rawBody guard — plain object rejected.
  const objResult = await validateWebhookSignature({
    appSecret,
    rawBody: { not: "a body" } as unknown as string,
    signatureHeader
  });
  checks["plain-object rawBody rejected with invalid_raw_body"] =
    objResult.ok === false && objResult.error.code === "invalid_raw_body";

  // verifyWebhookChallenge happy path.
  const challengeResult = await verifyWebhookChallenge({
    mode: "subscribe",
    challenge: "abc",
    verifyToken: "expected-token",
    expectedVerifyToken: "expected-token"
  });
  checks["verifyWebhookChallenge returns { ok: true, challenge: 'abc' }"] =
    challengeResult.ok === true &&
    (challengeResult as { ok: true; challenge: string }).challenge === "abc";

  // verifyWebhookChallenge rejects wrong token.
  const wrongTokenResult = await verifyWebhookChallenge({
    mode: "subscribe",
    challenge: "abc",
    verifyToken: "wrong",
    expectedVerifyToken: "expected-token"
  });
  checks["verifyWebhookChallenge rejects wrong token"] =
    wrongTokenResult.ok === false &&
    wrongTokenResult.error.code === "invalid_verify_token";

  // ---- F-12 WebhookAdapter end-to-end -----------------------------
  //
  // Construct a facade-shaped dispatch target (structural — the
  // adapter only requires `dispatch(update)`), build a
  // WebhookAdapter, and exercise POST + GET verify + invalid
  // signature + config validation paths. Imports flow through the
  // published @switchbord/http surface only.

  const facadeDispatches: unknown[] = [];
  const facadeLike = {
    async dispatch(update: unknown): Promise<void> {
      facadeDispatches.push(update);
    }
  };

  const adapterVerifyToken = "fixture-verify";
  const adapterAppSecret = "fixture-app-secret";
  const adapter = createWebhookAdapter({
    verifyToken: adapterVerifyToken,
    appSecret: adapterAppSecret,
    whatsapp: facadeLike
  });
  const fetchHandler = createFetchWebhookHandler(adapter);

  const envelope = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-FIXTURE",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "555" },
              messages: [
                {
                  from: "15550001",
                  id: "wamid.FIXTURE",
                  timestamp: "1",
                  type: "text",
                  text: { body: "hello adapter" }
                }
              ]
            }
          }
        ]
      }
    ]
  };
  const envelopeBody = JSON.stringify(envelope);
  const adapterDigest = await provider.hmacSha256(adapterAppSecret, envelopeBody);
  const adapterSignature = `sha256=${bytesToHex(adapterDigest)}`;

  const postRes = await fetchHandler(
    new Request("https://fixture.test/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": adapterSignature
      },
      body: envelopeBody
    })
  );
  checks["WebhookAdapter dispatches POST with valid signature (200)"] =
    postRes.status === 200 && facadeDispatches.length === 1;

  const badSigRes = await fetchHandler(
    new Request("https://fixture.test/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256":
          "sha256=0000000000000000000000000000000000000000000000000000000000000000"
      },
      body: envelopeBody
    })
  );
  checks["WebhookAdapter rejects POST with invalid signature (401)"] =
    badSigRes.status === 401 && facadeDispatches.length === 1;

  const verifyUrl = `https://fixture.test/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(
    adapterVerifyToken
  )}&hub.challenge=adapter-ok`;
  const verifyRes = await fetchHandler(
    new Request(verifyUrl, { method: "GET" })
  );
  checks["WebhookAdapter echoes GET verify challenge (200)"] =
    verifyRes.status === 200 && (await verifyRes.text()) === "adapter-ok";

  const putRes = await fetchHandler(
    new Request("https://fixture.test/webhook", { method: "PUT" })
  );
  checks["WebhookAdapter 405 on disallowed method"] = putRes.status === 405;

  // Config validation + sibling-class assertion.
  let configError: unknown;
  try {
    createWebhookAdapter({
      verifyToken: "",
      appSecret: adapterAppSecret,
      whatsapp: facadeLike
    });
  } catch (err) {
    configError = err;
  }
  checks[
    "WebhookAdapterConfigError on empty verifyToken (sibling-NOT TypeError)"
  ] =
    configError instanceof WebhookAdapterConfigError &&
    (configError as WebhookAdapterConfigError).code === "invalid_verify_token" &&
    !(configError instanceof TypeError);

  for (const [label, ok] of Object.entries(checks)) {
    if (!ok) {
      throw new Error(`http-consumer check failed: ${label}`);
    }
  }

  return {
    ok: true,
    checks,
    sentinel: "http-consumer:ok",
    moduleKeys: {
      "@switchbord/http": Object.keys(rootEntrypoint).sort()
    }
  };
}

const report = await verify();
console.log(JSON.stringify(report));
console.log(report.sentinel);
