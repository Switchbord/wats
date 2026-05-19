import { describe, expect, test } from "bun:test";
import {
  createGraphApiError,
  GraphApiError,
  GraphAuthError,
  GraphRateLimitError,
  type GraphApiErrorPayload
} from "../src/errors";
import {
  InvalidParameterError,
  InvalidTemplateParameterError,
  MarketingMessagesLiteInvalidFlowError,
  MarketingMessagesLiteUnsupportedMessageTypeError,
  MarketingMessagesLiteUnsupportedTemplateCategoryError,
  MarketingMessagesLiteUnsupportedTemplateStructureError,
  TemplateClassificationRateLimitError,
  UserStoppedMarketingMessagesError
} from "../src/errorSubclasses";
import { resolveRegisteredError, type GraphErrorFactoryContext } from "../src/errorRegistry";

function ctx(code: number, message: string, status = 400): GraphErrorFactoryContext {
  return {
    status,
    payload: { code, message, type: "OAuthException", fbtrace_id: `trace-${code}` } as GraphApiErrorPayload,
    headers: new Headers(),
    requestUrl: "https://graph.facebook.com/v25.0/test"
  };
}

describe("WATS-92 v21-v25 WhatsApp and Marketing Messages error registry refresh", () => {
  const cases = [
    {
      code: 131050,
      name: "UserStoppedMarketingMessagesError",
      ctor: UserStoppedMarketingMessagesError,
      message: "User stopped marketing messages."
    },
    {
      code: 132018,
      name: "InvalidTemplateParameterError",
      ctor: InvalidTemplateParameterError,
      message: "Template message has invalid parameters."
    },
    {
      code: 131064,
      name: "TemplateClassificationRateLimitError",
      ctor: TemplateClassificationRateLimitError,
      message: "Template classification reached its rate limit."
    },
    {
      code: 134100,
      name: "MarketingMessagesLiteUnsupportedMessageTypeError",
      ctor: MarketingMessagesLiteUnsupportedMessageTypeError,
      message: "Marketing Messages Lite does not support this message type."
    },
    {
      code: 134101,
      name: "MarketingMessagesLiteUnsupportedTemplateCategoryError",
      ctor: MarketingMessagesLiteUnsupportedTemplateCategoryError,
      message: "Marketing Messages Lite does not support this template category."
    },
    {
      code: 134102,
      name: "MarketingMessagesLiteInvalidFlowError",
      ctor: MarketingMessagesLiteInvalidFlowError,
      message: "Marketing Messages Lite Flow is invalid."
    },
    {
      code: 134103,
      name: "MarketingMessagesLiteUnsupportedTemplateStructureError",
      ctor: MarketingMessagesLiteUnsupportedTemplateStructureError,
      message: "Marketing Messages Lite does not support this template structure."
    }
  ] as const;

  for (const testCase of cases) {
    test(`code ${testCase.code} resolves to ${testCase.name}`, () => {
      const entry = resolveRegisteredError(testCase.code, undefined);
      expect(entry?.errorName).toBe(testCase.name);
      const instance = entry?.factory(ctx(testCase.code, testCase.message));
      expect(instance).toBeInstanceOf(testCase.ctor);
      expect(instance).toBeInstanceOf(GraphApiError);
      expect(instance).not.toBeInstanceOf(GraphAuthError);
      expect(instance).not.toBeInstanceOf(GraphRateLimitError);
      expect(instance?.payload?.fbtrace_id).toBe(`trace-${testCase.code}`);
    });
  }

  test("registry-first createGraphApiError constructs new WATS-92 subclasses at 4xx", () => {
    const invalidTemplate = createGraphApiError({
      status: 400,
      payload: { code: 132018, message: "Invalid template parameter", type: "OAuthException" }
    });
    const classificationLimit = createGraphApiError({
      status: 400,
      payload: { code: 131064, message: "Template classification rate limit", type: "OAuthException" }
    });
    const liteDiagnostic = createGraphApiError({
      status: 400,
      payload: { code: 134103, message: "Unsupported Marketing Messages Lite template structure", type: "OAuthException" }
    });

    expect(invalidTemplate).toBeInstanceOf(InvalidTemplateParameterError);
    expect(invalidTemplate).not.toBeInstanceOf(InvalidParameterError);
    expect(classificationLimit).toBeInstanceOf(TemplateClassificationRateLimitError);
    expect(classificationLimit).not.toBeInstanceOf(GraphRateLimitError);
    expect(liteDiagnostic).toBeInstanceOf(MarketingMessagesLiteUnsupportedTemplateStructureError);
    expect(liteDiagnostic).not.toBeInstanceOf(GraphAuthError);
  });
});
