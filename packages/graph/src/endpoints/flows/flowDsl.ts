// WATS-76 slice A — typed camelCase Flow DSL builders.
//
// Public WATS Flow DSL is camelCase. The SERIALIZED FlowJSON wire keys follow
// pywa's rule: field-name underscores become HYPHENS on the wire
// (on-click-action, data-source, init-value, min-chars, error-message, ...),
// EXCEPT four keys that keep underscores at the FlowJSON top level
// (routing_model, data_api_version, data_channel_uri, refresh_on_back), and the
// If component's `else_` field which serializes to "else".
//
// Mapping is done explicitly per field (NOT via a blind camel→snake/hyphen
// converter) because of the hyphen rule + 4 exceptions + the else case.
//
// Components carry a `type` discriminator (wire string table §A.4). Actions
// carry a `name` discriminator (§A.6), never `type`. Undefined fields are
// dropped. Enums emit their string value.

import type { FlowJson } from "./types.js";
import { flowJsonClone } from "./flowJson.js";
import {
  FLOW_JSON_MAX_ARRAY_LENGTH,
  flowArray,
  flowAssertPlainRecord,
  flowError,
  flowHasControlChar,
  flowIsUnsafeObjectKey,
  flowString
} from "./shared.js";

/**
 * Maximum nesting depth of control-flow components (If / Switch) inside a
 * single component subtree. Finite cap so the DSL cannot emit pathologically
 * nested conditional trees that would later blow the FlowJSON depth budget.
 */
export const FLOW_DSL_MAX_CONTROL_DEPTH = 5;

type WireEntry = readonly [string, unknown];
type WireObject = Record<string, unknown>;

function wire(entries: readonly WireEntry[]): WireObject {
  const out: WireObject = {};
  for (const [key, value] of entries) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Primitive validators (reuse shared.ts taxonomy: GraphRequestValidationError)
// ---------------------------------------------------------------------------

function assertProps(value: unknown, helper: string): WireObject {
  return flowAssertPlainRecord(value, helper);
}

function reqString(value: unknown, field: string, helper: string, max = 4_096): string {
  return flowString(value, field, helper, max);
}

function optString(value: unknown, field: string, helper: string, max = 4_096): string | undefined {
  if (value === undefined) return undefined;
  return flowString(value, field, helper, max);
}

function optBool(value: unknown, field: string, helper: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw flowError(`Invalid ${helper} input: ${field} must be a boolean.`);
  }
  return value;
}

function optInt(value: unknown, field: string, helper: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw flowError(`Invalid ${helper} input: ${field} must be an integer.`);
  }
  return value;
}

function reqEnum<T extends string>(value: unknown, field: string, helper: string, allowed: readonly T[]): T {
  const str = flowString(value, field, helper, 256);
  if (!allowed.includes(str as T)) {
    throw flowError(`Invalid ${helper} input: ${field} must be one of ${allowed.join(", ")}.`);
  }
  return str as T;
}

function optEnum<T extends string>(value: unknown, field: string, helper: string, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  return reqEnum(value, field, helper, allowed);
}

function optStringArray(value: unknown, field: string, helper: string, min = 0): string[] | undefined {
  if (value === undefined) return undefined;
  const arr = flowArray(value, field, min, FLOW_JSON_MAX_ARRAY_LENGTH, helper);
  return arr.map((item, index) => flowString(item, `${field}[${index}]`, helper, 4_096));
}

/** TextBody/TextCaption/RichText `text` accepts a string or string[]. */
function reqTextValue(value: unknown, field: string, helper: string): string | string[] {
  if (Array.isArray(value)) {
    const arr = flowArray(value, field, 1, FLOW_JSON_MAX_ARRAY_LENGTH, helper);
    return arr.map((item, index) => flowString(item, `${field}[${index}]`, helper, 16_384));
  }
  return flowString(value, field, helper, 16_384);
}

/**
 * Deep-clone + validate an arbitrary caller record (payload, data, metadata,
 * init-values, cases, ...). Rejects __proto__/constructor/prototype keys,
 * control chars, cycles, and non-JSON-serializable values via flowJsonClone.
 */
function cloneRecord(value: unknown, field: string, helper: string): WireObject {
  flowAssertPlainRecord(value, helper, field);
  return flowJsonClone(value, helper, field) as WireObject;
}

function optRecord(value: unknown, field: string, helper: string): WireObject | undefined {
  if (value === undefined) return undefined;
  return cloneRecord(value, field, helper);
}

/** Deep-clone + validate an array of already-built child components. */
function cloneChildren(value: unknown, field: string, helper: string, min: number): unknown[] {
  flowArray(value, field, min, FLOW_JSON_MAX_ARRAY_LENGTH, helper);
  return flowJsonClone(value, helper, field) as unknown[];
}

/** Action props can be either a built action object or a "${...}" ref string. */
function optAction(value: unknown, field: string, helper: string): unknown {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    if (flowHasControlChar(value) || value.length === 0) {
      throw flowError(`Invalid ${helper} input: ${field} must be a non-empty action ref string.`);
    }
    return value;
  }
  return cloneRecord(value, field, helper);
}

