/**
 * Unit tests for SliderElementForm — the editor panel that configures a Slider element.
 *
 * The panel's behaviour lives in small pieces of logic wired into JSX handlers: a finite-number reader
 * that decides whether a keystroke is written at all, three per-element DOM ids, three update payloads
 * (two of which must merge into the existing range rather than replace it), the optional-description
 * affordance, and a show-value toggle whose default is "on". None of that is reachable through the
 * component's exports, and none of it is protected by the type system — `updateElement` accepts a
 * `Partial<TSurveySliderElement>`, so a payload that drops the sibling range bound type-checks happily.
 *
 * These tests therefore follow the pattern already established for the Payment panel in this directory
 * (`payment-element-form.test.ts`): static analysis of the source paired with extracted mirrors of the
 * pure logic, each mirror anchored to the source by a drift assertion so it cannot quietly diverge from
 * the implementation it stands for.
 *
 * Verified behaviours:
 *  1. `readFiniteNumber` — an empty or unparseable field is not written, and a decimal step is
 *  2. Per-element DOM ids — several Slider cards can be open without duplicate ids
 *  3. Range merges — editing the minimum preserves the maximum, and vice versa, without mutation
 *  4. Step updates — written as a bare `step`, never folded into `range`
 *  5. Internationalized label wiring — every key used by the panel exists in the default catalog
 *  6. Optional description — created on demand, and an emptied description stays editable
 *  7. Show-value toggle — defaults to on, and an explicit `false` persists
 *  8. Numeric input attributes — `type="number"` and a free step on all three, `min={0}` on step alone
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { createI18nString } from "@/lib/i18n/utils";

// Read the source and the default translation catalog once for all static analysis tests.
const SOURCE_PATH = path.resolve(__dirname, "slider-element-form.tsx");
const sourceCode = fs.readFileSync(SOURCE_PATH, "utf-8");

const EN_LOCALE_PATH = path.resolve(__dirname, "../../../../locales/en-US.json");
const enLocale = JSON.parse(fs.readFileSync(EN_LOCALE_PATH, "utf-8")) as Record<string, unknown>;

/** Resolves a dot-nested translation key against the catalog, or undefined when any segment is missing. */
function resolveTranslationKey(key: string): unknown {
  return key.split(".").reduce<unknown>((node, segment) => {
    if (typeof node !== "object" || node === null) return undefined;
    return (node as Record<string, unknown>)[segment];
  }, enLocale);
}

/**
 * The `<Input />` elements the panel renders, as their raw attribute text.
 *
 * Sliced out of the source rather than counted across the whole file, because the panel's explanatory
 * comments legitimately mention attributes such as `step="any"` and a whole-file count would conflate the
 * two.
 */
const inputBlocks: string[] = sourceCode
  .split("<Input")
  .slice(1)
  .map((block) => block.slice(0, block.indexOf("/>")));

// ---------------------------------------------------------------------------
// 1. readFiniteNumber — the guard that decides whether a keystroke is written
// ---------------------------------------------------------------------------

/**
 * Mirrors `readFiniteNumber` from the panel.
 *
 * Kept in step with the source by the drift assertion in the suite below.
 */
