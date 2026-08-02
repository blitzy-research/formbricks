// @vitest-environment happy-dom
import type { TFunction } from "i18next";
import { describe, expect, test, vi } from "vitest";
import { ZResponseData } from "@formbricks/types/responses";
import type { TResponseData, TResponseDataValue } from "@formbricks/types/responses";
import {
  TSurveyElementTypeEnum,
  ZSurveyElements,
  ZSurveySliderElement,
} from "@formbricks/types/surveys/elements";
import type { TSurveySliderElement } from "@formbricks/types/surveys/elements";
import { ZValidationRule, ZValidationRules } from "@formbricks/types/surveys/validation-rules";
import { validateBlockResponses, validateElementResponse } from "./evaluator";

// Mock translation function
const mockT = vi.fn((key: string) => {
  return key;
}) as unknown as TFunction;

// Mock getLocalizedValue and getTranslations
vi.mock("@/lib/i18n", () => {
  const mockTFn = vi.fn((key: string) => key) as unknown as TFunction;
  return {
    getLocalizedValue: (
      localizedString: Record<string, string> | undefined,
      languageCode: string
    ): string => {
      if (!localizedString) return "";
      return localizedString[languageCode] || localizedString.default || "";
    },
    getTranslations: () => mockTFn,
  };
});

// Mock i18n.config to return our mock translation function
vi.mock("@/lib/i18n.config", () => ({
  default: {
    language: "en",
    changeLanguage: vi.fn(),
    getFixedT: vi.fn(() => mockT),
  },
}));

const SLIDER_ELEMENT_ID = "slider1";

/**
 * `showValue` is deliberately omitted so the schema's `true` default is what gets verified.
 */
const buildSliderElement = (): TSurveySliderElement =>
  ({
    id: SLIDER_ELEMENT_ID,
    type: TSurveyElementTypeEnum.Slider,
    headline: { default: "How likely are you to recommend us?" },
    required: true,
    range: { min: 0, max: 100 },
    step: 5,
    lowerLabel: { default: "Low" },
    upperLabel: { default: "High" },
  }) as unknown as TSurveySliderElement;