/** DataSource fields accept a built DataSource[] or a "${data.KEY}" ref. */
function dataSourceValue(value: unknown, field: string, helper: string): unknown {
  if (typeof value === "string") {
    return flowString(value, field, helper, 4_096);
  }
  return cloneChildren(value, field, helper, 1);
}

// ---------------------------------------------------------------------------
// Control-flow depth guard
// ---------------------------------------------------------------------------

function maxControlDepth(value: unknown): number {
  if (Array.isArray(value)) {
    let max = 0;
    for (const item of value) max = Math.max(max, maxControlDepth(item));
    return max;
  }
  if (value !== null && typeof value === "object") {
    const record = value as WireObject;
    let childMax = 0;
    for (const nested of Object.values(record)) {
      childMax = Math.max(childMax, maxControlDepth(nested));
    }
    if (record.type === "If" || record.type === "Switch") return 1 + childMax;
    return childMax;
  }
  return 0;
}

function assertControlDepth(node: WireObject, helper: string): void {
  if (maxControlDepth(node) > FLOW_DSL_MAX_CONTROL_DEPTH) {
    throw flowError(
      `Invalid ${helper} input: control-flow nesting exceeds maximum depth ${FLOW_DSL_MAX_CONTROL_DEPTH}.`
    );
  }
}

// ===========================================================================
// §A.1 — FlowJSON
// ===========================================================================

export interface FlowJsonProps {
  readonly version: string;
  readonly screens: readonly unknown[];
  readonly dataApiVersion?: string;
  readonly routingModel?: Record<string, readonly string[]>;
  readonly dataChannelUri?: string;
}

export function flowJson(props: FlowJsonProps): FlowJson {
  const record = assertProps(props, "flowJson");
  const version = reqString(record.version, "version", "flowJson", 64);
  const screens = cloneChildren(record.screens, "screens", "flowJson", 1);
  let routingModel: WireObject | undefined;
  if (record.routingModel !== undefined) {
    const rm = cloneRecord(record.routingModel, "routingModel", "flowJson");
    for (const [key, value] of Object.entries(rm)) {
      flowArray(value, `routingModel.${key}`, 0, FLOW_JSON_MAX_ARRAY_LENGTH, "flowJson");
    }
    routingModel = rm;
  }
  // NOTE: data_api_version / routing_model / data_channel_uri KEEP underscores.
  return wire([
    ["version", version],
    ["screens", screens],
    ["data_api_version", optString(record.dataApiVersion, "dataApiVersion", "flowJson", 64)],
    ["routing_model", routingModel],
    ["data_channel_uri", optString(record.dataChannelUri, "dataChannelUri", "flowJson", 2_048)]
  ]);
}

// ===========================================================================
// §A.2 — Screen
// ===========================================================================

export interface ScreenProps {
  readonly id: string;
  readonly layout: unknown;
  readonly title?: string;
  readonly data?: Record<string, unknown>;
  readonly terminal?: boolean;
  readonly success?: boolean;
  readonly refreshOnBack?: boolean;
  readonly sensitive?: readonly string[];
}

export function screen(props: ScreenProps): WireObject {
  const record = assertProps(props, "screen");
  const id = reqString(record.id, "id", "screen", 256);
  const layout = cloneRecord(record.layout, "layout", "screen");
  // NOTE: refresh_on_back KEEPS underscores.
  return wire([
    ["id", id],
    ["layout", layout],
    ["title", optString(record.title, "title", "screen", 1_024)],
    ["data", optRecord(record.data, "data", "screen")],
    ["terminal", optBool(record.terminal, "terminal", "screen")],
    ["success", optBool(record.success, "success", "screen")],
    ["refresh_on_back", optBool(record.refreshOnBack, "refreshOnBack", "screen")],
    ["sensitive", optStringArray(record.sensitive, "sensitive", "screen")]
  ]);
}

// ===========================================================================
// §A.3 — Layout / Form
// ===========================================================================

export function singleColumnLayout(children: readonly unknown[]): WireObject {
  const cloned = cloneChildren(children, "children", "singleColumnLayout", 1);
  return { type: "SingleColumnLayout", children: cloned };
}

export interface FormProps {
  readonly name: string;
  readonly children: readonly unknown[];
  readonly initValues?: Record<string, unknown>;
  readonly errorMessages?: Record<string, unknown>;
}

export function form(props: FormProps): WireObject {
  const record = assertProps(props, "form");
  return wire([
    ["type", "Form"],
    ["name", reqString(record.name, "name", "form", 256)],
    ["children", cloneChildren(record.children, "children", "form", 1)],
    ["init-values", optRecord(record.initValues, "initValues", "form")],
    ["error-messages", optRecord(record.errorMessages, "errorMessages", "form")]
  ]);
}

// ===========================================================================
// §A.4 / §A.5 — Components
// ===========================================================================

// --- Text components -------------------------------------------------------

