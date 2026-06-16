// WATS-76 slice A — behavioral tests for the typed Flow DSL builders.
//
// Asserts EXACT wire objects: hyphenated keys, `type` on components, `name` on
// actions, the 4 underscore-exception keys (routing_model, data_api_version,
// data_channel_uri, refresh_on_back) plus the else_→"else" case, a full
// multi-screen FlowJSON that round-trips through validateFlowJson, the action
// `name` shapes, and the adversarial rejection matrix.

import { describe, expect, test } from "bun:test";
import {
  FLOW_DSL_MAX_CONTROL_DEPTH,
  GraphRequestValidationError,
  buildFlowJson,
  calendarPicker,
  checkboxGroup,
  chipsSelector,
  completeAction,
  dataExchangeAction,
  dataSource,
  datePicker,
  documentPicker,
  dropdown,
  embeddedLink,
  flowJson,
  footer,
  form,
  ifComponent,
  image,
  imageCarousel,
  imageCarouselItem,
  navigateAction,
  navigationItem,
  navigationList,
  openUrlAction,
  optIn,
  photoPicker,
  radioButtonsGroup,
  richText,
  screen,
  singleColumnLayout,
  switchComponent,
  textArea,
  textBody,
  textCaption,
  textHeading,
  textInput,
  textSubheading,
  updateDataAction,
  validateFlowJson
} from "../src";

// Helper: assert a call returns a typed validation error WITHOUT throwing the
// builder. The builders THROW GraphRequestValidationError; assert via expect.
function expectReject(fn: () => unknown): void {
  expect(fn).toThrow(GraphRequestValidationError);
}

describe("WATS-76 A: text components → exact wire", () => {
  test("textHeading emits type + text, drops undefined", () => {
    expect(textHeading({ text: "Hi" })).toEqual({ type: "TextHeading", text: "Hi" });
    expect(textHeading({ text: "Hi", visible: false })).toEqual({
      type: "TextHeading",
      text: "Hi",
      visible: false
    });
  });

  test("textSubheading emits type", () => {
    expect(textSubheading({ text: "Sub" })).toEqual({ type: "TextSubheading", text: "Sub" });
  });

  test("textBody hyphenates font_weight → font-weight, accepts string[]", () => {
    expect(
      textBody({ text: ["a", "b"], markdown: true, fontWeight: "bold", strikethrough: false })
    ).toEqual({
      type: "TextBody",
      text: ["a", "b"],
      markdown: true,
      "font-weight": "bold",
      strikethrough: false
    });
  });

  test("textCaption mirrors textBody", () => {
    expect(textCaption({ text: "c", fontWeight: "italic" })).toEqual({
      type: "TextCaption",
      text: "c",
      "font-weight": "italic"
    });
  });

  test("richText accepts string and string[]", () => {
    expect(richText({ text: "r" })).toEqual({ type: "RichText", text: "r" });
    expect(richText({ text: ["x"] })).toEqual({ type: "RichText", text: ["x"] });
  });
});

describe("WATS-76 A: input components → hyphenated wire keys", () => {
  test("textInput hyphenates input-type / min-chars / init-value / error-message", () => {
    expect(
      textInput({
        name: "email",
        label: "Email",
        inputType: "email",
        labelVariant: "large",
        minChars: 3,
        maxChars: 40,
        helperText: "your email",
        initValue: "a@b.com",
        errorMessage: "bad email",
        required: true
      })
    ).toEqual({
      type: "TextInput",
      name: "email",
      label: "Email",
      "input-type": "email",
      "label-variant": "large",
      "min-chars": 3,
      "max-chars": 40,
      "helper-text": "your email",
      "init-value": "a@b.com",
      "error-message": "bad email",
      required: true
    });
  });

  test("textArea hyphenates max-length / helper-text", () => {
    expect(textArea({ name: "bio", label: "Bio", maxLength: 200, helperText: "h" })).toEqual({
      type: "TextArea",
      name: "bio",
      label: "Bio",
      "max-length": 200,
      "helper-text": "h"
    });
  });
});