describe("slider element acceptance criteria", () => {
  test("(a) a slider configured min 0 / max 100 / step 5 round-trips through the schema", () => {
    const element = buildSliderElement();

    const parsed = ZSurveySliderElement.safeParse(element);

    expect(parsed.success).toBe(true);
    // The throw narrows `safeParse` so the assertions below run against a typed element.
    if (!parsed.success) {
      throw parsed.error;
    }

    // The literal - not merely the enum member - is the persisted discriminator and the value the public
    // API advertises, so pin both the enum and the parsed output to it.
    expect(TSurveyElementTypeEnum.Slider).toBe("slider");
    expect(parsed.data.type).toBe(TSurveyElementTypeEnum.Slider);

    expect(parsed.data.range).toEqual({ min: 0, max: 100 });
    expect(parsed.data.step).toBe(5);
    expect(parsed.data.headline).toEqual({ default: "How likely are you to recommend us?" });
    expect(parsed.data.lowerLabel).toEqual({ default: "Low" });
    expect(parsed.data.upperLabel).toEqual({ default: "High" });
    expect(parsed.data.required).toBe(true);

    expect(parsed.data.showValue).toBe(true);

    // Parsing the element list verifies the slider member registered in the survey-element union.
    const elements = ZSurveyElements.safeParse([element]);

    expect(elements.success).toBe(true);
    if (!elements.success) {
      throw elements.error;
    }

    expect(elements.data).toHaveLength(1);
    expect(elements.data[0].type).toBe(TSurveyElementTypeEnum.Slider);
  });

  test("(b) a valid in-range, on-grid value of 50 validates and persists as a number", () => {
    const element = buildSliderElement();

    const result = validateElementResponse(element, 50, "en");

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);

    // The same value through the block-level evaluator that server response validation uses.
    const errorMap = validateBlockResponses([element], { [SLIDER_ELEMENT_ID]: 50 }, "en");

    expect(Object.keys(errorMap)).toHaveLength(0);

    // "Persists as a number": the answer keeps its numeric type through the response-data contract.
    const responseData: TResponseData = { [SLIDER_ELEMENT_ID]: 50 };

    expect(typeof responseData[SLIDER_ELEMENT_ID]).toBe("number");

    // `parse` rather than `safeParse` so a rejection fails the test with the full ZodError.
    const persisted = ZResponseData.parse(responseData);

    expect(persisted[SLIDER_ELEMENT_ID]).toBe(50);
    expect(typeof persisted[SLIDER_ELEMENT_ID]).toBe("number");
  });

  test("(c) an out-of-range value of 105 and an off-grid value of 7 are both rejected", () => {
    const element = buildSliderElement();

    // 105 sits on the step grid but above the configured maximum, so the injected maxValue rule rejects it.
    const outOfRange = validateElementResponse(element, 105, "en");

    expect(outOfRange.valid).toBe(false);
    expect(outOfRange.errors.some((error) => error.ruleType === "maxValue")).toBe(true);
    expect(outOfRange.errors.some((error) => error.ruleId === "__implicit_slider_max__")).toBe(true);
    expect(outOfRange.errors.find((error) => error.ruleType === "maxValue")?.message).toBe(
      "errors.max_value"
    );

    // 7 is in range but off the step-5 grid, which isolates the stepMultipleOf rule.
    const offGrid = validateElementResponse(element, 7, "en");

    expect(offGrid.valid).toBe(false);
    expect(offGrid.errors.some((error) => error.ruleType === "stepMultipleOf")).toBe(true);
    expect(offGrid.errors.some((error) => error.ruleId === "__implicit_slider_step__")).toBe(true);
    expect(offGrid.errors.find((error) => error.ruleType === "stepMultipleOf")?.message).toBe(
      "errors.step_multiple_of"
    );
  });

  test("(d) a required slider submitted with no value is rejected", () => {
    const element = buildSliderElement();

    const emptyValue = validateElementResponse(element, "", "en");

    expect(emptyValue.valid).toBe(false);
    expect(emptyValue.errors).toHaveLength(1);
    expect(emptyValue.errors[0].ruleId).toBe("required");
    expect(emptyValue.errors[0].ruleType).toBe("minLength");
    expect(emptyValue.errors[0].message).toBe("errors.please_fill_out_this_field");

    // The element id is submitted as a KEY carrying an empty value, which is the shape a respondent's client
    // sends for a slider that was rendered and left untouched. The engine does not depend on the key being
    // there - the test immediately below proves an absent key is rejected identically, because
    // `validateBlockResponses` iterates the ELEMENTS it is handed rather than the keys it receives. The key is
    // present here because the server wrapper that fronts the engine narrows its element list to the
    // submitted keys before delegating, so this is the shape production callers actually produce.
    const emptyStringMap = validateBlockResponses([element], { [SLIDER_ELEMENT_ID]: "" }, "en");

    expect(Object.keys(emptyStringMap)).toEqual([SLIDER_ELEMENT_ID]);
    expect(emptyStringMap[SLIDER_ELEMENT_ID][0].ruleId).toBe("required");

    const undefinedMap = validateBlockResponses([element], { [SLIDER_ELEMENT_ID]: undefined }, "en");

    expect(Object.keys(undefinedMap)).toEqual([SLIDER_ELEMENT_ID]);
    expect(undefinedMap[SLIDER_ELEMENT_ID][0].ruleId).toBe("required");

    // Numeric 0 is an answer, not an empty value, so it must pass when the minimum is 0.
    const zero = validateElementResponse(element, 0, "en");

    expect(zero.valid).toBe(true);
    expect(zero.errors).toHaveLength(0);
  });

  test("(d) extended — a required slider is rejected when its key is absent, not only when it is empty", () => {
    const element = buildSliderElement();

    // `validateBlockResponses` is element-driven: it walks the elements it is handed and reads
    // `responses[element.id]`, so a key that was never submitted arrives as `undefined` and meets exactly the
    // same required check an empty string meets. Pinning that here means the guarantee belongs to the shared
    // engine rather than to any one caller's choice of element list, and every caller that hands the element
    // over - the runtime renderer and every server route alike - inherits the rejection unchanged.
    const absentKey = validateBlockResponses([element], {}, "en");

    expect(Object.keys(absentKey)).toEqual([SLIDER_ELEMENT_ID]);
    expect(absentKey[SLIDER_ELEMENT_ID]).toHaveLength(1);
    expect(absentKey[SLIDER_ELEMENT_ID][0].ruleId).toBe("required");
    expect(absentKey[SLIDER_ELEMENT_ID][0].ruleType).toBe("minLength");
    expect(absentKey[SLIDER_ELEMENT_ID][0].message).toBe("errors.please_fill_out_this_field");

    // An absent key is not an error in itself. The identical submission passes once the element is optional,
    // which is what keeps the rejection attributable to `required` and not to the absence.
    const optionalElement: TSurveySliderElement = { ...element, required: false };

    expect(validateBlockResponses([optionalElement], {}, "en")).toEqual({});

    // And the slider is still the only rejection when other answers are present, so the check reads its own
    // element's value rather than treating a non-empty payload as evidence that everything was answered.
    const mixedPayload = validateBlockResponses([element], { otherElement: "answered" }, "en");

    expect(Object.keys(mixedPayload)).toEqual([SLIDER_ELEMENT_ID]);
    expect(mixedPayload[SLIDER_ELEMENT_ID][0].ruleId).toBe("required");
  });
});

