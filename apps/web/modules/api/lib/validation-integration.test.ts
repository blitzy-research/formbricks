import { describe, expect, test } from "vitest";
import type { TResponseData } from "@formbricks/types/responses";
import type { TSurveyBlock } from "@formbricks/types/surveys/blocks";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import type { TSurveySliderElement } from "@formbricks/types/surveys/elements";
import type { TSurveyQuestion } from "@formbricks/types/surveys/types";
import {
  formatValidationErrorsForV1Api,
  formatValidationErrorsForV2Api,
  validateResponseData,
} from "@/modules/api/lib/validation";

/**
 * Integration coverage for the server-side response validation wrapper.
 *
 * `validation.test.ts` beside this file is the unit suite for the wrapper's own branching, and it replaces
 * `@formbricks/surveys/validation`, `@/lib/survey/utils` and the question transformer with mocks. That is the
 * right shape for asserting which arguments the wrapper passes, but it means nothing about the wrapper is ever
 * proven against the engine it actually delegates to: the package export could be renamed, the subpath export
 * could stop resolving, the element list could be filtered wrongly, or an error could be swallowed on the way
 * back, and every one of those suites would still pass.
 *
 * This file mocks NOTHING. It imports the real wrapper, which imports the real `validateBlockResponses` through
 * the `@formbricks/surveys/validation` entry point, and drives it with a real Slider element. Every one of the
 * seven response endpoints validates through this exact function, so what is asserted here is the server-side
 * contract those endpoints enforce - including the messages a respondent receives, which are resolved by the
 * engine's own translation catalog rather than by anything in this application.
 *
 * The four cases the feature's acceptance criteria name are covered end to end at this boundary: a valid
 * in-range, on-grid value; an out-of-range value; an off-grid value; and a required slider submitted with no
 * value. `slider-element.test.ts` in `packages/surveys` covers the same four against the engine directly; the
 * point of repeating them here is the wiring in between, which only an unmocked call can exercise.
 *
 * One consequence for the build: this suite resolves `@formbricks/surveys/validation` through that package's
 * built output, so `@formbricks/web#test` declares `@formbricks/surveys#build` as a dependency in `turbo.json`.
 * `turbo-build-order.test.ts` pins that declaration.
 */

const SLIDER_ID = "sliderElement";
const OPEN_TEXT_ID = "openTextElement";

/** The feature's reference configuration: 0 to 100 in steps of 5, required. */
const buildSliderElement = (overrides: Partial<TSurveySliderElement> = {}): TSurveySliderElement =>
  ({
    id: SLIDER_ID,
    type: TSurveyElementTypeEnum.Slider,
    headline: { default: "How likely are you to recommend us?" },
    required: true,
    range: { min: 0, max: 100 },
    step: 5,
    lowerLabel: { default: "Low" },
    upperLabel: { default: "High" },
    showValue: true,
    ...overrides,
  }) as unknown as TSurveySliderElement;

/** A block carrying the slider, plus an optional second element for the filtering assertions. */
const buildBlocks = (element: TSurveySliderElement = buildSliderElement()): TSurveyBlock[] =>
  [
    {
      id: "block1",
      name: "Block 1",
      elements: [
        element,
        {
          id: OPEN_TEXT_ID,
          type: TSurveyElementTypeEnum.OpenText,
          headline: { default: "Anything else?" },
          required: true,
          inputType: "text",
          charLimit: { enabled: false },
        },
      ],
    },
  ] as unknown as TSurveyBlock[];

/** Validates a single slider answer against the reference configuration. */
const validateSliderAnswer = (
  value: TResponseData[string],
  element: TSurveySliderElement = buildSliderElement()
) => validateResponseData(buildBlocks(element), { [SLIDER_ID]: value } as TResponseData, "en");