describe("WATS-76 A: selection components → data-source + actions", () => {
  const ds = [dataSource({ id: "1", title: "One" }), dataSource({ id: "2", title: "Two" })];

  test("checkboxGroup emits data-source + min/max-selected-items + on-*-action", () => {
    const wire = checkboxGroup({
      name: "opts",
      dataSource: ds,
      minSelectedItems: 1,
      maxSelectedItems: 2,
      initValue: ["1"],
      mediaSize: "large",
      onSelectAction: dataExchangeAction()
    });
    expect(wire.type).toBe("CheckboxGroup");
    expect(wire["data-source"]).toEqual([
      { id: "1", title: "One" },
      { id: "2", title: "Two" }
    ]);
    expect(wire["min-selected-items"]).toBe(1);
    expect(wire["max-selected-items"]).toBe(2);
    expect(wire["init-value"]).toEqual(["1"]);
    expect(wire["media-size"]).toBe("large");
    expect(wire["on-select-action"]).toEqual({ name: "data_exchange", payload: {} });
  });

  test("radioButtonsGroup uses string init-value, accepts data ref", () => {
    expect(radioButtonsGroup({ name: "r", dataSource: "${data.opts}", initValue: "1" })).toEqual({
      type: "RadioButtonsGroup",
      name: "r",
      "data-source": "${data.opts}",
      "init-value": "1"
    });
  });

  test("dropdown emits data-source", () => {
    const wire = dropdown({ name: "d", label: "Pick", dataSource: ds });
    expect(wire.type).toBe("Dropdown");
    expect(wire["data-source"]).toBeDefined();
  });

  test("chipsSelector emits min/max-selected-items", () => {
    const wire = chipsSelector({ name: "c", label: "Chips", dataSource: ds, maxSelectedItems: 3 });
    expect(wire.type).toBe("ChipsSelector");
    expect(wire["max-selected-items"]).toBe(3);
  });
});

describe("WATS-76 A: footer / optIn / embeddedLink / navigation", () => {
  test("footer hyphenates on-click-action + *-caption, no visible field", () => {
    const wire = footer({
      label: "Done",
      onClickAction: completeAction(),
      leftCaption: "L",
      centerCaption: "C",
      rightCaption: "R"
    });
    expect(wire).toEqual({
      type: "Footer",
      label: "Done",
      "on-click-action": { name: "complete", payload: {} },
      "left-caption": "L",
      "center-caption": "C",
      "right-caption": "R"
    });
  });

  test("optIn emits init-value bool + on-click-action", () => {
    expect(optIn({ name: "tos", label: "Agree", initValue: false, onClickAction: "${...}" })).toEqual({
      type: "OptIn",
      name: "tos",
      label: "Agree",
      "init-value": false,
      "on-click-action": "${...}"
    });
  });

  test("embeddedLink requires on-click-action", () => {
    expect(embeddedLink({ text: "link", onClickAction: openUrlAction({ url: "https://x.io" }) })).toEqual({
      type: "EmbeddedLink",
      text: "link",
      "on-click-action": { name: "open_url", url: "https://x.io" }
    });
  });

  test("navigationList emits list-items + navigationItem main-content", () => {
    const item = navigationItem({
      id: "i1",
      mainContent: { title: "T" },
      badge: "NEW",
      tags: ["a"],
      onClickAction: navigateAction({ next: { name: "NEXT" } })
    });
    expect(item).toEqual({
      id: "i1",
      "main-content": { title: "T" },
      badge: "NEW",
      tags: ["a"],
      "on-click-action": { name: "navigate", next: { name: "NEXT", type: "screen" }, payload: {} }
    });
    const wire = navigationList({ name: "nav", listItems: [item], mediaSize: "regular" });
    expect(wire.type).toBe("NavigationList");
    expect(wire["list-items"]).toEqual([item]);
    expect(wire["media-size"]).toBe("regular");
  });
});