/**
 * The four criteria above are stated in terms of one small, well-behaved configuration. They are satisfied
 * by arithmetic that is only approximately correct and by an emptiness reading that is only approximately
 * the slider's, so on their own they cannot distinguish a sound implementation from one that happens to
 * agree on those inputs. The two suites below close that gap at the same entrypoints, extending criterion
 * (c) to a grid the criteria's configuration never reaches and criterion (d) to the difference between an
 * unanswered slider and one answered with the wrong shape.
 */
describe("slider grid rejection holds at magnitudes where floating point stops being exact", () => {
  const HIGH_MAGNITUDE_ELEMENT_ID = "sliderHigh";

  /**
   * A range wide enough that its values scale past `Number.MAX_SAFE_INTEGER` on a 0.2 grid. Nothing about
   * this configuration is unusual to an author - a range and a step, both finite, the step far smaller than
   * the span - which is precisely why the grid check has to stay exact here rather than only near zero.
   */
  const buildHighMagnitudeElement = (): TSurveySliderElement =>
    ({
      id: HIGH_MAGNITUDE_ELEMENT_ID,
      type: TSurveyElementTypeEnum.Slider,
      headline: { default: "Pick a value" },
      required: true,
      range: { min: 0, max: 1000000000000001 },
      step: 0.2,
    }) as unknown as TSurveySliderElement;

  test("the high-magnitude configuration is itself schema-valid, so the grid rule is the only gate", () => {
    const parsed = ZSurveySliderElement.safeParse(buildHighMagnitudeElement());

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw parsed.error;
    }

    expect(parsed.data.range).toEqual({ min: 0, max: 1000000000000001 });
    expect(parsed.data.step).toBe(0.2);
  });

  // Each value below is a whole half-step off the grid - the largest miss the grid admits, not a rounding
  // artefact - and each is in range. Reconstructing the nearest grid point in double arithmetic returns the
  // submitted value itself at this magnitude, measuring a drift of exactly zero and accepting it.
  test.each([
    ["a half-step above a grid point", 1000000000000000.5],
    ["a half-step below the next grid point", 1000000000000000.9],
  ])("should reject %s", (_label, value) => {
    const element = buildHighMagnitudeElement();

    const result = validateElementResponse(element, value, "en");

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.ruleId)).toEqual(["__implicit_slider_step__"]);
    expect(result.errors[0].ruleType).toBe("stepMultipleOf");
    expect(result.errors[0].message).toBe("errors.step_multiple_of");
  });

  test("should still accept a genuinely aligned value at the same magnitude", () => {
    const element = buildHighMagnitudeElement();

    // 1000000000000000.4 is 5000000000000002 whole steps of 0.2 above the minimum.
    const result = validateElementResponse(element, 1000000000000000.4, "en");

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("should reject through validateBlockResponses (the shared server path)", () => {
    const element = buildHighMagnitudeElement();

    const errorMap = validateBlockResponses(
      [element],
      { [HIGH_MAGNITUDE_ELEMENT_ID]: 1000000000000000.5 },
      "en"
    );

    expect(Object.keys(errorMap)).toEqual([HIGH_MAGNITUDE_ELEMENT_ID]);
    expect(errorMap[HIGH_MAGNITUDE_ELEMENT_ID].map((error) => error.ruleId)).toEqual([
      "__implicit_slider_step__",
    ]);
  });
});

