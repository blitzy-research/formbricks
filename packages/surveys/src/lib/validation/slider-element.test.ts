// @vitest-environment happy-dom
import type { TFunction } from "i18next";
import { describe, expect, test, vi } from "vitest";
import { ZResponseData } from "@formbricks/types/responses";
import type { TResponseData } from "@formbricks/types/responses";
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

/**
 * Acceptance specification for the Slider element type.
 *
 * Each test below maps one-to-one onto one of the four acceptance criteria stated for the feature, in
 * order, so a failure names the criterion it breaks:
 *
 *   (a) a survey containing a slider configured min 0 / max 100 / step 5 round-trips through the schema;
 *   (b) a valid in-range, on-grid value of 50 validates and persists as a number;
 *   (c) an out-of-range value of 105 and an off-grid value of 7 are both rejected;
 *   (d) a required slider submitted with no value is rejected.
 *
 * The evaluator entrypoints exercised here are the same ones the respondent renderer and every response
 * route reach - the server wrapper in apps/web delegates straight to `validateBlockResponses` - so proving
 * the constraints here proves them for the server as well.
 *
 * `getTranslations` is mocked to echo its key, so every assertion on an error `message` asserts the
 * translation KEY rather than translated English text.
 */
const SLIDER_ELEMENT_ID = "slider1";

/**
 * Build the Slider fixture the acceptance criteria describe: a required slider spanning 0 to 100 on a
 * step-5 grid with both scale labels populated. A single configuration serves all four criteria, which
 * keeps them measured against exactly the element the criteria specify.
 *
 * `showValue` is deliberately absent from the literal so criterion (a) can prove the schema applies its
 * `true` default. The literal is cast rather than produced by the schema - a schema-produced fixture could
 * not then be used to exercise that schema - which is the established fixture idiom in this folder.
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
    // Narrow the discriminated result. The assertion above has already failed the test on a rejection, so
    // this throw is unreachable in practice; it exists so the round-trip assertions below run against a
    // fully typed element instead of being silently skipped inside an `if (parsed.success)` block.
    if (!parsed.success) {
      throw parsed.error;
    }

    // The literal - not merely the enum member - is the persisted discriminator and the value the public
    // API advertises, so pin both the enum and the parsed output to it.
    expect(TSurveyElementTypeEnum.Slider).toBe("slider");
    expect(parsed.data.type).toBe(TSurveyElementTypeEnum.Slider);

    // "Round-trips" means every configured value survives parsing unchanged.
    expect(parsed.data.range).toEqual({ min: 0, max: 100 });
    expect(parsed.data.step).toBe(5);
    expect(parsed.data.headline).toEqual({ default: "How likely are you to recommend us?" });
    expect(parsed.data.lowerLabel).toEqual({ default: "Low" });
    expect(parsed.data.upperLabel).toEqual({ default: "High" });
    expect(parsed.data.required).toBe(true);

    // ...and that the optional show-value flag defaults to true when omitted from the input.
    expect(parsed.data.showValue).toBe(true);

    // A survey holds its elements as `ZSurveyElements` on every block, so parsing the element list is what
    // proves a *survey* containing a slider is valid - it exercises the slider member appended to the
    // element union rather than the element schema in isolation.
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

    // The same value through the shared block entrypoint every response route reaches.
    const errorMap = validateBlockResponses([element], { [SLIDER_ELEMENT_ID]: 50 }, "en");

    expect(Object.keys(errorMap)).toHaveLength(0);

    // "Persists as a number": the answer keeps its numeric type through the response-data contract, so no
    // widening of `ZResponseDataValue` was needed to store a slider answer.
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

    // 7 sits inside the range but off the step-5 grid, so only the stepMultipleOf rule can reject it. The
    // two values are asserted independently, and by rule identity rather than by `valid` alone: a bare
    // rejection could be produced by the wrong mechanism, and a combined "one of them failed" assertion
    // would let one of the two pass unnoticed.
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

    // A key present with an undefined value is equally unanswered.
    const undefinedMap = validateBlockResponses([element], { [SLIDER_ELEMENT_ID]: undefined }, "en");

    expect(Object.keys(undefinedMap)).toEqual([SLIDER_ELEMENT_ID]);
    expect(undefinedMap[SLIDER_ELEMENT_ID][0].ruleId).toBe("required");

    // Supplementary, and the one place a naive emptiness check would silently break the feature: numeric 0
    // is an ANSWER, not an empty value. This slider's minimum is 0, so 0 is its lowest selectable value and
    // a required slider answered with it must validate.
    const zero = validateElementResponse(element, 0, "en");

    expect(zero.valid).toBe(true);
    expect(zero.errors).toHaveLength(0);
  });
});