describe("WATS-76 A: date / media pickers", () => {
  test("datePicker hyphenates min-date / unavailable-dates / on-select-action", () => {
    const wire = datePicker({
      name: "d",
      label: "Date",
      minDate: "1900-01-01",
      maxDate: "2100-01-01",
      unavailableDates: ["2020-01-01"],
      onSelectAction: dataExchangeAction()
    });
    expect(wire["min-date"]).toBe("1900-01-01");
    expect(wire["max-date"]).toBe("2100-01-01");
    expect(wire["unavailable-dates"]).toEqual(["2020-01-01"]);
    expect(wire["on-select-action"]).toEqual({ name: "data_exchange", payload: {} });
  });

  test("calendarPicker hyphenates min-days/max-days/include-days, validates days + mode", () => {
    const wire = calendarPicker({
      name: "c",
      label: "Cal",
      mode: "range",
      minDays: 1,
      maxDays: 7,
      includeDays: ["Mon", "Fri"]
    });
    expect(wire.mode).toBe("range");
    expect(wire["min-days"]).toBe(1);
    expect(wire["max-days"]).toBe(7);
    expect(wire["include-days"]).toEqual(["Mon", "Fri"]);
    expectReject(() => calendarPicker({ name: "c", label: "Cal", includeDays: ["Funday"] }));
    expectReject(() => calendarPicker({ name: "c", label: "Cal", mode: "weekly" }));
  });

  test("image hyphenates aspect-ratio / scale-type / alt-text", () => {
    expect(image({ src: "BASE64", aspectRatio: 1, scaleType: "cover", altText: "pic" })).toEqual({
      type: "Image",
      src: "BASE64",
      "aspect-ratio": 1,
      "scale-type": "cover",
      "alt-text": "pic"
    });
  });

  test("imageCarousel emits images with alt-text items", () => {
    const it = imageCarouselItem({ src: "B64", altText: "a" });
    expect(it).toEqual({ src: "B64", "alt-text": "a" });
    const wire = imageCarousel({ images: [it], aspectRatio: "4:3" });
    expect(wire.type).toBe("ImageCarousel");
    expect(wire.images).toEqual([it]);
    expect(wire["aspect-ratio"]).toBe("4:3");
  });

  test("photoPicker hyphenates photo-source / max-file-size-kb / *-uploaded-photos", () => {
    const wire = photoPicker({
      name: "p",
      label: "Photo",
      photoSource: "camera",
      maxFileSizeKb: 1024,
      minUploadedPhotos: 1,
      maxUploadedPhotos: 3
    });
    expect(wire["photo-source"]).toBe("camera");
    expect(wire["max-file-size-kb"]).toBe(1024);
    expect(wire["min-uploaded-photos"]).toBe(1);
    expect(wire["max-uploaded-photos"]).toBe(3);
  });

  test("documentPicker hyphenates allowed-mime-types / *-uploaded-documents", () => {
    const wire = documentPicker({
      name: "doc",
      label: "Doc",
      allowedMimeTypes: ["application/pdf"],
      maxUploadedDocuments: 2
    });
    expect(wire["allowed-mime-types"]).toEqual(["application/pdf"]);
    expect(wire["max-uploaded-documents"]).toBe(2);
  });
});