describe("validateResponseData with the real slider evaluator", () => {
  describe("acceptance criteria at the server boundary", () => {
    test("accepts an in-range, on-grid value and reports no errors at all", () => {
      // `null` rather than an empty map is the wrapper's own success signal, and every route treats it as such.
      expect(validateSliderAnswer(50)).toBeNull();
    });

    test("accepts both ends of the configured range", () => {
      // The minimum is the value the browser control parks on while unanswered, so a submitted 0 has to be
      // accepted as an answer rather than read as an absence.
      expect(validateSliderAnswer(0)).toBeNull();
      expect(validateSliderAnswer(100)).toBeNull();
    });

    test("rejects a value above the configured maximum", () => {
      const errorMap = validateSliderAnswer(105);

      expect(errorMap).not.toBeNull();
      expect(Object.keys(errorMap ?? {})).toEqual([SLIDER_ID]);
      expect(errorMap?.[SLIDER_ID]).toHaveLength(1);
      expect(errorMap?.[SLIDER_ID][0].ruleType).toBe("maxValue");
      // The message is produced by the engine's catalog, not by this application: asserting it here is what
      // proves the delegate is genuinely running rather than a stub returning a shape.
      expect(errorMap?.[SLIDER_ID][0].message).toBe("Please enter a value no greater than 100");
    });

    test("rejects a value below the configured minimum", () => {
      const errorMap = validateSliderAnswer(-5);

      expect(errorMap?.[SLIDER_ID]).toHaveLength(1);
      expect(errorMap?.[SLIDER_ID][0].ruleType).toBe("minValue");
      expect(errorMap?.[SLIDER_ID][0].message).toBe("Please enter a value of at least 0");
    });

    test("rejects an in-range value that sits off the configured grid", () => {
      // 7 is inside 0..100 and would pass every bound, so only the grid rule can reject it. This is the
      // constraint that exists solely on the server: the browser control cannot emit an off-grid value at all.
      const errorMap = validateSliderAnswer(7);

      expect(errorMap?.[SLIDER_ID]).toHaveLength(1);
      expect(errorMap?.[SLIDER_ID][0].ruleType).toBe("stepMultipleOf");
      expect(errorMap?.[SLIDER_ID][0].message).toBe("Please enter a value in increments of 5");
    });

    test("rejects a required slider submitted with its key present and no value", () => {
      // The shape a respondent's client sends for a slider that was rendered and left untouched. The key has to
      // be present, because the wrapper narrows the element list to the ids in the submitted data.
      for (const emptyValue of ["", undefined] as TResponseData[string][]) {
        const errorMap = validateResponseData(buildBlocks(), { [SLIDER_ID]: emptyValue } as TResponseData);

        expect(errorMap?.[SLIDER_ID]).toHaveLength(1);
        expect(errorMap?.[SLIDER_ID][0].ruleId).toBe("required");
        expect(errorMap?.[SLIDER_ID][0].message).toBe("Please fill out this field");
      }
    });

    test("accepts an unanswered optional slider", () => {
      // Keeps the rejection above attributable to `required` rather than to the absence itself.
      expect(
        validateResponseData(buildBlocks(buildSliderElement({ required: false })), {
          [SLIDER_ID]: undefined,
        } as TResponseData)
      ).toBeNull();
    });

    test("still rejects an empty string on an optional slider, which is a value of the wrong type", () => {
      // The distinction the numeric contract turns on: an absent value is no answer, but `""` is a present
      // value that is not a number. Treating it as an absence would let an optional slider skip the type gate
      // and the three range and grid rules alike, and persist a non-numeric answer.
      const errorMap = validateResponseData(buildBlocks(buildSliderElement({ required: false })), {
        [SLIDER_ID]: "",
      } as TResponseData);

      expect(errorMap?.[SLIDER_ID]).toHaveLength(1);
      expect(errorMap?.[SLIDER_ID][0].ruleId).toBe("sliderValueType");
      expect(errorMap?.[SLIDER_ID][0].message).toBe("Please enter a valid format");
    });
  });

  describe("the grid is measured from the element's own minimum", () => {
    const offsetElement = buildSliderElement({ range: { min: 10, max: 50 }, step: 5 });

    test("accepts values on a grid that does not start at zero", () => {
      expect(validateSliderAnswer(10, offsetElement)).toBeNull();
      expect(validateSliderAnswer(15, offsetElement)).toBeNull();
      expect(validateSliderAnswer(50, offsetElement)).toBeNull();
    });

    test("rejects a multiple of the step that is not a point of this grid", () => {
      // 12 is two off the origin rather than off a zero-anchored grid, and 5 is a multiple of the step but
      // below the range: both prove the origin reaches the server rule intact.
      expect(validateSliderAnswer(12, offsetElement)?.[SLIDER_ID][0].ruleType).toBe("stepMultipleOf");
      expect(validateSliderAnswer(5, offsetElement)?.[SLIDER_ID][0].ruleType).toBe("minValue");
    });
  });

  describe("the response contract the wrapper hands to the engine", () => {
    test("rejects a numeric string, which is not a slider answer", () => {
      // A slider answer is exactly one number. Accepting "50" here would let a client bypass the numeric
      // contract the persisted response value depends on.
      expect(validateSliderAnswer("50")).not.toBeNull();
    });

    test("rejects an array, the shape a choice element submits", () => {
      expect(validateSliderAnswer(["50"])).not.toBeNull();
    });

    test("validates only the elements whose ids appear in the submitted data", () => {
      // Both elements in the block are required, and only the slider was submitted. The open text element must
      // not be reported, because completeness is not this function's question - which is exactly the filtering
      // the mocked unit suite can only assert as an argument, never as an outcome.
      const errorMap = validateResponseData(buildBlocks(), { [SLIDER_ID]: 7 } as TResponseData);

      expect(Object.keys(errorMap ?? {})).toEqual([SLIDER_ID]);
    });

    test("reports every element that was submitted and is invalid", () => {
      const errorMap = validateResponseData(buildBlocks(), {
        [SLIDER_ID]: 7,
        [OPEN_TEXT_ID]: "",
      } as TResponseData);

      expect(Object.keys(errorMap ?? {}).sort()).toEqual([OPEN_TEXT_ID, SLIDER_ID].sort());
    });

    test("returns null when there is nothing to validate against", () => {
      expect(validateResponseData([], { [SLIDER_ID]: 7 } as TResponseData, "en", [])).toBeNull();
      expect(validateResponseData(null, { [SLIDER_ID]: 7 } as TResponseData)).toBeNull();
    });

    test("resolves messages in the requested language", () => {
      // The engine owns the catalog, so this is the one assertion that shows the language argument survives the
      // whole delegation rather than being dropped at the boundary.
      const german = validateResponseData(buildBlocks(), { [SLIDER_ID]: 7 } as TResponseData, "de");

      expect(german?.[SLIDER_ID]).toHaveLength(1);
      expect(german?.[SLIDER_ID][0].ruleType).toBe("stepMultipleOf");
      expect(german?.[SLIDER_ID][0].message).not.toBe("Please enter a value in increments of 5");
      expect(german?.[SLIDER_ID][0].message.length).toBeGreaterThan(0);
    });

    test("validates a slider reached through the legacy questions fallback", () => {
      // Surveys stored before blocks existed arrive as questions and are transformed on the way in. The slider
      // has to be validated identically on that path, since the same wrapper serves both.
      const questions = [buildSliderElement()] as unknown as TSurveyQuestion[];

      const errorMap = validateResponseData([], { [SLIDER_ID]: 7 } as TResponseData, "en", questions);

      expect(errorMap?.[SLIDER_ID]).toHaveLength(1);
      expect(errorMap?.[SLIDER_ID][0].ruleType).toBe("stepMultipleOf");
    });
  });

  describe("the shape the API routes return", () => {
    test("formats a real slider error for the v2 API", () => {
      const errorMap = validateSliderAnswer(105);
      if (!errorMap) throw new Error("expected the out-of-range value to be rejected");

      expect(formatValidationErrorsForV2Api(errorMap)).toEqual([
        {
          field: `response.data.${SLIDER_ID}`,
          issue: "Please enter a value no greater than 100",
          meta: {
            elementId: SLIDER_ID,
            ruleId: "__implicit_slider_max__",
            ruleType: "maxValue",
          },
        },
      ]);
    });

    test("formats a real slider error for the v1 API", () => {
      const errorMap = validateSliderAnswer(7);
      if (!errorMap) throw new Error("expected the off-grid value to be rejected");

      expect(formatValidationErrorsForV1Api(errorMap)).toEqual({
        [`response.data.${SLIDER_ID}`]: "Please enter a value in increments of 5",
      });
    });
  });
});