describe("slider answers of the wrong shape are rejected whether or not the element is required", () => {
  const OPTIONAL_ELEMENT_ID = "sliderOptional";

  /**
   * The same 0-100 step-5 configuration the four criteria use, with `required` cleared. Criterion (d) fixes
   * a required slider, where the required check catches an empty submission on its own; an optional slider
   * is the case that has nothing else standing behind the shape check.
   */
  const buildOptionalElement = (): TSurveySliderElement =>
    ({
      id: OPTIONAL_ELEMENT_ID,
      type: TSurveyElementTypeEnum.Slider,
      headline: { default: "Pick a value" },
      required: false,
      range: { min: 0, max: 100 },
      step: 5,
    }) as unknown as TSurveySliderElement;

  // `""`, `[]` and `{}` are shapes the generic emptiness helper reads as "no answer", which is the right
  // reading for the text and choice contracts. A slider answer is a single number, so these are present
  // values of the wrong type: they must be rejected rather than waved through as an unanswered optional.
  test.each([
    ["an empty string", ""],
    ["an empty array", []],
    ["an empty record", {}],
  ] as [string, TResponseDataValue][])("should reject %s keyed for an optional slider", (_label, value) => {
    const element = buildOptionalElement();

    const result = validateElementResponse(element, value, "en");

    expect(result.valid).toBe(false);
    // One mistake, one error: the shape check owns a wrongly typed answer outright, so neither the range
    // rules nor the grid rule - which also fail closed on a non-number - restate the same complaint.
    expect(result.errors.map((error) => error.ruleId)).toEqual(["sliderValueType"]);
    expect(result.errors[0].message).toBe("errors.invalid_format");

    // ...and through the shared block entrypoint every response route reaches, which is where a wrongly
    // shaped answer would otherwise have been accepted and persisted.
    const errorMap = validateBlockResponses([element], { [OPTIONAL_ELEMENT_ID]: value }, "en");

    expect(Object.keys(errorMap)).toEqual([OPTIONAL_ELEMENT_ID]);
    expect(errorMap[OPTIONAL_ELEMENT_ID].map((error) => error.ruleId)).toEqual(["sliderValueType"]);
  });

  test("should keep a genuinely unanswered optional slider valid", () => {
    const element = buildOptionalElement();

    // Absence, unlike an empty shape, is a legitimate submission for an optional element.
    expect(validateElementResponse(element, undefined, "en").valid).toBe(true);
    expect(
      Object.keys(validateBlockResponses([element], { [OPTIONAL_ELEMENT_ID]: undefined }, "en"))
    ).toEqual([]);
  });

  test("should accept a valid numeric answer for an optional slider", () => {
    const result = validateElementResponse(buildOptionalElement(), 50, "en");

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

/**
 * Criterion (a) proves one well-formed configuration round-trips, which an implementation with no
 * refinements at all would also satisfy. The contract's other half is what the schema must REFUSE:
 * `min >= max` and `step <= 0` are rejections the specification states outright, and the four guards
 * after them exist because a configuration can be individually well-typed yet still describe a grid on
 * which no answer could ever validate. Each case below pins the exact `path` and message, because the
 * path is what steers the editor's error to the offending field and the message is what the author reads.
 */
describe("slider schema rejects a configuration no answer could satisfy", () => {
  /**
   * Only the range and the step vary; everything else is the criteria's own valid element, so a failure
   * here is always attributable to the configuration under test rather than to the surrounding fixture.
   */
  const parseSliderConfig = (config: { range: { min: number; max: number }; step: number }) =>
    ZSurveySliderElement.safeParse({
      id: SLIDER_ELEMENT_ID,
      type: TSurveyElementTypeEnum.Slider,
      headline: { default: "Pick a value" },
      required: true,
      ...config,
    });

  interface RejectionCase {
    readonly label: string;
    readonly range: { min: number; max: number };
    readonly step: number;
    readonly path: readonly string[];
    readonly message: string;
  }

  const rejectionCases: RejectionCase[] = [
    // --- The two rejections the specification states outright -----------------------------------
    {
      label: "a minimum equal to the maximum",
      range: { min: 10, max: 10 },
      step: 1,
      path: ["range"],
      message: "Minimum value must be less than the maximum value",
    },
    {
      label: "a minimum above the maximum",
      range: { min: 50, max: 10 },
      step: 1,
      path: ["range"],
      message: "Minimum value must be less than the maximum value",
    },
    {
      label: "a minimum above the maximum by a fraction",
      range: { min: 0.2, max: 0.1 },
      step: 0.05,
      path: ["range"],
      message: "Minimum value must be less than the maximum value",
    },
    {
      label: "a step of exactly zero",
      range: { min: 0, max: 100 },
      step: 0,
      path: ["step"],
      message: "Step must be greater than zero",
    },
    {
      label: "a negative step",
      range: { min: 0, max: 100 },
      step: -5,
      path: ["step"],
      message: "Step must be greater than zero",
    },
    // --- The derived guards: each admits a grid carrying no selectable answer -------------------
    {
      label: "a step wider than the range",
      range: { min: 0, max: 10 },
      step: 20,
      path: ["step"],
      message: "Step cannot be larger than the range",
    },
    {
      label: "two finite bounds whose span overflows to infinity",
      range: { min: -Number.MAX_VALUE, max: Number.MAX_VALUE },
      step: 1,
      path: ["range"],
      message: "The range is too wide to be represented",
    },
    {
      label: "a step the range's magnitude swallows whole",
      // At 1e30 the double nearest 1e30 + 1 is 1e30 itself, so the grid collapses to its origin.
      range: { min: 0, max: 1e30 },
      step: 1,
      path: ["step"],
      message: "Step is too small to be applied across the range",
    },
    {
      label: "a step needing more decimal places than the grid rule can restate",
      // Small enough magnitudes that the swallowing guard above passes, leaving the shared
      // MAX_GRID_DECIMAL_SCALE limit as the only thing standing between the author and a slider whose
      // every answer the grid rule would fail closed on.
      range: { min: 0, max: 1e-300 },
      step: 1e-301,
      path: ["step"],
      message: "Step is too precise to be validated",
    },
    {
      label: "a grid origin needing more decimal places than the grid rule can restate",
      range: { min: 1e-320, max: 100 },
      step: 5,
      path: ["range"],
      message: "Minimum value is too precise to be validated",
    },
  ];

  test.each(rejectionCases)("should reject $label", ({ range, step, path, message }) => {
    const parsed = parseSliderConfig({ range, step });

    expect(parsed.success).toBe(false);
    // The throw narrows `safeParse`; without it `parsed.error` is not reachable on the union.
    if (parsed.success) {
      throw new Error(`Expected the configuration to be rejected, but it parsed successfully.`);
    }

    // One mistake, one error: each guard returns after reporting, so the author is never shown two
    // complaints about a single misconfiguration.
    expect(parsed.error.issues).toHaveLength(1);
    expect(parsed.error.issues[0].code).toBe("custom");
    expect(parsed.error.issues[0].path).toEqual(path);
    expect(parsed.error.issues[0].message).toBe(message);
  });

  test("should report the bounds and the step separately when both are wrong", () => {
    // Two independent mistakes, so - unlike the derived guards - both must be surfaced: fixing only the
    // one the editor happened to highlight would otherwise leave the element still unpublishable.
    const parsed = parseSliderConfig({ range: { min: 10, max: 10 }, step: 0 });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected the configuration to be rejected, but it parsed successfully.");
    }

    expect(parsed.error.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [["range"], "Minimum value must be less than the maximum value"],
      [["step"], "Step must be greater than zero"],
    ]);
  });

  test("should reject a non-finite bound at the field itself", () => {
    // `.finite()` on the bound fires before the refinements, so the author is pointed at `range.min`
    // rather than at the range as a whole.
    const parsed = parseSliderConfig({ range: { min: Number.NEGATIVE_INFINITY, max: 100 }, step: 5 });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected the configuration to be rejected, but it parsed successfully.");
    }

    expect(parsed.error.issues.some((issue) => issue.path.join(".") === "range.min")).toBe(true);
  });

  test("should reject a non-finite step at the field itself", () => {
    const parsed = parseSliderConfig({ range: { min: 0, max: 100 }, step: Number.POSITIVE_INFINITY });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected the configuration to be rejected, but it parsed successfully.");
    }

    expect(parsed.error.issues.some((issue) => issue.path.join(".") === "step")).toBe(true);
  });

  // Positive controls. Without these the table above could be satisfied by a schema that rejects
  // everything, which would break authoring rather than protect it.
  test.each([
    ["the criteria's own configuration", { min: 0, max: 100 }, 5],
    ["a step exactly equal to the span", { min: 0, max: 10 }, 10],
    ["a decimal step", { min: 0, max: 10 }, 0.5],
    ["a grid that does not start at zero", { min: 10, max: 50 }, 5],
    ["bounds either side of zero", { min: -50, max: 50 }, 25],
  ] as [string, { min: number; max: number }, number][])("should accept %s", (_label, range, step) => {
    const parsed = parseSliderConfig({ range, step });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw parsed.error;
    }

    expect(parsed.data.range).toEqual(range);
    expect(parsed.data.step).toBe(step);
  });
});