describe("WATS-76 A: control-flow components", () => {
  test("ifComponent serializes else_ → 'else'", () => {
    const wire = ifComponent({
      condition: "`(${form.age} > 20)`",
      then: [textBody({ text: "adult" })],
      else_: [textBody({ text: "minor" })]
    });
    expect(wire.type).toBe("If");
    expect(wire.condition).toBe("`(${form.age} > 20)`");
    expect(wire.then).toEqual([{ type: "TextBody", text: "adult" }]);
    expect(wire.else).toEqual([{ type: "TextBody", text: "minor" }]);
    expect("else_" in wire).toBe(false);
  });

  test("ifComponent accepts plain `else` key too", () => {
    const wire = ifComponent({ condition: "`x`", then: [textBody({ text: "a" })], else: [textBody({ text: "b" })] });
    expect(wire.else).toEqual([{ type: "TextBody", text: "b" }]);
  });

  test("switchComponent emits value + cases dict", () => {
    const wire = switchComponent({
      value: "${data.tier}",
      cases: { gold: [textBody({ text: "Gold" })], silver: [textBody({ text: "Silver" })] }
    });
    expect(wire.type).toBe("Switch");
    expect(wire.value).toBe("${data.tier}");
    expect(wire.cases).toEqual({
      gold: [{ type: "TextBody", text: "Gold" }],
      silver: [{ type: "TextBody", text: "Silver" }]
    });
  });

  test("control-flow nesting beyond FLOW_DSL_MAX_CONTROL_DEPTH rejected", () => {
    expect(FLOW_DSL_MAX_CONTROL_DEPTH).toBe(5);
    // A 5-layer If tree is legal; wrapping it once more (depth 6) trips the guard.
    let legal: unknown[] = [textBody({ text: "leaf" })];
    for (let i = 0; i < FLOW_DSL_MAX_CONTROL_DEPTH; i += 1) {
      legal = [ifComponent({ condition: "`x`", then: legal })];
    }
    expectReject(() => ifComponent({ condition: "`x`", then: legal }));
  });
});

describe("WATS-76 A: action `name` shapes (§A.6)", () => {
  test("dataExchangeAction → name data_exchange + payload", () => {
    expect(dataExchangeAction()).toEqual({ name: "data_exchange", payload: {} });
    expect(dataExchangeAction({ payload: { a: 1 } })).toEqual({ name: "data_exchange", payload: { a: 1 } });
  });

  test("navigateAction → name navigate + next{name,type} + payload", () => {
    expect(navigateAction({ next: { name: "SCREEN_B" }, payload: { x: 1 } })).toEqual({
      name: "navigate",
      next: { name: "SCREEN_B", type: "screen" },
      payload: { x: 1 }
    });
    expect(navigateAction({ next: { name: "P", type: "plugin" } })).toEqual({
      name: "navigate",
      next: { name: "P", type: "plugin" },
      payload: {}
    });
  });

  test("completeAction → name complete", () => {
    expect(completeAction({ payload: { done: true } })).toEqual({ name: "complete", payload: { done: true } });
  });

  test("updateDataAction → name update_data + payload", () => {
    expect(updateDataAction({ payload: { k: "v" } })).toEqual({ name: "update_data", payload: { k: "v" } });
  });

  test("openUrlAction → name open_url + url, NO payload", () => {
    const wire = openUrlAction({ url: "https://example.com/x" });
    expect(wire).toEqual({ name: "open_url", url: "https://example.com/x" });
    expect("payload" in wire).toBe(false);
  });

  test("actions emit `name`, never `type`", () => {
    for (const a of [
      dataExchangeAction(),
      navigateAction({ next: { name: "X" } }),
      completeAction(),
      updateDataAction({ payload: {} }),
      openUrlAction({ url: "https://x.io" })
    ]) {
      expect("type" in a).toBe(false);
      expect(typeof a.name).toBe("string");
    }
  });
});