function readFiniteNumber(rawValue: string): number | null {
  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

describe("SliderElementForm — readFiniteNumber", () => {
  test("the mirror matches the implementation in the source", () => {
    // If either line changes, this fails and the mirror below has to be updated with it.
    expect(sourceCode).toContain("const readFiniteNumber = (rawValue: string): number | null => {");
    expect(sourceCode).toContain("const parsed = Number.parseFloat(rawValue);");
    expect(sourceCode).toContain("return Number.isFinite(parsed) ? parsed : null;");
  });

  test("does not use Number() or parseInt, either of which would corrupt a field", () => {
    // `Number("")` is 0, which would silently rewrite a cleared bound to zero; `parseInt` would truncate
    // a decimal step such as 0.5 to 0, which the schema then rejects as a non-positive step.
    expect(sourceCode).not.toMatch(/Number\.parseInt|parseInt\(/);
    expect(sourceCode).not.toMatch(/=\s*Number\(rawValue\)/);
  });

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
  ];

  test.each(rejectedValues)("declines to write $label", ({ raw }) => {
    expect(readFiniteNumber(raw)).toBeNull();
  });

  test("clears a field without zeroing the stored value", () => {
    // Emptying the input must leave whatever the element already holds untouched, which is what returning
    // null achieves — the handler returns early instead of calling updateElement. All three numeric fields
    // are written through the one shared handler, so that single early return covers every one of them.
    expect(readFiniteNumber("")).toBeNull();
    expect(sourceCode).toContain("if (parsed === null) {");
    expect(sourceCode.match(/if \(parsed === null\) \{\s*return;\s*\}/g) ?? []).toHaveLength(1);
    for (const field of ["min", "max", "step"]) {
      expect(sourceCode).toContain(`handleNumericChange("${field}", e.target.value)`);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Per-element DOM ids
// ---------------------------------------------------------------------------

/** Mirrors the four element-scoped DOM ids the panel derives. */
function deriveFieldIds(elementId: string): {
  rangeMinId: string;
  rangeMaxId: string;
  stepId: string;
  showValueId: string;
} {
  return {
    rangeMinId: `${elementId}-range-min`,
    rangeMaxId: `${elementId}-range-max`,
    stepId: `${elementId}-step`,
    showValueId: `showValue-${elementId}`,
  };
}

describe("SliderElementForm — per-element DOM ids", () => {
  test("the mirror matches the implementation in the source", () => {
    expect(sourceCode).toContain("const rangeMinId = `${element.id}-range-min`;");
    expect(sourceCode).toContain("const rangeMaxId = `${element.id}-range-max`;");
    expect(sourceCode).toContain("const stepId = `${element.id}-step`;");
    expect(sourceCode).toContain("htmlId={`showValue-${element.id}`}");
  });

  test("derives each field id from the element id", () => {
    expect(deriveFieldIds("el1")).toEqual({
      rangeMinId: "el1-range-min",
      rangeMaxId: "el1-range-max",
      stepId: "el1-step",
      showValueId: "showValue-el1",
    });
  });

  test("gives the four fields of one card distinct ids", () => {
    const ids = Object.values(deriveFieldIds("el1"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("gives two open slider cards fully disjoint ids", () => {
    // The reason the ids are scoped at all: a document-wide id would repeat across cards, and a browser
    // resolves a duplicate id to the first match, so a later card's label would focus the first card's
    // input and a screen reader would announce the wrong field.
    const first = Object.values(deriveFieldIds("el1"));
    const second = Object.values(deriveFieldIds("el2"));

    expect(first.some((id) => second.includes(id))).toBe(false);
  });

  test("binds every numeric input to its label through the scoped id", () => {
    expect(sourceCode).toContain("<Label htmlFor={rangeMinId}>");
    expect(sourceCode).toContain("<Label htmlFor={rangeMaxId}>");
    expect(sourceCode).toContain("<Label htmlFor={stepId}>");
    expect(sourceCode).toContain("id={rangeMinId}");
    expect(sourceCode).toContain("id={rangeMaxId}");
    expect(sourceCode).toContain("id={stepId}");
  });

  test("uses no document-wide literal id for a numeric field", () => {
    expect(sourceCode).not.toMatch(/id="range-?min"/i);
    expect(sourceCode).not.toMatch(/id="range-?max"/i);
    expect(sourceCode).not.toMatch(/id="step"/i);
  });
});

// ---------------------------------------------------------------------------
// 3 & 4. Update payloads — range merges and the step write
// ---------------------------------------------------------------------------

interface SliderRange {
  min: number;
  max: number;
}

/** Mirrors the minimum-bound handler: parse, bail on null, otherwise merge into the existing range. */
function buildMinUpdate(range: SliderRange, rawValue: string): { range: SliderRange } | null {
  const parsed = readFiniteNumber(rawValue);
  if (parsed === null) return null;
  return { range: { ...range, min: parsed } };
}

/** Mirrors the maximum-bound handler. */
function buildMaxUpdate(range: SliderRange, rawValue: string): { range: SliderRange } | null {
  const parsed = readFiniteNumber(rawValue);
  if (parsed === null) return null;
  return { range: { ...range, max: parsed } };
}

/** Mirrors the step handler, which writes a bare `step` and never touches `range`. */
function buildStepUpdate(rawValue: string): { step: number } | null {
  const parsed = readFiniteNumber(rawValue);
  if (parsed === null) return null;
  return { step: parsed };
}

describe("SliderElementForm — update payloads", () => {
  test("the mirrors match the implementations in the source", () => {
    expect(sourceCode).toContain("updateElement(elementIdx, { range: { ...element.range, min: parsed } });");
    expect(sourceCode).toContain("updateElement(elementIdx, { range: { ...element.range, max: parsed } });");
    expect(sourceCode).toContain("updateElement(elementIdx, { step: parsed });");
  });

  test("editing the minimum preserves the maximum", () => {
    expect(buildMinUpdate({ min: 0, max: 100 }, "10")).toEqual({ range: { min: 10, max: 100 } });
  });

  test("editing the maximum preserves the minimum", () => {
    expect(buildMaxUpdate({ min: 10, max: 100 }, "50")).toEqual({ range: { min: 10, max: 50 } });
  });

  test("a range update never mutates the range it was given", () => {
    // `updateElement` merges the payload into editor state; handing it the element's own nested object
    // would let a later edit alias the previous one.
    const range: SliderRange = { min: 0, max: 100 };
    const update = buildMinUpdate(range, "25");

    expect(range).toEqual({ min: 0, max: 100 });
    expect(update?.range).not.toBe(range);
  });

  test("editing the minimum writes only the range key", () => {
    expect(Object.keys(buildMinUpdate({ min: 0, max: 100 }, "10") ?? {})).toEqual(["range"]);
  });

  test("editing the step writes only the step key", () => {
    expect(buildStepUpdate("5")).toEqual({ step: 5 });
    expect(Object.keys(buildStepUpdate("5") ?? {})).toEqual(["step"]);
  });

  test("accepts a decimal step", () => {
    expect(buildStepUpdate("0.5")).toEqual({ step: 0.5 });
  });

  test("accepts negative bounds, which the schema permits either side of zero", () => {
    expect(buildMinUpdate({ min: 0, max: 100 }, "-50")).toEqual({ range: { min: -50, max: 100 } });
  });

  test("accepts a range minimum of zero", () => {
    expect(buildMinUpdate({ min: 10, max: 100 }, "0")).toEqual({ range: { min: 0, max: 100 } });
  });

  const unwritableInputs = ["", "   ", "-", "abc", "Infinity"];

  test.each(unwritableInputs)("writes nothing for the unusable input %j", (raw) => {
    expect(buildMinUpdate({ min: 0, max: 100 }, raw)).toBeNull();
    expect(buildMaxUpdate({ min: 0, max: 100 }, raw)).toBeNull();
    expect(buildStepUpdate(raw)).toBeNull();
  });

  test("does not validate the range ordering in the panel, leaving that to the schema", () => {
    // A minimum above the maximum is writable — the author must be able to raise the maximum next — and is
    // reported by the element schema's refinement rather than blocked keystroke by keystroke.
    expect(buildMinUpdate({ min: 0, max: 100 }, "200")).toEqual({ range: { min: 200, max: 100 } });
  });
});

// ---------------------------------------------------------------------------
// 5. Internationalized label wiring
// ---------------------------------------------------------------------------

describe("SliderElementForm — internationalized labels", () => {
  const usedKeys = [
    "environments.surveys.edit.question",
    "common.description",
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
  ];

  test.each(usedKeys)("resolves %s through a literal t() call in the source", (key) => {
    expect(sourceCode).toContain(`t("${key}")`);
  });

  test.each(usedKeys)("has %s defined in the default catalog", (key) => {
    // A key that only exists in the source is a blank label in the editor; the translation scanner catches
    // an absent key, but not one whose path was mistyped into a different existing namespace.
    expect(typeof resolveTranslationKey(key)).toBe("string");
  });

  test("marks the headline as required", () => {
    expect(sourceCode).toContain('t("environments.surveys.edit.question") + "*"');
  });

  test("routes every internationalized field through ElementFormInput under a stable id", () => {
    for (const fieldId of ["headline", "subheader", "lowerLabel", "upperLabel"]) {
      expect(sourceCode).toContain(`id="${fieldId}"`);
    }
    expect(sourceCode.match(/<ElementFormInput/g) ?? []).toHaveLength(4);
  });

  test("binds the scale label inputs to the element's own lowerLabel and upperLabel", () => {
    expect(sourceCode).toContain("value={element.lowerLabel}");
    expect(sourceCode).toContain("value={element.upperLabel}");
  });

  test("hard-codes no user-facing English string", () => {
    // Every label and caption must come from t(); a literal would be invisible to the translation gate.
    expect(sourceCode).not.toMatch(/<Label[^>]*>[A-Z][a-z]+</);
  });
});

// ---------------------------------------------------------------------------
// 6. Optional description
// ---------------------------------------------------------------------------

/** Mirrors the panel's decision to show the description input rather than the add-description button. */
function isDescriptionShown(subheader: unknown): boolean {
  return subheader !== undefined;
}

describe("SliderElementForm — optional description", () => {
  test("the mirror matches the implementation in the source", () => {
    expect(sourceCode).toContain("element.subheader !== undefined &&");
    expect(sourceCode).toContain("element.subheader === undefined &&");
  });

  test("offers the add-description button when no description exists", () => {
    expect(isDescriptionShown(undefined)).toBe(false);
  });

  test("keeps an emptied description editable instead of removing the field", () => {
    // Distinguished by `undefined` rather than by emptiness: clearing the text must not make the input
    // vanish and strand the author.
    expect(isDescriptionShown({ default: "" })).toBe(true);
    expect(isDescriptionShown({ default: "Drag the handle" })).toBe(true);
  });

  test("creates the description as an internationalized string across the survey's languages", () => {
    expect(sourceCode).toContain('subheader: createI18nString("", surveyLanguageCodes)');
    expect(createI18nString("", [])).toEqual({ default: "" });
    expect(createI18nString("", ["de", "fr"])).toEqual({ default: "", de: "", fr: "" });
  });

  test("uses a non-submitting button for the affordance", () => {
    // Inside a <form>, a button without an explicit type submits it.
    expect(sourceCode).toContain('type="button"');
  });

  test("animates the description's appearance rather than jumping the panel", () => {
    expect(sourceCode).toContain("useAutoAnimate");
    expect(sourceCode).toContain("<div ref={parent}>");
  });
});

// ---------------------------------------------------------------------------
// 7. Show-value toggle
// ---------------------------------------------------------------------------

/** Mirrors the toggle's checked state, which treats an unset flag as on. */
function isShowValueChecked(showValue?: boolean): boolean {
  return showValue !== false;
}

/** Mirrors the toggle's write, which persists the boolean it was handed verbatim. */
function buildShowValueUpdate(checked: boolean): { showValue: boolean } {
  return { showValue: checked };
}

describe("SliderElementForm — show-value toggle", () => {
  test("the mirror matches the implementation in the source", () => {
    expect(sourceCode).toContain("isChecked={element.showValue !== false}");
    expect(sourceCode).toContain("showValue: checked,");
  });

  test("is on when the element has never set the flag", () => {
    // Matches the schema default of true, so a freshly added Slider shows its value.
    expect(isShowValueChecked(undefined)).toBe(true);
  });

  test("is on when the flag is explicitly true", () => {
    expect(isShowValueChecked(true)).toBe(true);
  });

  test("is off only when the flag is explicitly false", () => {
    expect(isShowValueChecked(false)).toBe(false);
  });

  test("persists an explicit false rather than dropping it", () => {
    // A truthiness-based write would omit the key and let the schema default flip it back to true.
    expect(buildShowValueUpdate(false)).toEqual({ showValue: false });
    expect(Object.keys(buildShowValueUpdate(false))).toEqual(["showValue"]);
  });

  test("persists an explicit true", () => {
    expect(buildShowValueUpdate(true)).toEqual({ showValue: true });
  });
});

// ---------------------------------------------------------------------------
// 8. Numeric input attributes
// ---------------------------------------------------------------------------

describe("SliderElementForm — numeric input attributes", () => {
  test("renders exactly three numeric inputs", () => {
    expect(inputBlocks).toHaveLength(3);
  });

  test("declares every numeric input as a number field", () => {
    for (const block of inputBlocks) {
      expect(block).toContain('type="number"');
    }
  });

  test("leaves the browser step free on every numeric input", () => {
    // A browser step of 1 would report a decimal bound or a decimal increment as a step mismatch, even
    // though the schema accepts any finite number.
    for (const block of inputBlocks) {
      expect(block).toContain('step="any"');
    }
  });

  test("floors only the step input at zero", () => {
    const flooredBlocks = inputBlocks.filter((block) => block.includes("min={0}"));

    expect(flooredBlocks).toHaveLength(1);
    expect(flooredBlocks[0]).toContain("id={stepId}");
  });

  test("feeds each numeric input from the element, with the in-progress draft taking precedence", () => {
    // The element remains the single committed source of truth: a field shows the element's own number
    // unless an edit is in progress, and the transient draft exists only so intermediate text such as ""
    // or "-" survives long enough to finish typing a schema-valid negative or decimal value. Dropping the
    // draft on blur is what puts the element back in charge, whether the edit committed or not.
    expect(sourceCode).toContain("value={numericDrafts.min ?? element.range.min}");
    expect(sourceCode).toContain("value={numericDrafts.max ?? element.range.max}");
    expect(sourceCode).toContain("value={numericDrafts.step ?? element.step}");
    expect(sourceCode).toContain("setNumericDrafts((previous) => ({ ...previous, [field]: null }))");
    for (const field of ["min", "max", "step"]) {
      expect(sourceCode).toContain(`handleNumericBlur("${field}")`);
    }
  });
});