export function textHeading(props: { text: string; visible?: boolean }): WireObject {
  const r = assertProps(props, "textHeading");
  return wire([
    ["type", "TextHeading"],
    ["text", reqString(r.text, "text", "textHeading", 16_384)],
    ["visible", optBool(r.visible, "visible", "textHeading")]
  ]);
}

export function textSubheading(props: { text: string; visible?: boolean }): WireObject {
  const r = assertProps(props, "textSubheading");
  return wire([
    ["type", "TextSubheading"],
    ["text", reqString(r.text, "text", "textSubheading", 16_384)],
    ["visible", optBool(r.visible, "visible", "textSubheading")]
  ]);
}

const FONT_WEIGHTS = ["normal", "bold", "italic", "bold_italic"] as const;

export function textBody(props: {
  text: string | readonly string[];
  markdown?: boolean;
  fontWeight?: string;
  strikethrough?: boolean;
  visible?: boolean;
}): WireObject {
  const r = assertProps(props, "textBody");
  return wire([
    ["type", "TextBody"],
    ["text", reqTextValue(r.text, "text", "textBody")],
    ["markdown", optBool(r.markdown, "markdown", "textBody")],
    ["font-weight", optEnum(r.fontWeight, "fontWeight", "textBody", FONT_WEIGHTS)],
    ["strikethrough", optBool(r.strikethrough, "strikethrough", "textBody")],
    ["visible", optBool(r.visible, "visible", "textBody")]
  ]);
}

export function textCaption(props: {
  text: string | readonly string[];
  markdown?: boolean;
  fontWeight?: string;
  strikethrough?: boolean;
  visible?: boolean;
}): WireObject {
  const r = assertProps(props, "textCaption");
  return wire([
    ["type", "TextCaption"],
    ["text", reqTextValue(r.text, "text", "textCaption")],
    ["markdown", optBool(r.markdown, "markdown", "textCaption")],
    ["font-weight", optEnum(r.fontWeight, "fontWeight", "textCaption", FONT_WEIGHTS)],
    ["strikethrough", optBool(r.strikethrough, "strikethrough", "textCaption")],
    ["visible", optBool(r.visible, "visible", "textCaption")]
  ]);
}

export function richText(props: { text: string | readonly string[]; visible?: boolean }): WireObject {
  const r = assertProps(props, "richText");
  return wire([
    ["type", "RichText"],
    ["text", reqTextValue(r.text, "text", "richText")],
    ["visible", optBool(r.visible, "visible", "richText")]
  ]);
}

// --- Input components ------------------------------------------------------

const INPUT_TYPES = ["text", "number", "email", "password", "passcode", "phone"] as const;
const LABEL_VARIANTS = ["large"] as const;

export function textInput(props: {
  name: string;
  label: string;
  inputType?: string;
  labelVariant?: string;
  pattern?: string;
  required?: boolean;
  minChars?: number;
  maxChars?: number;
  helperText?: string;
  enabled?: boolean;
  visible?: boolean;
  initValue?: string;
  errorMessage?: string;
}): WireObject {
  const r = assertProps(props, "textInput");
  return wire([
    ["type", "TextInput"],
    ["name", reqString(r.name, "name", "textInput", 256)],
    ["label", reqString(r.label, "label", "textInput", 1_024)],
    ["input-type", optEnum(r.inputType, "inputType", "textInput", INPUT_TYPES)],
    ["label-variant", optEnum(r.labelVariant, "labelVariant", "textInput", LABEL_VARIANTS)],
    ["pattern", optString(r.pattern, "pattern", "textInput")],
    ["required", optBool(r.required, "required", "textInput")],
    ["min-chars", optInt(r.minChars, "minChars", "textInput")],
    ["max-chars", optInt(r.maxChars, "maxChars", "textInput")],
    ["helper-text", optString(r.helperText, "helperText", "textInput", 4_096)],
    ["enabled", optBool(r.enabled, "enabled", "textInput")],
    ["visible", optBool(r.visible, "visible", "textInput")],
    ["init-value", optString(r.initValue, "initValue", "textInput", 16_384)],
    ["error-message", optString(r.errorMessage, "errorMessage", "textInput", 4_096)]
  ]);
}

export function textArea(props: {
  name: string;
  label: string;
  labelVariant?: string;
  required?: boolean;
  maxLength?: number;
  helperText?: string;
  enabled?: boolean;
  visible?: boolean;
  initValue?: string;
  errorMessage?: string;
}): WireObject {
  const r = assertProps(props, "textArea");
  return wire([
    ["type", "TextArea"],
    ["name", reqString(r.name, "name", "textArea", 256)],
    ["label", reqString(r.label, "label", "textArea", 1_024)],
    ["label-variant", optEnum(r.labelVariant, "labelVariant", "textArea", LABEL_VARIANTS)],
    ["required", optBool(r.required, "required", "textArea")],
    ["max-length", optInt(r.maxLength, "maxLength", "textArea")],
    ["helper-text", optString(r.helperText, "helperText", "textArea", 4_096)],
    ["enabled", optBool(r.enabled, "enabled", "textArea")],
    ["visible", optBool(r.visible, "visible", "textArea")],
    ["init-value", optString(r.initValue, "initValue", "textArea", 16_384)],
    ["error-message", optString(r.errorMessage, "errorMessage", "textArea", 4_096)]
  ]);
}

