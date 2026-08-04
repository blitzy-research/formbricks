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
import type { TSurveyElement, TSurveySliderElement } from "@formbricks/types/surveys/elements";
import { ZValidationRules } from "@formbricks/types/surveys/validation-rules";
import type { TValidationRuleParams } from "@formbricks/types/surveys/validation-rules";
import { validateBlockResponses, validateElementResponse } from "./evaluator";
import { validators } from "./validators";

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

  /**
   * Acceptance criterion (b).
   *
   * What is provable here is that the value is accepted and that its numeric type satisfies the response-data
   * contract every response route parses its payload with - this package has no database, so the write itself
   * is out of its reach. Nothing about storage needs to be added for it: `ZResponseDataValue` already admits
   * `z.number()`, and the persisted column is JSON typed by exactly the contract asserted below, so a value
   * that survives it is stored as the number it is.
   */
  test("(b) a valid in-range, on-grid value of 50 validates and keeps its numeric type", () => {
    const element = buildSliderElement();

    const result = validateElementResponse(element, 50, "en");

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);

    // The same value through the block-level evaluator that server response validation uses.
    const errorMap = validateBlockResponses([element], { [SLIDER_ELEMENT_ID]: 50 }, "en");

    expect(Object.keys(errorMap)).toHaveLength(0);

    // The answer keeps its numeric type through the response-data contract that the persisted column is typed
    // by. That is a necessary condition for "persists as a number", not the whole of it - see the docblock.
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
    // sends for a slider that was rendered and left untouched, and the shape the feature's acceptance
    // criterion is stated in. The engine does not depend on the key being there - the test immediately below
    // proves an absent key is rejected identically, because `validateBlockResponses` iterates the ELEMENTS it
    // is handed rather than the keys it receives.
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
    // same required check an empty string meets. The engine therefore refuses an unanswered required slider on
    // whichever shape it is given, and it does so for every caller that hands it the element - the respondent
    // runtime, which validates the whole block it rendered, as much as the server.
    //
    // Which elements a given caller hands over is that caller's question, not this engine's, and the answer is
    // deliberately not uniform: the server-side wrapper validates the elements whose ids appear in the
    // submitted data, which is the platform-wide contract every element type has been ingested under since
    // "fix: always validate only responseData fields in client/management APIs" (#7292/#7296) and is asserted
    // by that module's own suite. Pinning the engine's behaviour here keeps this property provable
    // independently of that decision, so a future change to which elements are submitted for validation
    // inherits a required check that already works.
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
   * A 0.2 grid whose values scale past `Number.MAX_SAFE_INTEGER`.
   *
   * The configuration itself is legitimate - `min < max`, a positive step no wider than the range - so an
   * author can publish it and the evaluator injects the range and grid rules for it exactly as it does for
   * the reference element. What this suite pins is the grid rule's arithmetic at a magnitude where double
   * arithmetic is no longer exact: the spacing between representable doubles at 1e15 is 0.125, so
   * reconstructing the nearest grid point in doubles lands back on the submitted value and would measure a
   * drift of zero for a value half a step off the grid.
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

  test("the high-magnitude configuration is a lawful one, so its answers are judged by the rules", () => {
    expect(ZSurveySliderElement.safeParse(buildHighMagnitudeElement()).success).toBe(true);
  });

  // Each value below is a whole half-step off the grid - the largest miss the grid admits, not a rounding
  // artefact - and each is in range.
  test.each([
    ["a half-step above a grid point", 1000000000000000.5],
    ["a half-step below the next grid point", 1000000000000000.9],
  ])("should reject %s at the grid rule itself", (_label, value) => {
    expect(validators.stepMultipleOf.check(value, { step: 0.2, offset: 0 }, {} as TSurveyElement).valid).toBe(
      false
    );
  });

  test("should still accept a genuinely aligned value at the same magnitude", () => {
    // 1000000000000000.4 is 5000000000000002 whole steps of 0.2 above the minimum, so the rule's exactness
    // cuts both ways: it does not reject a value merely for being large.
    expect(
      validators.stepMultipleOf.check(1000000000000000.4, { step: 0.2, offset: 0 }, {} as TSurveyElement)
        .valid
    ).toBe(true);
  });

  test("should carry that exactness through validateBlockResponses, which is what every route reaches", () => {
    const element = buildHighMagnitudeElement();

    const offGrid = validateBlockResponses(
      [element],
      { [HIGH_MAGNITUDE_ELEMENT_ID]: 1000000000000000.5 },
      "en"
    );

    expect(Object.keys(offGrid)).toEqual([HIGH_MAGNITUDE_ELEMENT_ID]);
    expect(offGrid[HIGH_MAGNITUDE_ELEMENT_ID].map((error) => error.ruleType)).toEqual(["stepMultipleOf"]);

    // The aligned value at the same magnitude is accepted, so the rejection above is attributable to the
    // grid rather than to the size of the number.
    expect(
      Object.keys(
        validateBlockResponses([element], { [HIGH_MAGNITUDE_ELEMENT_ID]: 1000000000000000.4 }, "en")
      )
    ).toEqual([]);
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
    expect(result.errors.map((error) => error.ruleType)).toEqual(["valueType"]);
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
 * refinements at all would also satisfy. The contract's other half is what the schema must REFUSE, and it
 * refuses exactly three things: `min >= max` and `step <= 0`, which the specification states outright, and
 * a step wider than the range, which would leave only the minimum selectable. Nothing else is a
 * publish-time restriction. Each case below pins the exact `path` and message, because the path is what
 * steers the editor's error to the offending field and the message is what the author reads.
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
    // --- The one derived guard: a grid carrying a single selectable answer -----------------------
    {
      label: "a step wider than the range",
      range: { min: 0, max: 10 },
      step: 20,
      path: ["step"],
      message: "Step cannot be larger than the range",
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

  test("should be refused by the server as well when such a configuration is already persisted", () => {
    // The schema is only reached by a survey saved through the editor's validated path; the draft autosave
    // path persists an element without it. So a step wider than its span can reach a live survey, and the
    // one value its degenerate grid contains - the minimum - is the answer that would otherwise be accepted
    // and stored. Both entrypoints every response route reaches must refuse it.
    const malformed = {
      id: SLIDER_ELEMENT_ID,
      type: TSurveyElementTypeEnum.Slider,
      headline: { default: "Pick a value" },
      required: true,
      range: { min: 0, max: 10 },
      step: 20,
    } as unknown as TSurveySliderElement;

    expect(parseSliderConfig({ range: { min: 0, max: 10 }, step: 20 }).success).toBe(false);

    const single = validateElementResponse(malformed, 0, "en");
    expect(single.valid).toBe(false);
    expect(single.errors.map((error) => error.ruleId)).toEqual(["sliderConfiguration"]);
    // The element's definition is what failed, so the category names that rather than a rule that never ran.
    expect(single.errors.map((error) => error.ruleType)).toEqual(["elementConfiguration"]);
    expect(single.errors[0].message).toBe("errors.invalid_format");

    const errorMap = validateBlockResponses([malformed], { [SLIDER_ELEMENT_ID]: 0 }, "en");
    expect(Object.keys(errorMap)).toEqual([SLIDER_ELEMENT_ID]);
    expect(errorMap[SLIDER_ELEMENT_ID].map((error) => error.ruleId)).toEqual(["sliderConfiguration"]);
  });

  test("should reject a NaN bound or step, which `z.number()` refuses on its own", () => {
    // Worth pinning because NaN defeats every comparison the refinements make: `NaN >= max`, `NaN <= 0`
    // and `NaN > span` are all false, so the refinements alone would wave it through.
    expect(parseSliderConfig({ range: { min: Number.NaN, max: 100 }, step: 5 }).success).toBe(false);
    expect(parseSliderConfig({ range: { min: 0, max: 100 }, step: Number.NaN }).success).toBe(false);
  });

  /**
   * One contract, read by both entry points.
   *
   * The schema decides which configurations an author may publish. The response evaluator reads the SAME
   * three facts - `min < max`, `step > 0`, a step no wider than the range - before injecting the range and
   * grid rules, so a configuration the schema accepts is one the evaluator can check answers against, and a
   * configuration the schema refuses is one the evaluator fails closed on. The second direction matters
   * because such an element can still reach the runtime through the editor's draft autosave path, which does
   * not parse the element schema.
   *
   * The evaluator's read is additionally DEFENSIVE, which is the one place the two deliberately diverge: it
   * also declines a bound or step that is not a finite number, because the compiled type only promises these
   * fields exist and the three rules are derived from these very figures. That is a fail-closed refusal at
   * response time, not a restriction on what an author may save - and it is asserted below so the divergence
   * is recorded rather than incidental.
   */
  describe("the schema and the response evaluator share one numeric domain", () => {
    const buildSliderWithConfig = (config: {
      range: { min: number; max: number };
      step: number;
    }): TSurveySliderElement =>
      ({
        id: SLIDER_ELEMENT_ID,
        type: TSurveyElementTypeEnum.Slider,
        headline: { default: "Pick a value" },
        required: true,
        ...config,
      }) as unknown as TSurveySliderElement;

    const unusableConfigs: { label: string; range: { min: number; max: number }; step: number }[] = [
      { label: "a minimum equal to the maximum", range: { min: 10, max: 10 }, step: 1 },
      { label: "a minimum above the maximum", range: { min: 50, max: 10 }, step: 1 },
      { label: "a step of zero", range: { min: 0, max: 100 }, step: 0 },
      { label: "a negative step", range: { min: 0, max: 100 }, step: -5 },
      { label: "a step wider than the span", range: { min: 0, max: 10 }, step: 20 },
      // An infinite step is wider than every finite range, so it is refused by the third refinement rather
      // than needing a rule of its own.
      { label: "an infinite step", range: { min: 0, max: 100 }, step: Number.POSITIVE_INFINITY },
    ];

    test.each(unusableConfigs)(
      "rejects $label at the schema and fails closed at the evaluator",
      ({ range, step }) => {
        expect(parseSliderConfig({ range, step }).success).toBe(false);

        // A submitted answer is refused rather than passed through unconstrained, and with a validation
        // error rather than the TypeError an unguarded configuration read would raise.
        const result = validateElementResponse(buildSliderWithConfig({ range, step }), 50, "en");

        expect(result.valid).toBe(false);
        expect(result.errors.some((error) => error.ruleId === "sliderConfiguration")).toBe(true);
      }
    );

    test.each([
      { label: "an infinite minimum", range: { min: Number.NEGATIVE_INFINITY, max: 100 }, step: 5 },
      { label: "an infinite maximum", range: { min: 0, max: Number.POSITIVE_INFINITY }, step: 5 },
    ])(
      "accepts $label at the schema, because `z.number()` admits it, and still fails closed at the evaluator",
      ({ range, step }) => {
        // The publish-time contract is the three refinements and nothing more, so these parse. The
        // evaluator's defensive read declines them, because a rule derived from an infinite bound places the
        // grid nowhere - so the answer is refused with the accurate structural reason instead.
        expect(parseSliderConfig({ range, step }).success).toBe(true);

        const result = validateElementResponse(buildSliderWithConfig({ range, step }), 50, "en");

        expect(result.valid).toBe(false);
        expect(result.errors.map((error) => error.ruleId)).toEqual(["sliderConfiguration"]);
        expect(result.errors.map((error) => error.ruleType)).toEqual(["elementConfiguration"]);
      }
    );

    // `above` is stated per case rather than derived as `max + step`, because a step finer than its own
    // maximum can express adds nothing to it: `1 + 1e-20` is exactly `1` in doubles, so the derived probe
    // would land back on the maximum and prove nothing.
    test.each([
      { label: "the reference grid", range: { min: 0, max: 100 }, step: 5, value: 50, above: 105 },
      // A whole-number grid of 1e15 points: every one of them is an integer a double holds exactly, so
      // magnitude alone disqualifies nothing.
      {
        label: "a grid at whole-number extremes",
        range: { min: 0, max: 1e15 },
        step: 1,
        value: 1e15,
        above: 2e15,
      },
      { label: "a grid offset from zero", range: { min: 10, max: 50 }, step: 5, value: 15, above: 55 },
      // A grid an earlier, over-restrictive precision policy refused. It is lawful under the frozen
      // contract, so it must be checked by the injected rules like every other lawful configuration.
      {
        label: "a grid finer than the range's own scale",
        range: { min: 0, max: 1 },
        step: 1e-20,
        value: 0,
        above: 2,
      },
    ])(
      "accepts $label at the schema and checks answers against it at the evaluator",
      ({ range, step, value, above }) => {
        expect(parseSliderConfig({ range, step }).success).toBe(true);

        const element = buildSliderWithConfig({ range, step });

        expect(validateElementResponse(element, value, "en").valid).toBe(true);
        // The configuration is trusted, so the rules that constrain the answer are the injected ones -
        // never the structural "this element cannot be checked" refusal.
        const aboveMaximum = validateElementResponse(element, above, "en");

        expect(aboveMaximum.valid).toBe(false);
        expect(aboveMaximum.errors.some((error) => error.ruleId === "sliderConfiguration")).toBe(false);
        expect(aboveMaximum.errors.some((error) => error.ruleType === "maxValue")).toBe(true);
      }
    );
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
 * response endpoint, bypassing the browser control entirely. That makes it worth being exact about which
 * layer answers which question, because the rule is deliberately not the one that answers all of them.
 *
 * A step that describes no grid is a CONFIGURATION mistake, and the frozen contract assigns it to the
 * layers that own configuration rather than to this rule: the element schema rejects it with an
 * author-facing message, and the evaluator refuses to inject these rules at all for a slider whose
 * configuration it cannot read, rejecting the submitted answer through its own configuration gate instead.
 * The rule therefore passes such an answer through - it has no grid to judge it against, and reporting a
 * configuration mistake as if it were the respondent's would be wrong on a value that may be entirely
 * valid. The suite below pins that division, and then pins the layers that DO reject the configuration, so
 * the constraint provably has not gone missing.
 *
 * The origin is a different question with a different answer. There, a grid does exist and an origin that
 * is not a finite number simply places it nowhere, so the value cannot be shown to sit on it and the rule
 * rejects. Both halves are asserted here because `params` is a plain, non-discriminated union - `{ min: 1 }`
 * satisfies it through the `minValue` member - so either shape genuinely can reach the validator's cast.
 */
describe("stepMultipleOf defers a step that describes no grid to the configuration layers", () => {
  test.each([
    ["params carrying no step at all", {}],
    ["params carrying another rule's key instead of a step", { min: 1 }],
    ["a step of exactly zero", { step: 0 }],
    ["a negative step", { step: -5 }],
    ["an infinite step", { step: Number.POSITIVE_INFINITY }],
    ["a negatively infinite step", { step: Number.NEGATIVE_INFINITY }],
    ["a NaN step", { step: Number.NaN }],
  ] as [string, unknown][])("should pass an answer judged against %s", (_label, params) => {
    const result = validators.stepMultipleOf.check(
      50,
      params as TValidationRuleParams,
      {} as TSurveySliderElement
    );

    expect(result.valid).toBe(true);
  });

  test.each([
    ["an infinite offset beside a valid step", { step: 5, offset: Number.POSITIVE_INFINITY }],
    ["a NaN offset beside a valid step", { step: 5, offset: Number.NaN }],
  ] as [string, unknown][])("should reject an answer judged against %s", (_label, params) => {
    // 50 is on the grid of every well-formed variant of these params, so a `true` here could only mean the
    // grid had been placed somewhere the value happened to land rather than measured from a real origin.
    const result = validators.stepMultipleOf.check(
      50,
      params as TValidationRuleParams,
      {} as TSurveySliderElement
    );

    expect(result.valid).toBe(false);
  });

  test.each([
    ["a step and an explicit offset", { step: 5, offset: 10 }],
    ["a step with the offset omitted", { step: 2.5 }],
    ["a negative offset, which anchors a grid below zero", { step: 5, offset: -10 }],
  ] as [string, TValidationRuleParams][])("should still judge %s normally", (_label, params) => {
    expect(validators.stepMultipleOf.check(50, params, {} as TSurveySliderElement).valid).toBe(true);
  });

  test("should still reject the whole answer when the element's own step describes no grid", () => {
    // Where the deferral goes. A slider carrying a step the schema would never have accepted is not left
    // unconstrained: the evaluator reads the configuration first, cannot trust it, and rejects the submitted
    // value outright rather than injecting three rules derived from numbers it does not believe. The value
    // used here is on the intended 0..100 grid, so the rejection is attributable to the configuration alone.
    const brokenElement = { ...buildSliderElement(), step: 0 } as TSurveySliderElement;

    const result = validateElementResponse(brokenElement, 50, "en");

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].ruleId).toBe("sliderConfiguration");
    expect(result.errors[0].message).toBe("errors.invalid_format");

    // ...and the same element cannot be saved in the first place, which is the layer that reports the mistake
    // to the author in terms they can act on.
    expect(ZSurveySliderElement.safeParse(brokenElement).success).toBe(false);
  });

  test("should leave the rule list schema exactly as permissive as it was", () => {
    // `ZValidationRules` is an unrefined array, as it is for every other rule type: the pairing is not
    // enforced there, which is why the validator has to answer for mismatched params at all - by deferring a
    // missing grid to the configuration layers above, and by rejecting an unplaceable origin itself.
    expect(
      ZValidationRules.safeParse([{ id: "grid-rule", type: "stepMultipleOf", params: { min: 1 } }]).success
    ).toBe(true);
    expect(ZValidationRules.safeParse([{ id: "r1", type: "minValue", params: { min: 1 } }]).success).toBe(
      true
    );
    expect(ZValidationRules.safeParse([]).success).toBe(true);
  });
});
