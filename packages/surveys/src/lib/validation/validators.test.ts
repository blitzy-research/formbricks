// @vitest-environment happy-dom
import type { TFunction } from "i18next";
import { describe, expect, test, vi } from "vitest";
import { MAX_GRID_DECIMAL_SCALE, isWithinGridDecimalScale } from "@formbricks/types/surveys/constants";
import { TSurveyElementTypeEnum, ZSurveySliderElement } from "@formbricks/types/surveys/elements";
import type { TSurveyElement } from "@formbricks/types/surveys/elements";
import { validators } from "./validators";

// Mock translation function - just return the key for testing
const mockTFn = vi.fn((key: string) => {
  return key;
});
const mockT = mockTFn as unknown as TFunction;

describe("validators", () => {
  describe("minLength", () => {
    test("should return valid true when string length >= min", () => {
      const result = validators.minLength.check("hello", { min: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when string length < min", () => {
      const result = validators.minLength.check("hi", { min: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty string", () => {
      const result = validators.minLength.check("", { min: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid true when value is not a string", () => {
      const result = validators.minLength.check(123, { min: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message with translation function", () => {
      mockTFn.mockClear();
      const message = validators.minLength.getDefaultMessage({ min: 10 }, {} as TSurveyElement, mockT);
      expect(message).toBe("errors.min_length");
      expect(mockTFn).toHaveBeenCalledWith("errors.min_length", { min: 10 });
    });
  });

  describe("maxLength", () => {
    test("should return valid true when string length <= max", () => {
      const result = validators.maxLength.check("hello", { max: 10 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when string length > max", () => {
      const result = validators.maxLength.check("hello world", { max: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is not a string", () => {
      const result = validators.maxLength.check(123, { max: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message with translation function", () => {
      mockTFn.mockClear();
      const message = validators.maxLength.getDefaultMessage({ max: 100 }, {} as TSurveyElement, mockT);
      expect(message).toBe("errors.max_length");
      expect(mockTFn).toHaveBeenCalledWith("errors.max_length", { max: 100 });
    });
  });

  describe("pattern", () => {
    test("should return valid true when pattern matches", () => {
      const result = validators.pattern.check("Hello", { pattern: "^[A-Z]" }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when pattern does not match", () => {
      const result = validators.pattern.check("hello", { pattern: "^[A-Z]" }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.pattern.check("", { pattern: "^[A-Z]" }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should handle regex flags", () => {
      const result = validators.pattern.check(
        "hello",
        { pattern: "^[A-Z]", flags: "i" },
        {} as TSurveyElement
      );
      expect(result.valid).toBe(true);
    });

    test("should reject patterns longer than 512 chars", () => {
      const longPattern = "a".repeat(513);
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = validators.pattern.check("test", { pattern: longPattern }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test("should reject values longer than 4096 chars", () => {
      const longValue = "a".repeat(4097);
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = validators.pattern.check(longValue, { pattern: ".*" }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test("should handle invalid regex gracefully", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = validators.pattern.check("test", { pattern: "[invalid" }, {} as TSurveyElement);
      expect(result.valid).toBe(true); // Returns valid for invalid regex
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test("should return correct error message", () => {
      const message = validators.pattern.getDefaultMessage({ pattern: ".*" }, {} as TSurveyElement, mockT);
      expect(message).toBe("errors.invalid_format");
    });
  });

  describe("email", () => {
    test("should return valid true for valid email", () => {
      const result = validators.email.check("test@example.com", {}, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false for invalid email", () => {
      const result = validators.email.check("invalid-email", {}, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.email.check("", {}, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid true when value is not a string", () => {
      const result = validators.email.check(123, {}, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.email.getDefaultMessage({}, {} as TSurveyElement, mockT);
      expect(message).toBe("errors.please_enter_a_valid_email_address");
    });
  });

  describe("url", () => {
    test("should return valid true for valid URL", () => {
      const result = validators.url.check("https://example.com", {}, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false for invalid URL", () => {
      const result = validators.url.check("not-a-url", {}, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.url.check("", {}, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.url.getDefaultMessage({}, {} as TSurveyElement, mockT);
      expect(message).toBe("errors.please_enter_a_valid_url");
    });
  });

  describe("phone", () => {
    test("should return valid true for valid phone number", () => {
      const result = validators.phone.check("+1234567890", {}, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid true for phone with spaces and dashes", () => {
      const result = validators.phone.check("+1 234-567-890", {}, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false for invalid phone", () => {
      const result = validators.phone.check("abc123", {}, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.phone.check("", {}, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.phone.getDefaultMessage({}, {} as TSurveyElement, mockT);
      expect(message).toBe("errors.please_enter_a_valid_phone_number");
    });
  });

  describe("minValue", () => {
    test("should return valid true when value >= min", () => {
      const result = validators.minValue.check(10, { min: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when value < min", () => {
      const result = validators.minValue.check(3, { min: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should handle string numbers", () => {
      const result = validators.minValue.check("10", { min: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.minValue.check("", { min: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid true for non-numeric values", () => {
      const result = validators.minValue.check("abc", { min: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.minValue.getDefaultMessage({ min: 10 }, {} as TSurveyElement, mockT);
      expect(message).toBe("errors.min_value");
    });
  });

  describe("maxValue", () => {
    test("should return valid true when value <= max", () => {
      const result = validators.maxValue.check(5, { max: 10 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when value > max", () => {
      const result = validators.maxValue.check(15, { max: 10 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should handle string numbers", () => {
      const result = validators.maxValue.check("5", { max: 10 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.maxValue.check("", { max: 10 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.maxValue.getDefaultMessage({ max: 100 }, {} as TSurveyElement, mockT);
      expect(message).toBe("errors.max_value");
    });
  });

  describe("minValue with payment amounts", () => {
    test("should return valid when payment amount >= min", () => {
      const result = validators.minValue.check(1000, { min: 500 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when payment amount < min", () => {
      const result = validators.minValue.check(100, { min: 500 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid when payment amount equals min exactly", () => {
      const result = validators.minValue.check(500, { min: 500 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });
  });

  describe("maxValue with payment amounts", () => {
    test("should return valid when payment amount <= max", () => {
      const result = validators.maxValue.check(1000, { max: 5000 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when payment amount > max", () => {
      const result = validators.maxValue.check(10000, { max: 5000 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid when payment amount equals max exactly", () => {
      const result = validators.maxValue.check(5000, { max: 5000 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });
  });

  describe("stepMultipleOf", () => {
    test("should return valid true when the value sits on the grid", () => {
      const result = validators.stepMultipleOf.check(50, { step: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when the value sits between grid points", () => {
      const result = validators.stepMultipleOf.check(7, { step: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true for the grid origin itself", () => {
      const result = validators.stepMultipleOf.check(0, { step: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid true for a decimal step where modulo arithmetic would fail", () => {
      // 0.3 / 0.1 evaluates to 2.9999999999999996, so a modulo comparison would reject this value.
      const result = validators.stepMultipleOf.check(0.3, { step: 0.1 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false for a half-step offset on a decimal grid", () => {
      const result = validators.stepMultipleOf.check(0.35, { step: 0.1 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should measure alignment from the offset rather than from zero", () => {
      const result = validators.stepMultipleOf.check(15, { step: 5, offset: 10 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false for a value off an offset grid", () => {
      const result = validators.stepMultipleOf.check(12, { step: 5, offset: 10 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true for an aligned value of very large magnitude", () => {
      const result = validators.stepMultipleOf.check(1e12, { step: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false for a large magnitude value two units off the grid", () => {
      // A tolerance expressed as a fraction of the value would reach about 1e3 at this magnitude
      // and wrongly accept this value.
      const result = validators.stepMultipleOf.check(1e12 + 2, { step: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid false for a hundredth off the grid at a very large magnitude", () => {
      const result = validators.stepMultipleOf.check(1e12 + 0.01, { step: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should keep the tolerance below a fraction of the step on a very fine grid", () => {
      const params = { step: 1e-6, offset: 1e9 };

      const onGrid = validators.stepMultipleOf.check(1000000000.000002, params, {} as TSurveyElement);
      expect(onGrid.valid).toBe(true);

      const halfStep = validators.stepMultipleOf.check(1000000000.0000005, params, {} as TSurveyElement);
      expect(halfStep.valid).toBe(false);
    });

    test("should return valid true for an aligned value near the precision limit", () => {
      const result = validators.stepMultipleOf.check(999999.99, { step: 0.01 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false for a half-step value near the precision limit", () => {
      const result = validators.stepMultipleOf.check(999999.995, { step: 0.01 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true for an aligned value on a grid with a negative origin", () => {
      const result = validators.stepMultipleOf.check(0.02, { step: 0.01, offset: -5 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should treat an explicit zero offset exactly like an omitted one", () => {
      const onGrid = validators.stepMultipleOf.check(50, { step: 5, offset: 0 }, {} as TSurveyElement);
      expect(onGrid.valid).toBe(true);

      const offGrid = validators.stepMultipleOf.check(7, { step: 5, offset: 0 }, {} as TSurveyElement);
      expect(offGrid.valid).toBe(false);
    });

    test("should align negative values on a grid anchored at zero", () => {
      const onGrid = validators.stepMultipleOf.check(-10, { step: 5 }, {} as TSurveyElement);
      expect(onGrid.valid).toBe(true);

      const offGrid = validators.stepMultipleOf.check(-7, { step: 5 }, {} as TSurveyElement);
      expect(offGrid.valid).toBe(false);
    });

    test("should extend the grid below its own origin", () => {
      const atOrigin = validators.stepMultipleOf.check(10, { step: 5, offset: 10 }, {} as TSurveyElement);
      expect(atOrigin.valid).toBe(true);

      const belowOrigin = validators.stepMultipleOf.check(5, { step: 5, offset: 10 }, {} as TSurveyElement);
      expect(belowOrigin.valid).toBe(true);
    });

    test("should honour a fractional step that is not a power of ten", () => {
      const onGrid = validators.stepMultipleOf.check(7.5, { step: 2.5 }, {} as TSurveyElement);
      expect(onGrid.valid).toBe(true);

      const offGrid = validators.stepMultipleOf.check(8, { step: 2.5 }, {} as TSurveyElement);
      expect(offGrid.valid).toBe(false);
    });

    test("should reject string numbers, which the response contract does not admit", () => {
      // A grid answer is contractually a single number. Coercing the string would let "50" and even
      // "50junk" satisfy the rule on every server response route, so both are rejected outright.
      const onGrid = validators.stepMultipleOf.check("50", { step: 5 }, {} as TSurveyElement);
      expect(onGrid.valid).toBe(false);

      const offGrid = validators.stepMultipleOf.check("7", { step: 5 }, {} as TSurveyElement);
      expect(offGrid.valid).toBe(false);

      const trailingJunk = validators.stepMultipleOf.check("50junk", { step: 5 }, {} as TSurveyElement);
      expect(trailingJunk.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.stepMultipleOf.check("", { step: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid true when no value was submitted at all", () => {
      // Required validation owns empty values, so a single omission is never reported twice.
      const result = validators.stepMultipleOf.check(undefined, { step: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid true for empty collections", () => {
      // An empty collection is unanswered and defers to required validation, whereas a populated one is
      // a non-number and fails.
      expect(validators.stepMultipleOf.check([], { step: 5 }, {} as TSurveyElement).valid).toBe(true);
      expect(validators.stepMultipleOf.check({}, { step: 5 }, {} as TSurveyElement).valid).toBe(true);
    });

    test("should reject non-numeric values rather than waving them through", () => {
      expect(validators.stepMultipleOf.check("abc", { step: 5 }, {} as TSurveyElement).valid).toBe(false);
      expect(validators.stepMultipleOf.check(["50"], { step: 5 }, {} as TSurveyElement).valid).toBe(false);
      expect(validators.stepMultipleOf.check({ value: "50" }, { step: 5 }, {} as TSurveyElement).valid).toBe(
        false
      );
    });

    test("should reject a non-finite value", () => {
      expect(validators.stepMultipleOf.check(Number.NaN, { step: 5 }, {} as TSurveyElement).valid).toBe(
        false
      );
      expect(
        validators.stepMultipleOf.check(Number.POSITIVE_INFINITY, { step: 5 }, {} as TSurveyElement).valid
      ).toBe(false);
    });

    test("should fail closed when the step is zero or negative", () => {
      // Params that cannot describe a grid must not silently disable the constraint on the server.
      const zeroStep = validators.stepMultipleOf.check(7, { step: 0 }, {} as TSurveyElement);
      expect(zeroStep.valid).toBe(false);

      const negativeStep = validators.stepMultipleOf.check(7, { step: -5 }, {} as TSurveyElement);
      expect(negativeStep.valid).toBe(false);
    });

    test("should fail closed when the offset is not finite", () => {
      const result = validators.stepMultipleOf.check(
        50,
        { step: 5, offset: Number.NaN },
        {} as TSurveyElement
      );
      expect(result.valid).toBe(false);
    });

    test("should fail closed when the step is not finite", () => {
      const notANumber = validators.stepMultipleOf.check(7, { step: Number.NaN }, {} as TSurveyElement);
      expect(notANumber.valid).toBe(false);

      const infinite = validators.stepMultipleOf.check(
        7,
        { step: Number.POSITIVE_INFINITY },
        {} as TSurveyElement
      );
      expect(infinite.valid).toBe(false);
    });

    test("should reject a half-step value whose scaled form exceeds the safe integer range", () => {
      // The regression this pins: scaling 1000000000000000.5 by ten exceeds Number.MAX_SAFE_INTEGER, and
      // reconstructing the nearest grid point in double arithmetic lands back on the submitted value itself
      // because the spacing between representable doubles at 1e15 is 0.125 - wider than the 0.2 step. A
      // reconstruct-and-measure check therefore reports zero distance and accepts both values below, each of
      // which is mathematically half a step off the grid. Exact decimal arithmetic is immune to it.
      const halfStepUp = validators.stepMultipleOf.check(
        1000000000000000.5,
        { step: 0.2 },
        {} as TSurveyElement
      );
      expect(halfStepUp.valid).toBe(false);

      const halfStepDown = validators.stepMultipleOf.check(
        1000000000000000.9,
        { step: 0.2 },
        {} as TSurveyElement
      );
      expect(halfStepDown.valid).toBe(false);
    });

    test("should still accept an aligned value whose scaled form exceeds the safe integer range", () => {
      // The mirror image of the case above: exactness must not be bought by rejecting everything large.
      // 1000000000000000.4 and 2251799813685248.5 are genuine grid points (5000000000000002 steps of 0.2 and
      // 4503599627370497 steps of 0.5), yet both scale past Number.MAX_SAFE_INTEGER.
      const onCoarseGrid = validators.stepMultipleOf.check(
        1000000000000000.4,
        { step: 0.2 },
        {} as TSurveyElement
      );
      expect(onCoarseGrid.valid).toBe(true);

      const onHalfUnitGrid = validators.stepMultipleOf.check(
        2251799813685248.5,
        { step: 0.5 },
        {} as TSurveyElement
      );
      expect(onHalfUnitGrid.valid).toBe(true);

      const offHalfUnitGrid = validators.stepMultipleOf.check(
        2251799813685248.5,
        { step: 0.2 },
        {} as TSurveyElement
      );
      expect(offHalfUnitGrid.valid).toBe(false);
    });

    test("should decide the grid exactly on either side of Number.MAX_SAFE_INTEGER", () => {
      // 9007199254740991 is odd, so it sits on a unit grid and off a step-2 grid; the next representable
      // double above it is even and sits on both. The verdict must follow the arithmetic, not the magnitude.
      expect(
        validators.stepMultipleOf.check(Number.MAX_SAFE_INTEGER, { step: 1 }, {} as TSurveyElement).valid
      ).toBe(true);
      expect(
        validators.stepMultipleOf.check(Number.MAX_SAFE_INTEGER, { step: 2 }, {} as TSurveyElement).valid
      ).toBe(false);
      expect(
        validators.stepMultipleOf.check(Number.MAX_SAFE_INTEGER + 1, { step: 2 }, {} as TSurveyElement).valid
      ).toBe(true);

      // A hundredth-scale grid whose scaled operands straddle the same ceiling: 90071992547409.92 scales to
      // 9007199254740992, one past Number.MAX_SAFE_INTEGER, and is two hundredths off a 0.05 grid. Note the
      // representation allowance at this magnitude is about 0.16 - wider than the step itself - so only the
      // cap at a millionth of the step keeps this rejection correct.
      expect(
        validators.stepMultipleOf.check(90071992547409.9, { step: 0.05 }, {} as TSurveyElement).valid
      ).toBe(true);
      expect(
        validators.stepMultipleOf.check(90071992547409.92, { step: 0.05 }, {} as TSurveyElement).valid
      ).toBe(false);
    });

    test("should forgive the representation error a client's own arithmetic introduces", () => {
      // `0.1 + 0.2` and `3 * 0.1` both evaluate to 0.30000000000000004, one unit in the last place away
      // from the third point of a 0.1 grid. A respondent's client that computes `min + n * step` produces
      // exactly this, so it counts as on-grid - while 0.35, five thousand million million times further
      // out, does not.
      expect(validators.stepMultipleOf.check(0.1 + 0.2, { step: 0.1 }, {} as TSurveyElement).valid).toBe(
        true
      );
      expect(validators.stepMultipleOf.check(0.35, { step: 0.1 }, {} as TSurveyElement).valid).toBe(false);
    });

    test("should fail closed on operands too small to be scaled exactly", () => {
      // A denormal cannot be restated on any usable decimal scale, and it is off every practical grid
      // anyway, so it is rejected rather than guessed at.
      const denormal = validators.stepMultipleOf.check(Number.MIN_VALUE, { step: 5 }, {} as TSurveyElement);
      expect(denormal.valid).toBe(false);
    });

    // The grid test and the element schema that injects it share one scale limit, and the guarantee that
    // limit exists to protect is "what the schema publishes, this rule can judge". These cases hold the two
    // layers against each other so the limit cannot silently drift apart again: the limit
    // `MAX_GRID_DECIMAL_SCALE` and the `isWithinGridDecimalScale` predicate that applies it both come from
    // `@formbricks/types/surveys/constants`, and both the schema guard inside `ZSurveySliderElement`
    // (`@formbricks/types/surveys/elements`) and this package's own `stepMultipleOf` validator call that
    // predicate.
    describe("shared grid scale limit", () => {
      const buildConfiguration = (min: number, max: number, step: number): Record<string, unknown> => ({
        id: "slider1",
        type: TSurveyElementTypeEnum.Slider,
        headline: { default: "Pick a value" },
        required: true,
        range: { min, max },
        step,
      });

      // A step of exactly 1e-300 needs MAX_GRID_DECIMAL_SCALE (300) decimal places; 1e-301 needs one more.
      const finestJudgeableStep = Number(`1e-${String(MAX_GRID_DECIMAL_SCALE)}`);
      const unjudgeableStep = Number(`1e-${String(MAX_GRID_DECIMAL_SCALE + 1)}`);

      test("should judge a grid at exactly the shared scale limit", () => {
        expect(isWithinGridDecimalScale(finestJudgeableStep)).toBe(true);
        // The first point above the origin is on the grid; half a step past it is not.
        expect(
          validators.stepMultipleOf.check(
            finestJudgeableStep,
            { step: finestJudgeableStep },
            {} as TSurveyElement
          ).valid
        ).toBe(true);
        expect(
          validators.stepMultipleOf.check(
            finestJudgeableStep * 1.5,
            { step: finestJudgeableStep },
            {} as TSurveyElement
          ).valid
        ).toBe(false);
      });

      test("should keep a configuration at the limit both schema-valid and answerable", () => {
        const parsed = ZSurveySliderElement.safeParse(
          buildConfiguration(0, finestJudgeableStep * 10, finestJudgeableStep)
        );

        expect(parsed.success).toBe(true);
        expect(
          validators.stepMultipleOf.check(
            finestJudgeableStep,
            { step: finestJudgeableStep, offset: 0 },
            {} as TSurveyElement
          ).valid
        ).toBe(true);
      });

      test("should reject a step finer than the limit at the schema, not leave it unanswerable", () => {
        expect(isWithinGridDecimalScale(unjudgeableStep)).toBe(false);

        const parsed = ZSurveySliderElement.safeParse(
          buildConfiguration(0, unjudgeableStep * 10, unjudgeableStep)
        );

        expect(parsed.success).toBe(false);
        expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)).toEqual([
          "Step is too precise to be validated",
        ]);
      });

      test("should reject an origin finer than the limit, since the origin anchors the grid", () => {
        const parsed = ZSurveySliderElement.safeParse(buildConfiguration(unjudgeableStep, 1, 0.1));

        expect(parsed.success).toBe(false);
        expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)).toEqual([
          "Minimum value is too precise to be validated",
        ]);
        // ...which is exactly the operand the rule would have failed closed on.
        expect(
          validators.stepMultipleOf.check(0.1, { step: 0.1, offset: unjudgeableStep }, {} as TSurveyElement)
            .valid
        ).toBe(false);
      });

      test("should leave every ordinary configuration answerable at its own first grid point", () => {
        const ordinary: [number, number, number][] = [
          [0, 100, 5],
          [0, 1, 0.1],
          [10, 50, 5],
          [0, 1000, 0.01],
          [0, 10, 10],
          [-50, 50, 5],
          [-10, 10, 2.5],
          [0, 1e15, 1e9],
          [0.05, 1, 0.01],
        ];

        for (const [min, max, step] of ordinary) {
          const parsed = ZSurveySliderElement.safeParse(buildConfiguration(min, max, step));
          expect(parsed.success).toBe(true);
          for (const value of [min, min + step, max]) {
            expect(
              validators.stepMultipleOf.check(value, { step, offset: min }, {} as TSurveyElement).valid
            ).toBe(true);
          }
        }
      });
    });

    test("should not let an enormous step buy an enormous tolerance", () => {
      // The residual allowance is capped by a fraction of the step, but it is measured against the value's
      // own magnitude - so 0.5 is not "close enough" to the origin of a 1e21 grid.
      const result = validators.stepMultipleOf.check(0.5, { step: 1e21 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return correct error message with the step interpolated", () => {
      mockTFn.mockClear();
      const message = validators.stepMultipleOf.getDefaultMessage({ step: 5 }, {} as TSurveyElement, mockT);
      expect(message).toBe("errors.step_multiple_of");
      expect(mockTFn).toHaveBeenCalledWith("errors.step_multiple_of", { step: 5 });
    });
  });

  describe("minSelections", () => {
    test("should return valid true when selection count >= min", () => {
      const result = validators.minSelections.check(["opt1", "opt2"], { min: 2 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when selection count < min", () => {
      const result = validators.minSelections.check(["opt1"], { min: 2 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid false when value is not an array", () => {
      const result = validators.minSelections.check("not-array", { min: 2 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should handle 'other' option correctly", () => {
      const result = validators.minSelections.check(["opt1", "", "custom"], { min: 2 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.minSelections.getDefaultMessage({ min: 2 }, {} as TSurveyElement, mockT);
      expect(message).toBe("errors.min_selections");
    });
  });

  describe("maxSelections", () => {
    test("should return valid true when selection count <= max", () => {
      const result = validators.maxSelections.check(["opt1", "opt2"], { max: 3 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when selection count > max", () => {
      const result = validators.maxSelections.check(
        ["opt1", "opt2", "opt3", "opt4"],
        { max: 3 },
        {} as TSurveyElement
      );
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is not an array", () => {
      const result = validators.maxSelections.check("not-array", { max: 3 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.maxSelections.getDefaultMessage({ max: 5 }, {} as TSurveyElement, mockT);
      expect(message).toBe("errors.max_selections");
    });
  });

  describe("equals", () => {
    test("should return valid true when value equals", () => {
      const result = validators.equals.check("test", { value: "test" }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when value does not equal", () => {
      const result = validators.equals.check("test", { value: "other" }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.equals.check("", { value: "test" }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.equals.getDefaultMessage({ value: "test" }, {} as TSurveyElement, mockT);
      expect(message).toBe("errors.value_must_equal");
    });
  });

  describe("doesNotEqual", () => {
    test("should return valid true when value does not equal", () => {
      const result = validators.doesNotEqual.check("test", { value: "other" }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when value equals", () => {
      const result = validators.doesNotEqual.check("test", { value: "test" }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.doesNotEqual.check("", { value: "test" }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.doesNotEqual.getDefaultMessage(
        { value: "test" },
        {} as TSurveyElement,
        mockT
      );
      expect(message).toBe("errors.value_must_not_equal");
    });
  });

  describe("contains", () => {
    test("should return valid true when value contains substring", () => {
      const result = validators.contains.check("hello world", { value: "world" }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when value does not contain substring", () => {
      const result = validators.contains.check("hello", { value: "world" }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.contains.check("", { value: "test" }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.contains.getDefaultMessage({ value: "test" }, {} as TSurveyElement, mockT);
      expect(message).toBe("errors.value_must_contain");
    });
  });

  describe("doesNotContain", () => {
    test("should return valid true when value does not contain substring", () => {
      const result = validators.doesNotContain.check("hello", { value: "world" }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when value contains substring", () => {
      const result = validators.doesNotContain.check("hello world", { value: "world" }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.doesNotContain.check("", { value: "test" }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.doesNotContain.getDefaultMessage(
        { value: "test" },
        {} as TSurveyElement,
        mockT
      );
      expect(message).toBe("errors.value_must_not_contain");
    });
  });

  describe("isGreaterThan", () => {
    test("should return valid true when value > min", () => {
      const result = validators.isGreaterThan.check(10, { min: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when value <= min", () => {
      const result = validators.isGreaterThan.check(5, { min: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.isGreaterThan.check("", { min: 5 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.isGreaterThan.getDefaultMessage({ min: 10 }, {} as TSurveyElement, mockT);
      expect(message).toBe("errors.is_greater_than");
    });
  });

  describe("isLessThan", () => {
    test("should return valid true when value < max", () => {
      const result = validators.isLessThan.check(5, { max: 10 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when value >= max", () => {
      const result = validators.isLessThan.check(10, { max: 10 }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.isLessThan.check("", { max: 10 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.isLessThan.getDefaultMessage({ max: 100 }, {} as TSurveyElement, mockT);
      expect(message).toBe("errors.is_less_than");
    });
  });

  describe("isLaterThan", () => {
    test("should return valid true when date is later", () => {
      const result = validators.isLaterThan.check("2024-12-31", { date: "2024-01-01" }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when date is not later", () => {
      const result = validators.isLaterThan.check("2024-01-01", { date: "2024-12-31" }, {} as TSurveyElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.isLaterThan.check("", { date: "2024-01-01" }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.isLaterThan.getDefaultMessage(
        { date: "2024-01-01" },
        {} as TSurveyElement,
        mockT
      );
      expect(message).toBe("errors.is_later_than");
    });
  });

  describe("isEarlierThan", () => {
    test("should return valid true when date is earlier", () => {
      const result = validators.isEarlierThan.check(
        "2024-01-01",
        { date: "2024-12-31" },
        {} as TSurveyElement
      );
      expect(result.valid).toBe(true);
    });

    test("should return valid false when date is not earlier", () => {
      const result = validators.isEarlierThan.check(
        "2024-12-31",
        { date: "2024-01-01" },
        {} as TSurveyElement
      );
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.isEarlierThan.check("", { date: "2024-01-01" }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.isEarlierThan.getDefaultMessage(
        { date: "2024-01-01" },
        {} as TSurveyElement,
        mockT
      );
      expect(message).toBe("errors.is_earlier_than");
    });
  });

  describe("isBetween", () => {
    test("should return valid true when date is between", () => {
      const result = validators.isBetween.check(
        "2024-06-15",
        { startDate: "2024-01-01", endDate: "2024-12-31" },
        {} as TSurveyElement
      );
      expect(result.valid).toBe(true);
    });

    test("should return valid false when date is not between", () => {
      const result = validators.isBetween.check(
        "2025-01-01",
        { startDate: "2024-01-01", endDate: "2024-12-31" },
        {} as TSurveyElement
      );
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.isBetween.check(
        "",
        { startDate: "2024-01-01", endDate: "2024-12-31" },
        {} as TSurveyElement
      );
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.isBetween.getDefaultMessage(
        { startDate: "2024-01-01", endDate: "2024-12-31" },
        {} as TSurveyElement,
        mockT
      );
      expect(message).toBe("errors.is_between");
    });
  });

  describe("isNotBetween", () => {
    test("should return valid true when date is not between", () => {
      const result = validators.isNotBetween.check(
        "2025-01-01",
        { startDate: "2024-01-01", endDate: "2024-12-31" },
        {} as TSurveyElement
      );
      expect(result.valid).toBe(true);
    });

    test("should return valid false when date is between", () => {
      const result = validators.isNotBetween.check(
        "2024-06-15",
        { startDate: "2024-01-01", endDate: "2024-12-31" },
        {} as TSurveyElement
      );
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.isNotBetween.check(
        "",
        { startDate: "2024-01-01", endDate: "2024-12-31" },
        {} as TSurveyElement
      );
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.isNotBetween.getDefaultMessage(
        { startDate: "2024-01-01", endDate: "2024-12-31" },
        {} as TSurveyElement,
        mockT
      );
      expect(message).toBe("errors.is_not_between");
    });
  });

  describe("minRanked", () => {
    const rankingElement: TSurveyElement = {
      id: "rank1",
      type: TSurveyElementTypeEnum.Ranking,
      headline: { default: "Rank these" },
      required: false,
      choices: [
        { id: "opt1", label: { default: "Option 1" } },
        { id: "opt2", label: { default: "Option 2" } },
        { id: "opt3", label: { default: "Option 3" } },
      ],
    } as TSurveyElement;

    test("should return valid true when ranked count >= min", () => {
      const result = validators.minRanked.check(["opt1", "opt2"], { min: 2 }, rankingElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when ranked count < min", () => {
      const result = validators.minRanked.check(["opt1"], { min: 2 }, rankingElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.minRanked.check([], { min: 2 }, rankingElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid true when element is not ranking", () => {
      const result = validators.minRanked.check(["opt1"], { min: 2 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.minRanked.getDefaultMessage({ min: 2 }, rankingElement, mockT);
      expect(message).toBe("errors.minimum_options_ranked");
    });
  });

  describe("rankAll", () => {
    const rankingElement: TSurveyElement = {
      id: "rank1",
      type: TSurveyElementTypeEnum.Ranking,
      headline: { default: "Rank these" },
      required: false,
      choices: [
        { id: "opt1", label: { default: "Option 1" } },
        { id: "opt2", label: { default: "Option 2" } },
        { id: "opt3", label: { default: "Option 3" } },
      ],
    } as TSurveyElement;

    test("should return valid true when all options are ranked", () => {
      const result = validators.rankAll.check(["opt1", "opt2", "opt3"], {}, rankingElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid false when not all options are ranked", () => {
      const result = validators.rankAll.check(["opt1", "opt2"], {}, rankingElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.rankAll.check([], {}, rankingElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid true when element is not ranking", () => {
      const result = validators.rankAll.check(["opt1"], {}, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.rankAll.getDefaultMessage({}, rankingElement, mockT);
      expect(message).toBe("errors.all_options_must_be_ranked");
    });
  });

  describe("minRowsAnswered", () => {
    const matrixElement: TSurveyElement = {
      id: "matrix1",
      type: TSurveyElementTypeEnum.Matrix,
      headline: { default: "Matrix question" },
      required: false,
      shuffleOption: "none",
      rows: [
        { id: "row1", label: { default: "Row 1" } },
        { id: "row2", label: { default: "Row 2" } },
        { id: "row3", label: { default: "Row 3" } },
      ],
      columns: [
        { id: "col1", label: { default: "Col 1" } },
        { id: "col2", label: { default: "Col 2" } },
      ],
    } as TSurveyElement;

    test("should return valid true when answered rows >= min", () => {
      const result = validators.minRowsAnswered.check(
        { row1: "col1", row2: "col2" },
        { min: 2 },
        matrixElement
      );
      expect(result.valid).toBe(true);
    });

    test("should return valid false when answered rows < min", () => {
      const result = validators.minRowsAnswered.check({ row1: "col1" }, { min: 2 }, matrixElement);
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      // Empty object has 0 answered rows, which is less than min (2), so it should fail
      // But if we pass undefined, it should skip validation
      const result = validators.minRowsAnswered.check(undefined, { min: 2 }, matrixElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid true when element is not matrix", () => {
      const result = validators.minRowsAnswered.check({ row1: "col1" }, { min: 2 }, {} as TSurveyElement);
      expect(result.valid).toBe(true);
    });

    test("should filter out empty values", () => {
      const result = validators.minRowsAnswered.check({ row1: "col1", row2: "" }, { min: 1 }, matrixElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.minRowsAnswered.getDefaultMessage({ min: 2 }, matrixElement, mockT);
      expect(message).toBe("errors.minimum_rows_answered");
    });
  });

  describe("fileExtensionIs", () => {
    const fileUploadElement: TSurveyElement = {
      id: "file1",
      type: TSurveyElementTypeEnum.FileUpload,
      headline: { default: "Upload file" },
      required: false,
      allowMultipleFiles: false,
    } as TSurveyElement;

    test("should return valid true when file extension matches", () => {
      const result = validators.fileExtensionIs.check(
        ["https://example.com/file.pdf"],
        { extensions: ["pdf"] },
        fileUploadElement
      );
      expect(result.valid).toBe(true);
    });

    test("should return valid true when file extension matches with dot", () => {
      const result = validators.fileExtensionIs.check(
        ["https://example.com/file.pdf"],
        { extensions: [".pdf"] },
        fileUploadElement
      );
      expect(result.valid).toBe(true);
    });

    test("should return valid false when file extension does not match", () => {
      const result = validators.fileExtensionIs.check(
        ["https://example.com/file.pdf"],
        { extensions: ["jpg"] },
        fileUploadElement
      );
      expect(result.valid).toBe(false);
    });

    test("should handle multiple files", () => {
      const result = validators.fileExtensionIs.check(
        ["https://example.com/file1.pdf", "https://example.com/file2.pdf"],
        { extensions: ["pdf"] },
        fileUploadElement
      );
      expect(result.valid).toBe(true);
    });

    test("should return valid false if any file does not match", () => {
      const result = validators.fileExtensionIs.check(
        ["https://example.com/file1.pdf", "https://example.com/file2.jpg"],
        { extensions: ["pdf"] },
        fileUploadElement
      );
      expect(result.valid).toBe(false);
    });

    test("should handle URLs with query parameters", () => {
      const result = validators.fileExtensionIs.check(
        ["https://example.com/file.pdf?token=123"],
        { extensions: ["pdf"] },
        fileUploadElement
      );
      expect(result.valid).toBe(true);
    });

    test("should return valid false for files without extension", () => {
      const result = validators.fileExtensionIs.check(
        ["https://example.com/file"],
        { extensions: ["pdf"] },
        fileUploadElement
      );
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.fileExtensionIs.check([], { extensions: ["pdf"] }, fileUploadElement);
      expect(result.valid).toBe(true);
    });

    test("should return valid true when element is not fileUpload", () => {
      const result = validators.fileExtensionIs.check(
        ["https://example.com/file.pdf"],
        { extensions: ["pdf"] },
        {} as TSurveyElement
      );
      expect(result.valid).toBe(true);
    });

    test("should handle case-insensitive extensions", () => {
      const result = validators.fileExtensionIs.check(
        ["https://example.com/file.PDF"],
        { extensions: ["pdf"] },
        fileUploadElement
      );
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.fileExtensionIs.getDefaultMessage(
        { extensions: ["pdf", "jpg"] },
        fileUploadElement,
        mockT
      );
      expect(message).toBe("errors.file_extension_must_be");
    });
  });

  describe("fileExtensionIsNot", () => {
    const fileUploadElement: TSurveyElement = {
      id: "file1",
      type: TSurveyElementTypeEnum.FileUpload,
      headline: { default: "Upload file" },
      required: false,
      allowMultipleFiles: false,
    } as TSurveyElement;

    test("should return valid true when file extension does not match", () => {
      const result = validators.fileExtensionIsNot.check(
        ["https://example.com/file.pdf"],
        { extensions: ["jpg"] },
        fileUploadElement
      );
      expect(result.valid).toBe(true);
    });

    test("should return valid false when file extension matches", () => {
      const result = validators.fileExtensionIsNot.check(
        ["https://example.com/file.pdf"],
        { extensions: ["pdf"] },
        fileUploadElement
      );
      expect(result.valid).toBe(false);
    });

    test("should return valid true for files without extension", () => {
      const result = validators.fileExtensionIsNot.check(
        ["https://example.com/file"],
        { extensions: ["pdf"] },
        fileUploadElement
      );
      expect(result.valid).toBe(true);
    });

    test("should handle multiple files", () => {
      const result = validators.fileExtensionIsNot.check(
        ["https://example.com/file1.jpg", "https://example.com/file2.png"],
        { extensions: ["pdf"] },
        fileUploadElement
      );
      expect(result.valid).toBe(true);
    });

    test("should return valid false if any file matches forbidden extension", () => {
      const result = validators.fileExtensionIsNot.check(
        ["https://example.com/file1.pdf", "https://example.com/file2.jpg"],
        { extensions: ["pdf"] },
        fileUploadElement
      );
      expect(result.valid).toBe(false);
    });

    test("should return valid true when value is empty", () => {
      const result = validators.fileExtensionIsNot.check([], { extensions: ["pdf"] }, fileUploadElement);
      expect(result.valid).toBe(true);
    });

    test("should return correct error message", () => {
      const message = validators.fileExtensionIsNot.getDefaultMessage(
        { extensions: ["exe", "bat"] },
        fileUploadElement,
        mockT
      );
      expect(message).toBe("errors.file_extension_must_not_be");
    });
  });
});