describe("WATS-76 A: FlowJSON — 4 underscore-exception keys", () => {
  test("flowJson keeps data_api_version / routing_model / data_channel_uri underscored", () => {
    const fj = flowJson({
      version: "7.0",
      dataApiVersion: "3.0",
      dataChannelUri: "https://api.example.com/flow",
      routingModel: { START: ["SUMMARY"], SUMMARY: [] },
      screens: [
        screen({
          id: "START",
          layout: singleColumnLayout([textHeading({ text: "Hi" })])
        })
      ]
    });
    expect(fj.data_api_version).toBe("3.0");
    expect(fj.data_channel_uri).toBe("https://api.example.com/flow");
    expect(fj.routing_model).toEqual({ START: ["SUMMARY"], SUMMARY: [] });
    // These exact underscored keys must be present; hyphenated variants must NOT.
    expect("data-api-version" in fj).toBe(false);
    expect("routing-model" in fj).toBe(false);
    expect("data-channel-uri" in fj).toBe(false);
  });

  test("screen keeps refresh_on_back underscored", () => {
    const s = screen({
      id: "S",
      layout: singleColumnLayout([textHeading({ text: "x" })]),
      refreshOnBack: true,
      terminal: true,
      success: true,
      sensitive: ["ssn"]
    });
    expect(s.refresh_on_back).toBe(true);
    expect("refresh-on-back" in s).toBe(false);
    expect(s.terminal).toBe(true);
    expect(s.sensitive).toEqual(["ssn"]);
  });

  test("form hyphenates init-values / error-messages", () => {
    const f = form({
      name: "signup",
      children: [textInput({ name: "n", label: "Name" })],
      initValues: { n: "x" },
      errorMessages: { n: "bad" }
    });
    expect(f.type).toBe("Form");
    expect(f.name).toBe("signup");
    expect(f["init-values"]).toEqual({ n: "x" });
    expect(f["error-messages"]).toEqual({ n: "bad" });
  });
});

describe("WATS-76 A: full multi-screen FlowJSON round-trips through validateFlowJson", () => {
  test("a realistic 2-screen survey flow validates", () => {
    const fj = flowJson({
      version: "7.0",
      dataApiVersion: "3.0",
      routingModel: { SURVEY: ["SUMMARY"], SUMMARY: [] },
      screens: [
        screen({
          id: "SURVEY",
          title: "Survey",
          layout: singleColumnLayout([
            textHeading({ text: "Tell us about you" }),
            form({
              name: "survey_form",
              children: [
                textInput({ name: "name", label: "Your name", required: true, inputType: "text" }),
                radioButtonsGroup({
                  name: "tier",
                  dataSource: [
                    dataSource({ id: "gold", title: "Gold" }),
                    dataSource({ id: "silver", title: "Silver" })
                  ]
                }),
                optIn({ name: "consent", label: "I agree" }),
                footer({
                  label: "Continue",
                  onClickAction: navigateAction({ next: { name: "SUMMARY" }, payload: { name: "${form.name}" } })
                })
              ]
            })
          ])
        }),
        screen({
          id: "SUMMARY",
          terminal: true,
          success: true,
          layout: singleColumnLayout([
            textBody({ text: "Thanks!" }),
            footer({ label: "Done", onClickAction: completeAction() })
          ])
        })
      ]
    });

    // Must not throw — the existing validator accepts builder output.
    expect(() => validateFlowJson(fj)).not.toThrow();
    const built = buildFlowJson(fj);
    expect(built.version).toBe("7.0");
    expect(built.data_api_version).toBe("3.0");
    expect(Array.isArray(built.screens)).toBe(true);
    expect((built.screens as unknown[]).length).toBe(2);
  });
});

