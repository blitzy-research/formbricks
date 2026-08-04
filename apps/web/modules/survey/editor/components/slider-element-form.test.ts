import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import type { TSurveySliderElement } from "@formbricks/types/surveys/elements";
import {
  type TSliderNumericDrafts,
  buildSliderDescriptionUpdate,
  buildSliderNumericUpdate,
  clearSliderNumericDraft,
  getSliderFieldIds,
  getSliderNumericFieldText,
  isSliderValueShown,
  readFiniteNumber,
  recordSliderNumericDraft,
} from "@/modules/survey/editor/components/slider-element-form-utils";

/**
 * Unit tests for the logic behind SliderElementForm — the editor panel that configures a Slider element.
 *
 * Everything asserted below is executed for real. The panel's logic lives in `slider-element-form-utils.ts`
 * precisely so that it can be: a numeric reader that decides whether a keystroke is written at all, the
 * element-scoped DOM ids, the update payloads (two of which must merge into the existing range rather than
 * replace it), and the transient-entry state machine that keeps a half-typed number on screen. The panel
 * imports those functions and keeps no copy of them, so a test that exercises them exercises what the panel
 * runs.
 *
 * None of it is protected by the type system. `updateElement` accepts a `Partial<TSurveySliderElement>`, so a
 * payload that drops the sibling range bound type-checks happily and would leave the element with no upper
 * bound at all.
 *
 * What this file deliberately does NOT assert is the panel's JSX: which component renders each field, the
 * `type="number"` and `step="any"` attributes, the auto-animated description affordance, and the wiring of each
 * handler to its input. Those are rendered-component concerns, and per this repository's testing guidance they
 * belong to the integration route rather than to a unit test - asserting them by pattern-matching the source
 * text would only claim coverage that the assertions cannot actually provide. The one static check kept here is
 * about data rather than wiring: that every translation key the panel names exists in the default catalog.
 */

const SLIDER_ID = "slider-1";

const buildElement = (overrides: Partial<TSurveySliderElement> = {}): TSurveySliderElement =>
  ({
    id: SLIDER_ID,
    type: TSurveyElementTypeEnum.Slider,
    headline: { default: "How likely are you to recommend us?" },
    required: true,
    range: { min: 0, max: 100 },
    step: 5,
    ...overrides,
  }) as unknown as TSurveySliderElement;

// ---------------------------------------------------------------------------
// 1. readFiniteNumber — the guard that decides whether a keystroke is written
// ---------------------------------------------------------------------------

