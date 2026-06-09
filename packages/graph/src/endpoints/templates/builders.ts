// WATS-65 message-template component and body builders.

import type {
  CreateMessageTemplateBody,
  TemplateBodyComponentInput,
  TemplateButtonInput,
  TemplateButtonsComponentInput,
  TemplateComponent,
  TemplateFooterComponentInput,
  TemplateHeaderComponentInput,
  TemplateSupportedAppInput,
  UpdateMessageTemplateBody
} from "./types.js";
import {
  TEMPLATE_MAX_BUTTONS,
  TEMPLATE_SHORT_TEXT_MAX_LENGTH,
  TEMPLATE_TEXT_MAX_LENGTH,
  assertArray,
  assertPlainRecord,
  assertString,
  mapCommonBodyFields,
  maybeExample,
  normalizeComponents,
  validationError
} from "./shared.js";

export function buildCreateMessageTemplateBody(input: CreateMessageTemplateBody): Record<string, unknown> {
  const record = assertPlainRecord(input, "createMessageTemplate");
  const out = mapCommonBodyFields(record, "createMessageTemplate");
  out.name = assertString(record.name, "name", "createMessageTemplate");
  out.language = assertString(record.language, "language", "createMessageTemplate", 64);
  out.category = assertString(record.category, "category", "createMessageTemplate", 64);
  out.components = normalizeComponents(record.components, "createMessageTemplate", true);
  return out;
}

export function buildUpdateMessageTemplateBody(input: UpdateMessageTemplateBody): Record<string, unknown> {
  const record = assertPlainRecord(input, "updateMessageTemplate");
  const out = mapCommonBodyFields(record, "updateMessageTemplate");
  if (record.category !== undefined) out.category = assertString(record.category, "category", "updateMessageTemplate", 64);
  return out;
}

export function buildTemplateHeaderComponent(input: TemplateHeaderComponentInput | TemplateComponent): TemplateComponent {
  const record = assertPlainRecord(input, "buildTemplateHeaderComponent");
  const format = assertString(record.format, "format", "buildTemplateHeaderComponent", 32).toUpperCase();
  const out: Record<string, unknown> = { type: "HEADER", format };
  if (format === "TEXT") out.text = assertString(record.text, "text", "buildTemplateHeaderComponent", TEMPLATE_TEXT_MAX_LENGTH);
  else if (record.text !== undefined) out.text = assertString(record.text, "text", "buildTemplateHeaderComponent", TEMPLATE_TEXT_MAX_LENGTH);
  const example = maybeExample(record.example, "buildTemplateHeaderComponent");
  if (example !== undefined) out.example = example;
  return out as TemplateComponent;
}

export function buildTemplateBodyComponent(input: TemplateBodyComponentInput | TemplateComponent): TemplateComponent {
  const record = assertPlainRecord(input, "buildTemplateBodyComponent");
  const out: Record<string, unknown> = { type: "BODY", text: assertString(record.text, "text", "buildTemplateBodyComponent", TEMPLATE_TEXT_MAX_LENGTH) };
  const example = maybeExample(record.example, "buildTemplateBodyComponent");
  if (example !== undefined) out.example = example;
  return out as TemplateComponent;
}

export function buildTemplateFooterComponent(input: TemplateFooterComponentInput | TemplateComponent): TemplateComponent {
  const record = assertPlainRecord(input, "buildTemplateFooterComponent");
  return { type: "FOOTER", text: assertString(record.text, "text", "buildTemplateFooterComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH) };
}


function normalizeSupportedApps(value: unknown): readonly Record<string, string>[] {
  const apps = assertArray(value, "button.supportedApps", 1, 10, "buildTemplateButtonComponent");
  return apps.map((entry, index) => {
    const record = assertPlainRecord(entry, "buildTemplateButtonComponent", `button.supportedApps[${index}]`);
    return {
      package_name: assertString(record.packageName, `button.supportedApps[${index}].packageName`, "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH),
      signature_hash: assertString(record.signatureHash, `button.supportedApps[${index}].signatureHash`, "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH)
    } satisfies Record<string, string>;
  });
}

function assertBoolean(value: unknown, fieldName: string, helperName: string): boolean {
  if (typeof value !== "boolean") {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be a boolean.`);
  }
  return value;
}

function normalizeButton(input: unknown, index: number): Record<string, unknown> {
  const record = assertPlainRecord(input, "buildTemplateButtonComponent", `buttons[${index}]`);
  const type = assertString(record.type, "button.type", "buildTemplateButtonComponent", 32).toUpperCase();
  const out: Record<string, unknown> = { type };
  if (record.text !== undefined) out.text = assertString(record.text, "button.text", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
  switch (type) {
    case "QUICK_REPLY":
      out.text = assertString(record.text, "button.text", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      break;
    case "URL":
      out.text = assertString(record.text, "button.text", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      out.url = assertString(record.url, "button.url", "buildTemplateButtonComponent", TEMPLATE_TEXT_MAX_LENGTH);
      break;
    case "PHONE_NUMBER":
      out.text = assertString(record.text, "button.text", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      out.phone_number = assertString(record.phoneNumber, "button.phoneNumber", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      break;
    case "COPY_CODE":
      out.example = assertString(record.example, "button.example", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      break;
    case "CATALOG":
      break;
    case "FLOW":
      out.text = assertString(record.text, "button.text", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      if (record.flowId !== undefined) out.flow_id = assertString(record.flowId, "button.flowId", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      if (record.flowName !== undefined) out.flow_name = assertString(record.flowName, "button.flowName", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      if (record.flowAction !== undefined) out.flow_action = assertString(record.flowAction, "button.flowAction", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      if (record.navigateScreen !== undefined) out.navigate_screen = assertString(record.navigateScreen, "button.navigateScreen", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      break;
    case "OTP":
      if (record.packageName !== undefined || record.signatureHash !== undefined) {
        throw validationError("Invalid buildTemplateButtonComponent input: OTP buttons must nest packageName/signatureHash under supportedApps.");
      }
      out.otp_type = assertString(record.otpType, "button.otpType", "buildTemplateButtonComponent", 32).toUpperCase();
      if (record.text !== undefined) out.text = assertString(record.text, "button.text", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      if (record.autofillText !== undefined) out.autofill_text = assertString(record.autofillText, "button.autofillText", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      if (record.zeroTapTermsAccepted !== undefined) out.zero_tap_terms_accepted = assertBoolean(record.zeroTapTermsAccepted, "button.zeroTapTermsAccepted", "buildTemplateButtonComponent");
      if (out.otp_type === "ONE_TAP" || out.otp_type === "ZERO_TAP") {
        out.supported_apps = normalizeSupportedApps(record.supportedApps);
      } else if (record.supportedApps !== undefined) {
        out.supported_apps = normalizeSupportedApps(record.supportedApps);
      }
      break;
    default:
      throw validationError(`Invalid buildTemplateButtonComponent input: unsupported button type ${JSON.stringify(type)}.`);
  }
  return out;
}

export function buildTemplateButtonComponent(input: TemplateButtonsComponentInput | TemplateComponent): TemplateComponent & { readonly buttons: readonly Record<string, unknown>[] } {
  const record = assertPlainRecord(input, "buildTemplateButtonComponent");
  const rawButtons = assertArray(record.buttons, "buttons", 1, TEMPLATE_MAX_BUTTONS, "buildTemplateButtonComponent");
  const buttons: Record<string, unknown>[] = [];
  for (let index = 0; index < rawButtons.length; index += 1) {
    buttons.push(normalizeButton(rawButtons[index], index));
  }
  return { type: "BUTTONS", buttons };
}