// --- Selection components --------------------------------------------------

const MEDIA_SIZES = ["regular", "large"] as const;

export function checkboxGroup(props: {
  name: string;
  dataSource: unknown;
  label?: string;
  description?: string;
  minSelectedItems?: number;
  maxSelectedItems?: number;
  required?: boolean;
  visible?: boolean;
  enabled?: boolean;
  initValue?: readonly string[];
  mediaSize?: string;
  onSelectAction?: unknown;
  onUnselectAction?: unknown;
}): WireObject {
  const r = assertProps(props, "checkboxGroup");
  return wire([
    ["type", "CheckboxGroup"],
    ["name", reqString(r.name, "name", "checkboxGroup", 256)],
    ["data-source", dataSourceValue(r.dataSource, "dataSource", "checkboxGroup")],
    ["label", optString(r.label, "label", "checkboxGroup", 1_024)],
    ["description", optString(r.description, "description", "checkboxGroup", 4_096)],
    ["min-selected-items", optInt(r.minSelectedItems, "minSelectedItems", "checkboxGroup")],
    ["max-selected-items", optInt(r.maxSelectedItems, "maxSelectedItems", "checkboxGroup")],
    ["required", optBool(r.required, "required", "checkboxGroup")],
    ["visible", optBool(r.visible, "visible", "checkboxGroup")],
    ["enabled", optBool(r.enabled, "enabled", "checkboxGroup")],
    ["init-value", optStringArray(r.initValue, "initValue", "checkboxGroup")],
    ["media-size", optEnum(r.mediaSize, "mediaSize", "checkboxGroup", MEDIA_SIZES)],
    ["on-select-action", optAction(r.onSelectAction, "onSelectAction", "checkboxGroup")],
    ["on-unselect-action", optAction(r.onUnselectAction, "onUnselectAction", "checkboxGroup")]
  ]);
}

export function radioButtonsGroup(props: {
  name: string;
  dataSource: unknown;
  label?: string;
  description?: string;
  required?: boolean;
  visible?: boolean;
  enabled?: boolean;
  initValue?: string;
  mediaSize?: string;
  onSelectAction?: unknown;
  onUnselectAction?: unknown;
}): WireObject {
  const r = assertProps(props, "radioButtonsGroup");
  return wire([
    ["type", "RadioButtonsGroup"],
    ["name", reqString(r.name, "name", "radioButtonsGroup", 256)],
    ["data-source", dataSourceValue(r.dataSource, "dataSource", "radioButtonsGroup")],
    ["label", optString(r.label, "label", "radioButtonsGroup", 1_024)],
    ["description", optString(r.description, "description", "radioButtonsGroup", 4_096)],
    ["required", optBool(r.required, "required", "radioButtonsGroup")],
    ["visible", optBool(r.visible, "visible", "radioButtonsGroup")],
    ["enabled", optBool(r.enabled, "enabled", "radioButtonsGroup")],
    ["init-value", optString(r.initValue, "initValue", "radioButtonsGroup", 4_096)],
    ["media-size", optEnum(r.mediaSize, "mediaSize", "radioButtonsGroup", MEDIA_SIZES)],
    ["on-select-action", optAction(r.onSelectAction, "onSelectAction", "radioButtonsGroup")],
    ["on-unselect-action", optAction(r.onUnselectAction, "onUnselectAction", "radioButtonsGroup")]
  ]);
}

export function dropdown(props: {
  name: string;
  label: string;
  dataSource: unknown;
  enabled?: boolean;
  required?: boolean;
  visible?: boolean;
  initValue?: string;
  onSelectAction?: unknown;
  onUnselectAction?: unknown;
}): WireObject {
  const r = assertProps(props, "dropdown");
  return wire([
    ["type", "Dropdown"],
    ["name", reqString(r.name, "name", "dropdown", 256)],
    ["label", reqString(r.label, "label", "dropdown", 1_024)],
    ["data-source", dataSourceValue(r.dataSource, "dataSource", "dropdown")],
    ["enabled", optBool(r.enabled, "enabled", "dropdown")],
    ["required", optBool(r.required, "required", "dropdown")],
    ["visible", optBool(r.visible, "visible", "dropdown")],
    ["init-value", optString(r.initValue, "initValue", "dropdown", 4_096)],
    ["on-select-action", optAction(r.onSelectAction, "onSelectAction", "dropdown")],
    ["on-unselect-action", optAction(r.onUnselectAction, "onUnselectAction", "dropdown")]
  ]);
}