describe("readFiniteNumber", () => {
  const parsedValues: { label: string; raw: string; expected: number }[] = [
    { label: "a plain integer", raw: "42", expected: 42 },
    { label: "zero", raw: "0", expected: 0 },
    { label: "a negative bound", raw: "-20", expected: -20 },
    { label: "a decimal step", raw: "0.5", expected: 0.5 },
    { label: "a leading-dot decimal", raw: ".25", expected: 0.25 },
    { label: "exponent notation", raw: "1e3", expected: 1000 },
    { label: "a value padded with whitespace", raw: "  42  ", expected: 42 },
  ];

  test.each(parsedValues)("reads $label", ({ raw, expected }) => {
    expect(readFiniteNumber(raw)).toBe(expected);
  });

  test("reads zero as zero rather than as an absent value", () => {
    // The one case a truthiness check would break: 0 is a legitimate range minimum.
    expect(readFiniteNumber("0")).toBe(0);
    expect(readFiniteNumber("0")).not.toBeNull();
  });

  const rejectedValues: { label: string; raw: string }[] = [
    { label: "an empty field", raw: "" },
    { label: "a whitespace-only field", raw: "   " },
    { label: "a lone minus sign, as typed mid-entry", raw: "-" },
    { label: "a lone decimal point, as typed mid-entry", raw: "." },
    { label: "text", raw: "abc" },
    { label: "positive infinity", raw: "Infinity" },
    { label: "negative infinity", raw: "-Infinity" },
    { label: "the literal NaN", raw: "NaN" },
    // Partial and trailing-junk fields. A scanning parse would accept almost all of these as the number
    // they happen to start with — "1e" as 1, "12abc" as 12, "5px" as 5, "1,000" as 1, "0.5.2" as 0.5 —
    // writing to the element a value the author never completed.
    { label: "an exponent with no exponent digits", raw: "1e" },
    { label: "an exponent with only a sign", raw: "1e-" },
    { label: "digits followed by text", raw: "12abc" },
    { label: "digits followed by a unit", raw: "5px" },
    { label: "a thousands separator", raw: "1,000" },
    { label: "a decimal followed by a second point", raw: "0.5.2" },
    { label: "a doubled sign", raw: "--5" },
    { label: "two numbers in one field", raw: "5 10" },
  ];

  test.each(rejectedValues)("declines to write $label", ({ raw }) => {
    expect(readFiniteNumber(raw)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Element-scoped DOM ids
// ---------------------------------------------------------------------------

describe("getSliderFieldIds", () => {
  test("derives every field id from the element id", () => {
    expect(getSliderFieldIds(SLIDER_ID)).toEqual({
      rangeMinId: "slider-1-range-min",
      rangeMaxId: "slider-1-range-max",
      stepId: "slider-1-step",
      showValueId: "showValue-slider-1",
    });
  });

  test("gives the four fields of one card distinct ids", () => {
    const ids = Object.values(getSliderFieldIds(SLIDER_ID));

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("gives two open slider cards fully disjoint ids", () => {
    // A duplicate id resolves to the FIRST match in the document, so a later card's label would focus - and a
    // screen reader would announce - the first card's input.
    const first = Object.values(getSliderFieldIds("slider-1"));
    const second = Object.values(getSliderFieldIds("slider-2"));

    expect(first.filter((id) => second.includes(id))).toEqual([]);
  });

  test("contains no document-wide literal id", () => {
    for (const id of Object.values(getSliderFieldIds(SLIDER_ID))) {
      expect(id).toContain(SLIDER_ID);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Update payloads
// ---------------------------------------------------------------------------

describe("buildSliderNumericUpdate", () => {
  test("editing the minimum preserves the maximum", () => {
    expect(buildSliderNumericUpdate("min", "10", buildElement())).toEqual({ range: { min: 10, max: 100 } });
  });

  test("editing the maximum preserves the minimum", () => {
    expect(buildSliderNumericUpdate("max", "60", buildElement({ range: { min: 10, max: 100 } }))).toEqual({
      range: { min: 10, max: 60 },
    });
  });

  test("never mutates the range it was given", () => {
    const element = buildElement();

    buildSliderNumericUpdate("min", "10", element);

    expect(element.range).toEqual({ min: 0, max: 100 });
  });

  test("writes only the range key when a bound changes", () => {
    expect(Object.keys(buildSliderNumericUpdate("min", "10", buildElement()) ?? {})).toEqual(["range"]);
  });

  test("writes the step as a bare step, never folded into the range", () => {
    const update = buildSliderNumericUpdate("step", "2.5", buildElement());

    expect(update).toEqual({ step: 2.5 });
    expect(Object.keys(update ?? {})).toEqual(["step"]);
  });

  test("accepts a decimal step", () => {
    expect(buildSliderNumericUpdate("step", "0.5", buildElement())).toEqual({ step: 0.5 });
  });

  test("accepts a negative minimum, which the schema permits either side of zero", () => {
    expect(buildSliderNumericUpdate("min", "-50", buildElement())).toEqual({
      range: { min: -50, max: 100 },
    });
  });

  test("accepts a range minimum of zero", () => {
    expect(buildSliderNumericUpdate("min", "0", buildElement({ range: { min: 20, max: 100 } }))).toEqual({
      range: { min: 0, max: 100 },
    });
  });

  test.each(["", "   ", "abc", "1e", "12abc", "Infinity", "NaN", "-"])(
    "yields no payload for the unusable input %j",
    (raw) => {
      // No payload means the panel returns early and the value already stored stays in place, for every field.
      expect(buildSliderNumericUpdate("min", raw, buildElement())).toBeNull();
      expect(buildSliderNumericUpdate("max", raw, buildElement())).toBeNull();
      expect(buildSliderNumericUpdate("step", raw, buildElement())).toBeNull();
    }
  );

  test("does not police the range ordering, leaving that to the schema", () => {
    // A minimum above the maximum is a lawful intermediate state while the author edits the pair, and the
    // element schema is what reports it - pinned so the panel is never "fixed" into silently refusing the
    // keystroke, which would make an inverted range uneditable.
    expect(buildSliderNumericUpdate("min", "200", buildElement())).toEqual({
      range: { min: 200, max: 100 },
    });
    expect(buildSliderNumericUpdate("step", "0", buildElement())).toEqual({ step: 0 });
    expect(buildSliderNumericUpdate("step", "-5", buildElement())).toEqual({ step: -5 });
  });
});

describe("buildSliderDescriptionUpdate", () => {
  test("creates the description as an internationalized string across the survey's languages", () => {
    expect(buildSliderDescriptionUpdate(["default", "de"])).toEqual({
      subheader: { default: "", de: "" },
    });
  });

  test("writes only the subheader key", () => {
    expect(Object.keys(buildSliderDescriptionUpdate(["default"]))).toEqual(["subheader"]);
  });

  test("creates an empty description rather than placeholder text", () => {
    // The field is revealed for the author to type into; pre-filling it would publish copy nobody wrote.
    const update = buildSliderDescriptionUpdate(["default"]);

    expect(update.subheader?.default).toBe("");
  });
});

describe("isSliderValueShown", () => {
  test("is on when the element has never set the flag", () => {
    expect(isSliderValueShown(buildElement())).toBe(true);
  });

  test("is on when the flag is explicitly true", () => {
    expect(isSliderValueShown(buildElement({ showValue: true }))).toBe(true);
  });

  test("is off only when the flag is explicitly false", () => {
    expect(isSliderValueShown(buildElement({ showValue: false }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Translation catalog contract
// ---------------------------------------------------------------------------

/**
 * The keys the panel renders. A missing key ships as its own raw identifier in the interface, and the panel is
 * the only place they are named, so the catalog is checked against them here.
 *
 * This is a data assertion, not a claim about the panel's markup: it says each key resolves, and says nothing
 * about which component renders it.
 */
const PANEL_TRANSLATION_KEYS = [
  "environments.surveys.edit.question",
  "environments.surveys.edit.add_description",
  "environments.surveys.edit.range",
  "environments.surveys.edit.minimum",
  "environments.surveys.edit.maximum",
  "environments.surveys.edit.step",
  "environments.surveys.edit.step_description",
  "environments.surveys.edit.lower_label",
  "environments.surveys.edit.upper_label",
  "environments.surveys.edit.show_selected_value",
  "environments.surveys.edit.show_selected_value_description",
  "common.description",
];

describe("SliderElementForm translation keys", () => {
  const enLocale = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../../locales/en-US.json"), "utf-8")
  ) as Record<string, unknown>;

  const resolveTranslationKey = (key: string): unknown =>
    key.split(".").reduce<unknown>((node, segment) => {
      if (typeof node !== "object" || node === null) return undefined;
      return (node as Record<string, unknown>)[segment];
    }, enLocale);

  const sourceCode = fs.readFileSync(path.resolve(__dirname, "slider-element-form.tsx"), "utf-8");

  test.each(PANEL_TRANSLATION_KEYS)("%s resolves to a non-empty string in the default catalog", (key) => {
    const value = resolveTranslationKey(key);

    expect(typeof value).toBe("string");
    expect(value).not.toBe("");
  });

  test("the list above is the set of keys the panel actually names", () => {
    // Keeps the catalog assertions honest in the one way a data check can be kept honest: if the panel adds or
    // drops a key, the two sets diverge and this fails. The translation scanner requires literal `t()` calls,
    // so the keys cannot be sourced from a shared constant and compared by identity.
    const namedKeys = [...sourceCode.matchAll(/\bt\("([^"]+)"\)/g)].map((match) => match[1]);

    expect([...new Set(namedKeys)].sort()).toEqual([...PANEL_TRANSLATION_KEYS].sort());
  });
});

// ---------------------------------------------------------------------------
// 5. Transient numeric entry — the state machine behind the three numeric fields
//
// Every arbitrary bound the schema permits is reached by typing through entries that are not numbers yet: a
// negative passes through "-", a decimal through "0.", an exponent through "1e" and "1e-". A `type="number"`
// input reports each of those as an empty string, so a field rendered from the stored number alone has that
// number written straight back on the first such keystroke — erasing what was typed and putting those values
// out of reach from the keyboard. These specs pin the split that fixes it: what is on screen is kept as typed,
// and only a complete finite number is written to the element.
// ---------------------------------------------------------------------------

describe("the transient numeric entry state machine", () => {
  /** One keystroke, as the panel applies it: the entry is recorded, then the write is decided from it. */
  const typeInto = (drafts: TSliderNumericDrafts, field: "min" | "max" | "step", rawValue: string) => ({
    drafts: recordSliderNumericDraft(drafts, field, rawValue),
    update: buildSliderNumericUpdate(field, rawValue, buildElement()),
  });

  test.each([
    ["a cleared field", ""],
    ["a lone minus sign", "-"],
    ["a lone decimal point", "."],
    ["an exponent with no exponent digits", "1e"],
    ["an exponent with only a sign", "1e-"],
    ["digits followed by text", "12abc"],
  ])("keeps %s on screen without writing it to the element", (_label, raw) => {
    const { drafts, update } = typeInto({}, "min", raw);

    expect(update).toBeNull();
    expect(getSliderNumericFieldText(drafts, "min", 0)).toBe(raw);
  });

  test.each([
    // "-25" is typed as "-" then "-25"; "0.5" as "0." — which the field reports as "" — then "0.5"; "1e3" as
    // "1e" then "1e3". Each first step writes nothing and each second step writes the finished number.
    ["a negative bound", "-", "-25", -25],
    ["a decimal bound", "", "0.5", 0.5],
    ["an exponent bound", "1e", "1e3", 1000],
  ])("reaches %s through an entry that is not a number yet", (_label, partial, complete, expected) => {
    const afterPartial = typeInto({}, "min", partial);
    expect(afterPartial.update).toBeNull();
    expect(getSliderNumericFieldText(afterPartial.drafts, "min", 10)).toBe(partial);

    const afterComplete = typeInto(afterPartial.drafts, "min", complete);
    expect(afterComplete.update).toEqual({ range: { min: expected, max: 100 } });
    expect(getSliderNumericFieldText(afterComplete.drafts, "min", 10)).toBe(complete);
  });

  test("reaches a decimal step the same way", () => {
    const afterPartial = typeInto({}, "step", "");
    expect(afterPartial.update).toBeNull();
    expect(getSliderNumericFieldText(afterPartial.drafts, "step", 5)).toBe("");

    const afterComplete = typeInto(afterPartial.drafts, "step", "0.25");
    expect(afterComplete.update).toEqual({ step: 0.25 });
  });

  test("drafts one field without disturbing the others", () => {
    const drafts = typeInto(typeInto({}, "min", "-").drafts, "step", "").drafts;

    expect(getSliderNumericFieldText(drafts, "min", 0)).toBe("-");
    expect(getSliderNumericFieldText(drafts, "step", 5)).toBe("");
    // Untouched, so it still reads straight from the element.
    expect(getSliderNumericFieldText(drafts, "max", 100)).toBe(100);
  });

  test("shows the stored value again once an incomplete field is left", () => {
    const drafts = typeInto({}, "max", "1e").drafts;
    expect(getSliderNumericFieldText(drafts, "max", 100)).toBe("1e");

    const afterBlur = clearSliderNumericDraft(drafts, "max");
    expect(getSliderNumericFieldText(afterBlur, "max", 100)).toBe(100);
  });

  test("shows the stored value again once a completed field is left, normalised", () => {
    // "1e3" was written as 1000, so leaving the field replaces the entry with the number that was stored
    // rather than with the text that produced it.
    const drafts = typeInto({}, "min", "1e3").drafts;

    expect(getSliderNumericFieldText(clearSliderNumericDraft(drafts, "min"), "min", 1000)).toBe(1000);
  });

  test("leaves the drafts untouched when a field with none is left", () => {
    // Returning the same object is what keeps a blur on an untouched field from re-rendering the panel.
    const drafts: TSliderNumericDrafts = { min: "-" };

    expect(clearSliderNumericDraft(drafts, "max")).toBe(drafts);
  });

  test("shows the element's own value while nothing is being typed", () => {
    expect(getSliderNumericFieldText({}, "min", 0)).toBe(0);
    expect(getSliderNumericFieldText({}, "max", 100)).toBe(100);
    expect(getSliderNumericFieldText({}, "step", 5)).toBe(5);
  });

  test("shows a zero bound rather than treating it as an absent entry", () => {
    // The one case a truthiness check would break: a stored 0 is a bound, and an entry of "0" is an entry.
    expect(getSliderNumericFieldText({}, "min", 0)).toBe(0);
    expect(getSliderNumericFieldText({ min: "0" }, "min", 25)).toBe("0");
  });
});
