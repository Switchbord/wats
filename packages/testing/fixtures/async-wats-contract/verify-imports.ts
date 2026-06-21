import {
  WebhookNormalizationError,
  WhatsApp,
  createListenerRegistry,
  normalizeWebhookEnvelope,
  type TypedMessageUpdate,
  type TypedStatusUpdate,
  type TypedUpdate
} from "@wats/core";
import { createTypedFilter, isTypedFilter, message, status, type TypedFilter } from "@wats/core/filtersTyped";
import { GraphClient, PhoneNumberClient, WABAClient } from "@wats/graph";
import { createMockTransport } from "@wats/graph/testing";
import { createReliableTransport } from "@wats/graph/transport";
import { createFetchWebhookHandler, createWebhookAdapter, validateWebhookSignature, verifyWebhookChallenge } from "@wats/http";
import type { TextMessage } from "@wats/types";
import { parseConfig } from "@wats/config";

const checks: Record<string, boolean> = {};
checks.normalizeWebhookEnvelope = typeof normalizeWebhookEnvelope === "function";
checks.WebhookNormalizationError = typeof WebhookNormalizationError === "function";
checks.WhatsApp = typeof WhatsApp === "function";
checks.createListenerRegistry = typeof createListenerRegistry === "function";
checks.filters = typeof createTypedFilter === "function" && isTypedFilter(message) && isTypedFilter(status);
checks.graph = typeof GraphClient === "function" && typeof PhoneNumberClient === "function" && typeof WABAClient === "function";
checks.testing = typeof createMockTransport === "function";
checks.transport = typeof createReliableTransport === "function";
checks.http = typeof createWebhookAdapter === "function" && typeof createFetchWebhookHandler === "function" && typeof validateWebhookSignature === "function" && typeof verifyWebhookChallenge === "function";
checks.config = typeof parseConfig === "function";

const typedUpdate = null as unknown as TypedUpdate;
const typedMessage: TypedMessageUpdate | TypedStatusUpdate | TypedUpdate | null = typedUpdate;
const typedFilter: TypedFilter<TypedUpdate> = createTypedFilter((u): u is TypedUpdate => u.kind === "unknown", () => "unknown");
const wire: TextMessage | null = null;
checks.typesCompile = typedMessage === null && isTypedFilter(typedFilter) && wire === null;

console.log(JSON.stringify({ ok: Object.values(checks).every(Boolean), checks }));
console.log("async-wats-contract-consumer:ok");