export function chipsSelector(props: {
  name: string;
  dataSource: unknown;
  label: string;
  description?: string;
  minSelectedItems?: number;
  maxSelectedItems?: number;
  required?: boolean;
  visible?: boolean;
  enabled?: boolean;
  initValue?: readonly string[];
  onSelectAction?: unknown;
  onUnselectAction?: unknown;
}): WireObject {
  const r = assertProps(props, "chipsSelector");
  return wire([
    ["type", "ChipsSelector"],
    ["name", reqString(r.name, "name", "chipsSelector", 256)],
    ["data-source", dataSourceValue(r.dataSource, "dataSource", "chipsSelector")],
    ["label", reqString(r.label, "label", "chipsSelector", 1_024)],
    ["description", optString(r.description, "description", "chipsSelector", 4_096)],
    ["min-selected-items", optInt(r.minSelectedItems, "minSelectedItems", "chipsSelector")],
    ["max-selected-items", optInt(r.maxSelectedItems, "maxSelectedItems", "chipsSelector")],
    ["required", optBool(r.required, "required", "chipsSelector")],
    ["visible", optBool(r.visible, "visible", "chipsSelector")],
    ["enabled", optBool(r.enabled, "enabled", "chipsSelector")],
    ["init-value", optStringArray(r.initValue, "initValue", "chipsSelector")],
    ["on-select-action", optAction(r.onSelectAction, "onSelectAction", "chipsSelector")],
    ["on-unselect-action", optAction(r.onUnselectAction, "onUnselectAction", "chipsSelector")]
  ]);
}

// --- Footer / OptIn / EmbeddedLink ----------------------------------------

export function footer(props: {
  label: string;
  onClickAction: unknown;
  leftCaption?: string;
  centerCaption?: string;
  rightCaption?: string;
  enabled?: boolean;
}): WireObject {
  const r = assertProps(props, "footer");
  return wire([
    ["type", "Footer"],
    ["label", reqString(r.label, "label", "footer", 1_024)],
    ["on-click-action", requireAction(r.onClickAction, "onClickAction", "footer")],
    ["left-caption", optString(r.leftCaption, "leftCaption", "footer", 4_096)],
    ["center-caption", optString(r.centerCaption, "centerCaption", "footer", 4_096)],
    ["right-caption", optString(r.rightCaption, "rightCaption", "footer", 4_096)],
    ["enabled", optBool(r.enabled, "enabled", "footer")]
  ]);
}

function requireAction(value: unknown, field: string, helper: string): unknown {
  if (value === undefined) {
    throw flowError(`Invalid ${helper} input: ${field} is required.`);
  }
  return optAction(value, field, helper);
}

export function optIn(props: {
  name: string;
  label: string;
  required?: boolean;
  visible?: boolean;
  initValue?: boolean;
  onClickAction?: unknown;
  onSelectAction?: unknown;
  onUnselectAction?: unknown;
}): WireObject {
  const r = assertProps(props, "optIn");
  return wire([
    ["type", "OptIn"],
    ["name", reqString(r.name, "name", "optIn", 256)],
    ["label", reqString(r.label, "label", "optIn", 4_096)],
    ["required", optBool(r.required, "required", "optIn")],
    ["visible", optBool(r.visible, "visible", "optIn")],
    ["init-value", optBool(r.initValue, "initValue", "optIn")],
    ["on-click-action", optAction(r.onClickAction, "onClickAction", "optIn")],
    ["on-select-action", optAction(r.onSelectAction, "onSelectAction", "optIn")],
    ["on-unselect-action", optAction(r.onUnselectAction, "onUnselectAction", "optIn")]
  ]);
}

export function embeddedLink(props: { text: string; onClickAction: unknown; visible?: boolean }): WireObject {
  const r = assertProps(props, "embeddedLink");
  return wire([
    ["type", "EmbeddedLink"],
    ["text", reqString(r.text, "text", "embeddedLink", 4_096)],
    ["on-click-action", requireAction(r.onClickAction, "onClickAction", "embeddedLink")],
    ["visible", optBool(r.visible, "visible", "embeddedLink")]
  ]);
}

// --- NavigationList --------------------------------------------------------

export interface NavigationItemProps {
  readonly id: string;
  readonly mainContent: Record<string, unknown>;
  readonly start?: Record<string, unknown>;
  readonly end?: Record<string, unknown>;
  readonly badge?: string;
  readonly tags?: readonly string[];
  readonly onClickAction?: unknown;
}

export function navigationItem(props: NavigationItemProps): WireObject {
  const r = assertProps(props, "navigationItem");
  return wire([
    ["id", reqString(r.id, "id", "navigationItem", 256)],
    ["main-content", cloneRecord(r.mainContent, "mainContent", "navigationItem")],
    ["start", optRecord(r.start, "start", "navigationItem")],
    ["end", optRecord(r.end, "end", "navigationItem")],
    ["badge", optString(r.badge, "badge", "navigationItem", 1_024)],
    ["tags", optStringArray(r.tags, "tags", "navigationItem")],
    ["on-click-action", optAction(r.onClickAction, "onClickAction", "navigationItem")]
  ]);
}

export function navigationList(props: {
  name: string;
  listItems: readonly unknown[];
  label?: string;
  description?: string;
  mediaSize?: string;
  onClickAction?: unknown;
}): WireObject {
  const r = assertProps(props, "navigationList");
  return wire([
    ["type", "NavigationList"],
    ["name", reqString(r.name, "name", "navigationList", 256)],
    ["list-items", cloneChildren(r.listItems, "listItems", "navigationList", 1)],
    ["label", optString(r.label, "label", "navigationList", 1_024)],
    ["description", optString(r.description, "description", "navigationList", 4_096)],
    ["media-size", optEnum(r.mediaSize, "mediaSize", "navigationList", MEDIA_SIZES)],
    ["on-click-action", optAction(r.onClickAction, "onClickAction", "navigationList")]
  ]);
}