describe("WATS-76 A: rejection matrix (adversarial battery)", () => {
  test("required string fields: missing / null / non-string / empty rejected", () => {
    expectReject(() => textHeading({} as never));
    expectReject(() => textHeading({ text: null } as never));
    expectReject(() => textHeading({ text: 42 } as never));
    expectReject(() => textHeading({ text: "" }));
    expectReject(() => textHeading({ text: "   " }));
    expectReject(() => textInput({ name: "n" } as never)); // missing label
    expectReject(() => footer({ label: "L" } as never)); // missing onClickAction
    expectReject(() => embeddedLink({ text: "t" } as never)); // missing onClickAction
  });

  test("control chars in strings rejected", () => {
    expectReject(() => textHeading({ text: "a\nb" }));
    expectReject(() => textInput({ name: "n", label: "L\u0000" }));
  });

  test("empty children arrays where >=1 required rejected", () => {
    expectReject(() => singleColumnLayout([]));
    expectReject(() => form({ name: "f", children: [] }));
    expectReject(() => ifComponent({ condition: "`x`", then: [] }));
    expectReject(() => switchComponent({ value: "v", cases: {} }));
    expectReject(() => navigationList({ name: "n", listItems: [] }));
  });

  test("non-array where array required rejected", () => {
    expectReject(() => singleColumnLayout("nope" as never));
    expectReject(() => flowJson({ version: "7.0", screens: "x" as never }));
  });

  test("enum values outside allowed set rejected", () => {
    expectReject(() => textInput({ name: "n", label: "L", inputType: "ssn" as never }));
    expectReject(() => image({ src: "b", aspectRatio: 1, scaleType: "stretch" as never }));
    expectReject(() => photoPicker({ name: "p", label: "L", photoSource: "scanner" as never }));
    expectReject(() => navigateAction({ next: { name: "X", type: "modal" as never } }));
  });

  test("non-integer / non-finite numbers rejected", () => {
    expectReject(() => textInput({ name: "n", label: "L", minChars: 1.5 }));
    expectReject(() => image({ src: "b", aspectRatio: Number.NaN }));
    expectReject(() => image({ src: "b", aspectRatio: Number.POSITIVE_INFINITY }));
  });

  test("non-boolean where boolean required rejected", () => {
    expectReject(() => textHeading({ text: "x", visible: "yes" as never }));
    expectReject(() => optIn({ name: "n", label: "L", initValue: 1 as never }));
  });

  test("__proto__/constructor/prototype keys rejected in record-accepting builders", () => {
    expectReject(() => screen({ id: "S", layout: singleColumnLayout([textHeading({ text: "x" })]), data: JSON.parse('{"__proto__":{"x":1}}') }));
    expectReject(() => dataExchangeAction({ payload: JSON.parse('{"__proto__":{"x":1}}') }));
    expectReject(() => updateDataAction({ payload: JSON.parse('{"constructor":1}') }));
    expectReject(() => switchComponent({ value: "v", cases: JSON.parse('{"prototype":[]}') }));
  });

  test("openUrlAction rejects non-http(s) and malformed urls", () => {
    expectReject(() => openUrlAction({ url: "ftp://x.io" }));
    expectReject(() => openUrlAction({ url: "not a url" }));
    expectReject(() => openUrlAction({ url: "javascript:alert(1)" }));
  });

  test("updateDataAction requires payload", () => {
    expectReject(() => updateDataAction({} as never));
  });

  test("non-object props rejected (no host TypeError escapes)", () => {
    expectReject(() => flowJson(null as never));
    expectReject(() => flowJson(42 as never));
    expectReject(() => screen([] as never));
    expectReject(() => textInput(undefined as never));
  });
});

describe("WATS-76 A: public exports reachable from @wats/graph barrel", () => {
  test("every builder is a function on the package barrel", () => {
    const builders = [
      flowJson, screen, singleColumnLayout, form, textHeading, textSubheading, textBody,
      textCaption, richText, textInput, textArea, checkboxGroup, radioButtonsGroup, dropdown,
      chipsSelector, footer, optIn, embeddedLink, navigationList, navigationItem, datePicker,
      calendarPicker, image, imageCarousel, imageCarouselItem, photoPicker, documentPicker,
      ifComponent, switchComponent, dataSource, dataExchangeAction, navigateAction,
      completeAction, updateDataAction, openUrlAction
    ];
    for (const b of builders) expect(typeof b).toBe("function");
  });
});