/**
 * The grid rule is a security constraint: it is what rejects an off-grid value posted straight to a
 * response endpoint, bypassing the browser control entirely. The validator reaches its `step` and
 * `offset` through a cast, so the schema is the only thing standing between a malformed rule and a
 * validator object carrying no usable step at all.
 *
 * `params` on its own is a plain, non-discriminated union, which is exactly why the coupling below is
 * needed rather than redundant - see the first test.
 */
describe("ZValidationRules couples stepMultipleOf with its own params and fails closed", () => {
  const GRID_PARAMS_MESSAGE =
    "stepMultipleOf requires a finite positive step and, when present, a finite offset";

  /**
   * Deliberately untyped `params`: half of these cases describe rules the type system forbids, which is
   * precisely the shape that arrives from a database column or a request body.
   */
  const buildGridRule = (params: unknown, id = "grid-rule") => ({ id, type: "stepMultipleOf", params });

  test("should be the only layer that catches params borrowed from another numeric rule", () => {
    // `{ min: 1 }` satisfies the plain params union through its minValue member, so a single rule passes
    // `ZValidationRule` while carrying no `step` whatsoever. Were the array schema not refined, the grid
    // validator would receive that object cast to its own params type and read `step` as `undefined`.
    const borrowedParams = buildGridRule({ min: 1 });

    expect(ZValidationRule.safeParse(borrowedParams).success).toBe(true);

    const parsed = ZValidationRules.safeParse([borrowedParams]);

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected the rule list to be rejected, but it parsed successfully.");
    }

    expect(
      parsed.error.issues.some(
        (issue) =>
          issue.code === "custom" &&
          issue.message === GRID_PARAMS_MESSAGE &&
          issue.path.length === 2 &&
          issue.path[0] === 0 &&
          issue.path[1] === "params"
      )
    ).toBe(true);
  });

  test.each([
    ["params carrying no step at all", {}],
    ["params carrying another rule's key instead of a step", { min: 1 }],
    ["a step of exactly zero", { step: 0 }],
    ["a negative step", { step: -5 }],
    ["an infinite step", { step: Number.POSITIVE_INFINITY }],
    ["a negatively infinite step", { step: Number.NEGATIVE_INFINITY }],
    ["a NaN step", { step: Number.NaN }],
    ["an infinite offset beside a valid step", { step: 5, offset: Number.POSITIVE_INFINITY }],
    ["a NaN offset beside a valid step", { step: 5, offset: Number.NaN }],
  ] as [string, unknown][])("should reject %s", (_label, params) => {
    const parsed = ZValidationRules.safeParse([buildGridRule(params)]);

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected the rule list to be rejected, but it parsed successfully.");
    }

    const coupling = parsed.error.issues.find((issue) => issue.code === "custom");

    expect(coupling).toBeDefined();
    expect(coupling?.path).toEqual([0, "params"]);
    expect(coupling?.message).toBe(GRID_PARAMS_MESSAGE);
  });

  test("should point at the offending rule rather than at the first one", () => {
    const parsed = ZValidationRules.safeParse([
      { id: "min-rule", type: "minValue", params: { min: 1 } },
      buildGridRule({ step: 0 }),
    ]);

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected the rule list to be rejected, but it parsed successfully.");
    }

    const coupling = parsed.error.issues.find((issue) => issue.code === "custom");

    expect(coupling?.path).toEqual([1, "params"]);
    expect(coupling?.message).toBe(GRID_PARAMS_MESSAGE);
  });

  test.each([
    ["a step and an explicit offset", { step: 5, offset: 10 }],
    ["a step with the offset omitted", { step: 2.5 }],
    ["a negative offset, which anchors a grid below zero", { step: 5, offset: -10 }],
  ] as [string, Record<string, number>][])("should accept %s", (_label, params) => {
    const parsed = ZValidationRules.safeParse([buildGridRule(params)]);

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw parsed.error;
    }

    // Round-tripped verbatim: the validator reads these two numbers directly, so neither may be
    // defaulted, coerced or dropped on the way through.
    expect(parsed.data).toEqual([{ id: "grid-rule", type: "stepMultipleOf", params }]);
  });

  test("should leave every other rule type's behaviour unchanged", () => {
    // The coupling is scoped to one rule type on purpose. `maxValue` paired with a minValue-shaped
    // params object is tolerated exactly as it was before the grid rule existed, so the refinement
    // tightens nothing it was not written to tighten.
    expect(ZValidationRules.safeParse([{ id: "r1", type: "minValue", params: { min: 1 } }]).success).toBe(
      true
    );
    expect(ZValidationRules.safeParse([{ id: "r1", type: "maxValue", params: { min: 1 } }]).success).toBe(
      true
    );
    expect(ZValidationRules.safeParse([{ id: "r1", type: "email", params: {} }]).success).toBe(true);
    expect(ZValidationRules.safeParse([]).success).toBe(true);
  });
});