// --- Date pickers ----------------------------------------------------------

export function datePicker(props: {
  name: string;
  label: string;
  minDate?: string;
  maxDate?: string;
  unavailableDates?: readonly string[];
  helperText?: string;
  enabled?: boolean;
  required?: boolean;
  visible?: boolean;
  initValue?: string;
  errorMessage?: string;
  onSelectAction?: unknown;
}): WireObject {
  const r = assertProps(props, "datePicker");
  return wire([
    ["type", "DatePicker"],
    ["name", reqString(r.name, "name", "datePicker", 256)],
    ["label", reqString(r.label, "label", "datePicker", 1_024)],
    ["min-date", optString(r.minDate, "minDate", "datePicker", 64)],
    ["max-date", optString(r.maxDate, "maxDate", "datePicker", 64)],
    ["unavailable-dates", optStringArray(r.unavailableDates, "unavailableDates", "datePicker")],
    ["helper-text", optString(r.helperText, "helperText", "datePicker", 4_096)],
    ["enabled", optBool(r.enabled, "enabled", "datePicker")],
    ["required", optBool(r.required, "required", "datePicker")],
    ["visible", optBool(r.visible, "visible", "datePicker")],
    ["init-value", optString(r.initValue, "initValue", "datePicker", 64)],
    ["error-message", optString(r.errorMessage, "errorMessage", "datePicker", 4_096)],
    ["on-select-action", optAction(r.onSelectAction, "onSelectAction", "datePicker")]
  ]);
}

const CALENDAR_MODES = ["single", "range"] as const;
const INCLUDE_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function calendarPicker(props: {
  name: string;
  label: string;
  title?: string;
  description?: string;
  mode?: string;
  minDate?: string;
  maxDate?: string;
  unavailableDates?: readonly string[];
  minDays?: number;
  maxDays?: number;
  includeDays?: readonly string[];
  helperText?: string;
  enabled?: boolean;
  required?: boolean;
  visible?: boolean;
  initValue?: unknown;
  errorMessage?: string;
  onSelectAction?: unknown;
}): WireObject {
  const r = assertProps(props, "calendarPicker");
  let includeDays: string[] | undefined;
  if (r.includeDays !== undefined) {
    const arr = optStringArray(r.includeDays, "includeDays", "calendarPicker") ?? [];
    for (const day of arr) {
      if (!INCLUDE_DAYS.includes(day as (typeof INCLUDE_DAYS)[number])) {
        throw flowError(`Invalid calendarPicker input: includeDays must be among ${INCLUDE_DAYS.join(", ")}.`);
      }
    }
    includeDays = arr;
  }
  let initValue: unknown;
  if (r.initValue !== undefined) {
    initValue = typeof r.initValue === "string"
      ? flowString(r.initValue, "initValue", "calendarPicker", 256)
      : cloneRecord(r.initValue, "initValue", "calendarPicker");
  }
  return wire([
    ["type", "CalendarPicker"],
    ["name", reqString(r.name, "name", "calendarPicker", 256)],
    ["label", reqString(r.label, "label", "calendarPicker", 1_024)],
    ["title", optString(r.title, "title", "calendarPicker", 1_024)],
    ["description", optString(r.description, "description", "calendarPicker", 4_096)],
    ["mode", optEnum(r.mode, "mode", "calendarPicker", CALENDAR_MODES)],
    ["min-date", optString(r.minDate, "minDate", "calendarPicker", 64)],
    ["max-date", optString(r.maxDate, "maxDate", "calendarPicker", 64)],
    ["unavailable-dates", optStringArray(r.unavailableDates, "unavailableDates", "calendarPicker")],
    ["min-days", optInt(r.minDays, "minDays", "calendarPicker")],
    ["max-days", optInt(r.maxDays, "maxDays", "calendarPicker")],
    ["include-days", includeDays],
    ["helper-text", optString(r.helperText, "helperText", "calendarPicker", 4_096)],
    ["enabled", optBool(r.enabled, "enabled", "calendarPicker")],
    ["required", optBool(r.required, "required", "calendarPicker")],
    ["visible", optBool(r.visible, "visible", "calendarPicker")],
    ["init-value", initValue],
    ["error-message", optString(r.errorMessage, "errorMessage", "calendarPicker", 4_096)],
    ["on-select-action", optAction(r.onSelectAction, "onSelectAction", "calendarPicker")]
  ]);
}

// --- Media components ------------------------------------------------------

const SCALE_TYPES = ["cover", "contain"] as const;

