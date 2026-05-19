// WATS-65 message-template endpoint family types.

import type { GraphPaging } from "../wabaEndpoints.js";

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";
export type TemplateStatus =
  | "APPROVED"
  | "IN_APPEAL"
  | "PENDING"
  | "REJECTED"
  | "PENDING_DELETION"
  | "DELETED"
  | "DISABLED"
  | "PAUSED"
  | "LIMIT_EXCEEDED";
export type TemplateLanguageCode = string;
export type TemplateParameterFormat = "POSITIONAL" | "NAMED";
export type TemplateQualityScore = "GREEN" | "YELLOW" | "RED" | "UNKNOWN" | string;
export type TemplateOtpType = "COPY_CODE" | "ONE_TAP" | "ZERO_TAP" | string;
export type TemplateHeaderFormat = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";
export type TemplateButtonType =
  | "QUICK_REPLY"
  | "URL"
  | "PHONE_NUMBER"
  | "COPY_CODE"
  | "CATALOG"
  | "FLOW"
  | "OTP";

export interface TemplateComponent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface TemplateDetails {
  readonly id?: string;
  readonly name?: string;
  readonly language?: string;
  readonly status?: TemplateStatus | string;
  readonly category?: TemplateCategory | string;
  readonly components?: readonly TemplateComponent[];
  readonly parameter_format?: TemplateParameterFormat;
  readonly message_send_ttl_seconds?: number;
  readonly quality_score?: TemplateQualityScore | Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface TemplateListResponse {
  readonly data?: readonly TemplateDetails[];
  readonly paging?: GraphPaging;
}

export interface TemplateMutationResponse {
  readonly id?: string;
  readonly success?: boolean;
  readonly [key: string]: unknown;
}

export interface ListMessageTemplatesInput {
  readonly wabaId: string;
  readonly fields?: string;
  readonly status?: TemplateStatus | string;
  readonly category?: TemplateCategory | string;
  readonly language?: TemplateLanguageCode;
  readonly name?: string;
  readonly content?: string;
  readonly nameOrContent?: string;
  readonly qualityScore?: string;
  readonly limit?: string;
  readonly after?: string;
  readonly before?: string;
}

export interface GetMessageTemplateInput {
  readonly templateId: string;
  readonly fields?: string;
}

export interface CreateMessageTemplateBody {
  readonly name: string;
  readonly language: TemplateLanguageCode;
  readonly category: TemplateCategory | string;
  readonly components: readonly TemplateComponent[];
  readonly parameterFormat?: TemplateParameterFormat;
  readonly messageSendTtlSeconds?: number;
  readonly [key: string]: unknown;
}

export interface UpdateMessageTemplateBody {
  readonly category?: TemplateCategory | string;
  readonly components?: readonly TemplateComponent[];
  readonly parameterFormat?: TemplateParameterFormat;
  readonly messageSendTtlSeconds?: number;
  readonly [key: string]: unknown;
}

export interface DeleteMessageTemplateInput {
  readonly wabaId: string;
  readonly name: string;
  /** Maps to Graph query parameter `hsm_id`. */
  readonly templateId?: string;
}

export interface TemplateHeaderComponentInput {
  readonly format: TemplateHeaderFormat;
  readonly text?: string;
  readonly example?: unknown;
  readonly [key: string]: unknown;
}

export interface TemplateBodyComponentInput {
  readonly text: string;
  readonly example?: unknown;
  readonly [key: string]: unknown;
}

export interface TemplateFooterComponentInput {
  readonly text: string;
  readonly [key: string]: unknown;
}

export interface TemplateSupportedAppInput {
  readonly packageName: string;
  readonly signatureHash: string;
  readonly [key: string]: unknown;
}

export type TemplateButtonInput =
  | { readonly type: "QUICK_REPLY"; readonly text: string; readonly [key: string]: unknown }
  | { readonly type: "URL"; readonly text: string; readonly url: string; readonly [key: string]: unknown }
  | { readonly type: "PHONE_NUMBER"; readonly text: string; readonly phoneNumber: string; readonly [key: string]: unknown }
  | { readonly type: "COPY_CODE"; readonly example: string; readonly [key: string]: unknown }
  | { readonly type: "CATALOG"; readonly text?: string; readonly [key: string]: unknown }
  | { readonly type: "FLOW"; readonly text: string; readonly flowId?: string; readonly flowName?: string; readonly flowAction?: string; readonly navigateScreen?: string; readonly [key: string]: unknown }
  | { readonly type: "OTP"; readonly otpType: TemplateOtpType; readonly text?: string; readonly supportedApps?: readonly TemplateSupportedAppInput[]; readonly [key: string]: unknown };

export interface TemplateButtonsComponentInput {
  readonly buttons: readonly TemplateButtonInput[];
  readonly [key: string]: unknown;
}

export interface TemplateDefinitionForValidation {
  readonly parameterFormat?: TemplateParameterFormat;
  readonly parameter_format?: TemplateParameterFormat;
  readonly components: readonly TemplateComponent[];
}

export type SendTemplateComponentForValidation = {
  readonly type: string;
  readonly subType?: string;
  readonly sub_type?: string;
  readonly index?: string;
  readonly parameters?: readonly unknown[];
  readonly [key: string]: unknown;
};
