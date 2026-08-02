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

    // The element id is submitted as a KEY carrying an empty value. Production validation only ever runs
    // for elements whose id appears in the submitted response data, so omitting the key entirely would let
    // this criterion pass vacuously without exercising the required check at all.
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