export function image(props: {
  src: string;
  aspectRatio: number;
  width?: number;
  height?: number;
  scaleType?: string;
  altText?: string;
  visible?: boolean;
}): WireObject {
  const r = assertProps(props, "image");
  const aspectRatio = optInt(r.aspectRatio, "aspectRatio", "image");
  if (aspectRatio === undefined) {
    throw flowError("Invalid image input: aspectRatio is required.");
  }
  return wire([
    ["type", "Image"],
    ["src", reqString(r.src, "src", "image", 1_000_000)],
    ["aspect-ratio", aspectRatio],
    ["width", optInt(r.width, "width", "image")],
    ["height", optInt(r.height, "height", "image")],
    ["scale-type", optEnum(r.scaleType, "scaleType", "image", SCALE_TYPES)],
    ["alt-text", optString(r.altText, "altText", "image", 4_096)],
    ["visible", optBool(r.visible, "visible", "image")]
  ]);
}

export interface ImageCarouselItemProps {
  readonly src: string;
  readonly altText: string;
}

export function imageCarouselItem(props: ImageCarouselItemProps): WireObject {
  const r = assertProps(props, "imageCarouselItem");
  return wire([
    ["src", reqString(r.src, "src", "imageCarouselItem", 1_000_000)],
    ["alt-text", reqString(r.altText, "altText", "imageCarouselItem", 4_096)]
  ]);
}

export function imageCarousel(props: {
  images: readonly unknown[];
  aspectRatio?: string;
  scaleType?: string;
  visible?: boolean;
}): WireObject {
  const r = assertProps(props, "imageCarousel");
  return wire([
    ["type", "ImageCarousel"],
    ["images", cloneChildren(r.images, "images", "imageCarousel", 1)],
    ["aspect-ratio", optString(r.aspectRatio, "aspectRatio", "imageCarousel", 16)],
    ["scale-type", optEnum(r.scaleType, "scaleType", "imageCarousel", SCALE_TYPES)],
    ["visible", optBool(r.visible, "visible", "imageCarousel")]
  ]);
}

const PHOTO_SOURCES = ["camera_gallery", "camera", "gallery"] as const;

export function photoPicker(props: {
  name: string;
  label: string;
  description?: string;
  photoSource?: string;
  maxFileSizeKb?: number;
  minUploadedPhotos?: number;
  maxUploadedPhotos?: number;
  enabled?: boolean;
  visible?: boolean;
  errorMessage?: string;
}): WireObject {
  const r = assertProps(props, "photoPicker");
  return wire([
    ["type", "PhotoPicker"],
    ["name", reqString(r.name, "name", "photoPicker", 256)],
    ["label", reqString(r.label, "label", "photoPicker", 1_024)],
    ["description", optString(r.description, "description", "photoPicker", 4_096)],
    ["photo-source", optEnum(r.photoSource, "photoSource", "photoPicker", PHOTO_SOURCES)],
    ["max-file-size-kb", optInt(r.maxFileSizeKb, "maxFileSizeKb", "photoPicker")],
    ["min-uploaded-photos", optInt(r.minUploadedPhotos, "minUploadedPhotos", "photoPicker")],
    ["max-uploaded-photos", optInt(r.maxUploadedPhotos, "maxUploadedPhotos", "photoPicker")],
    ["enabled", optBool(r.enabled, "enabled", "photoPicker")],
    ["visible", optBool(r.visible, "visible", "photoPicker")],
    ["error-message", optString(r.errorMessage, "errorMessage", "photoPicker", 4_096)]
  ]);
}

export function documentPicker(props: {
  name: string;
  label: string;
  description?: string;
  maxFileSizeKb?: number;
  minUploadedDocuments?: number;
  maxUploadedDocuments?: number;
  allowedMimeTypes?: readonly string[];
  enabled?: boolean;
  visible?: boolean;
  errorMessage?: string;
}): WireObject {
  const r = assertProps(props, "documentPicker");
  return wire([
    ["type", "DocumentPicker"],
    ["name", reqString(r.name, "name", "documentPicker", 256)],
    ["label", reqString(r.label, "label", "documentPicker", 1_024)],
    ["description", optString(r.description, "description", "documentPicker", 4_096)],
    ["max-file-size-kb", optInt(r.maxFileSizeKb, "maxFileSizeKb", "documentPicker")],
    ["min-uploaded-documents", optInt(r.minUploadedDocuments, "minUploadedDocuments", "documentPicker")],
    ["max-uploaded-documents", optInt(r.maxUploadedDocuments, "maxUploadedDocuments", "documentPicker")],
    ["allowed-mime-types", optStringArray(r.allowedMimeTypes, "allowedMimeTypes", "documentPicker")],
    ["enabled", optBool(r.enabled, "enabled", "documentPicker")],
    ["visible", optBool(r.visible, "visible", "documentPicker")],
    ["error-message", optString(r.errorMessage, "errorMessage", "documentPicker", 4_096)]
  ]);
}

// --- Control-flow components ----------------------------------------------

export interface IfProps {
  readonly condition: string;
  readonly then: readonly unknown[];
  readonly else?: readonly unknown[];
  readonly else_?: readonly unknown[];
}

/** If component. `else_` (Python-style) and `else` are both accepted. */
export function ifComponent(props: IfProps): WireObject {
  const r = assertProps(props, "ifComponent");
  const elseInput = r.else !== undefined ? r.else : r.else_;
  const node = wire([
    ["type", "If"],
    ["condition", reqString(r.condition, "condition", "ifComponent", 4_096)],
    ["then", cloneChildren(r.then, "then", "ifComponent", 1)],
    ["else", elseInput === undefined ? undefined : cloneChildren(elseInput, "else", "ifComponent", 1)]
  ]);
  assertControlDepth(node, "ifComponent");
  return node;
}

export interface SwitchProps {
  readonly value: string;
  readonly cases: Record<string, readonly unknown[]>;
}

export function switchComponent(props: SwitchProps): WireObject {
  const r = assertProps(props, "switchComponent");
  const casesRecord = flowAssertPlainRecord(r.cases, "switchComponent", "cases");
  const caseKeys = Object.keys(casesRecord);
  if (caseKeys.length === 0) {
    throw flowError("Invalid switchComponent input: cases must contain at least one branch.");
  }
  const cases: WireObject = {};
  for (const key of caseKeys) {
    if (flowIsUnsafeObjectKey(key)) {
      throw flowError("Invalid switchComponent input: cases contains an unsafe prototype key.");
    }
    cases[key] = cloneChildren(casesRecord[key], `cases.${key}`, "switchComponent", 1);
  }
  const node = wire([
    ["type", "Switch"],
    ["value", reqString(r.value, "value", "switchComponent", 4_096)],
    ["cases", cases]
  ]);
  assertControlDepth(node, "switchComponent");
  return node;
}

// --- DataSource (NOT a component — no `type`) ------------------------------

export function dataSource(props: {
  id: string;
  title: string;
  onSelectAction?: unknown;
  onUnselectAction?: unknown;
  description?: string;
  metadata?: Record<string, unknown>;
  enabled?: boolean;
  image?: string;
  altText?: string;
  color?: string;
}): WireObject {
  const r = assertProps(props, "dataSource");
  return wire([
    ["id", reqString(r.id, "id", "dataSource", 256)],
    ["title", reqString(r.title, "title", "dataSource", 4_096)],
    ["on-select-action", optAction(r.onSelectAction, "onSelectAction", "dataSource")],
    ["on-unselect-action", optAction(r.onUnselectAction, "onUnselectAction", "dataSource")],
    ["description", optString(r.description, "description", "dataSource", 4_096)],
    ["metadata", optRecord(r.metadata, "metadata", "dataSource")],
    ["enabled", optBool(r.enabled, "enabled", "dataSource")],
    ["image", optString(r.image, "image", "dataSource", 1_000_000)],
    ["alt-text", optString(r.altText, "altText", "dataSource", 4_096)],
    ["color", optString(r.color, "color", "dataSource", 64)]
  ]);
}

// ===========================================================================
// §A.6 — Actions (discriminated by `name`, NOT `type`)
// ===========================================================================

export function dataExchangeAction(props?: { payload?: Record<string, unknown> }): WireObject {
  const r = props === undefined ? {} : assertProps(props, "dataExchangeAction");
  const payload = r.payload === undefined ? {} : cloneRecord(r.payload, "payload", "dataExchangeAction");
  return { name: "data_exchange", payload };
}

const NAVIGATE_TARGET_TYPES = ["screen", "plugin"] as const;

export interface NavigateActionProps {
  readonly next: { readonly name: string; readonly type?: string };
  readonly payload?: Record<string, unknown>;
}

export function navigateAction(props: NavigateActionProps): WireObject {
  const r = assertProps(props, "navigateAction");
  const nextRecord = flowAssertPlainRecord(r.next, "navigateAction", "next");
  const next = wire([
    ["name", reqString(nextRecord.name, "next.name", "navigateAction", 256)],
    ["type", reqEnum(nextRecord.type ?? "screen", "next.type", "navigateAction", NAVIGATE_TARGET_TYPES)]
  ]);
  const payload = r.payload === undefined ? {} : cloneRecord(r.payload, "payload", "navigateAction");
  return { name: "navigate", next, payload };
}

export function completeAction(props?: { payload?: Record<string, unknown> }): WireObject {
  const r = props === undefined ? {} : assertProps(props, "completeAction");
  const payload = r.payload === undefined ? {} : cloneRecord(r.payload, "payload", "completeAction");
  return { name: "complete", payload };
}

export function updateDataAction(props: { payload: Record<string, unknown> }): WireObject {
  const r = assertProps(props, "updateDataAction");
  if (r.payload === undefined) {
    throw flowError("Invalid updateDataAction input: payload is required.");
  }
  return { name: "update_data", payload: cloneRecord(r.payload, "payload", "updateDataAction") };
}

export function openUrlAction(props: { url: string }): WireObject {
  const r = assertProps(props, "openUrlAction");
  const url = reqString(r.url, "url", "openUrlAction", 2_048);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw flowError("Invalid openUrlAction input: url must be an absolute http(s) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw flowError("Invalid openUrlAction input: url protocol must be http: or https:.");
  }
  return { name: "open_url", url };
}
