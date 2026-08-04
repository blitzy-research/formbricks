import type { TFunction } from "i18next";
import type { TResponseDataValue } from "@formbricks/types/responses";
import type { TSurveyElement } from "@formbricks/types/surveys/elements";
import type {
  TValidationRuleParams,
  TValidationRuleParamsContains,
  TValidationRuleParamsDoesNotContain,
  TValidationRuleParamsDoesNotEqual,
  TValidationRuleParamsEmail,
  TValidationRuleParamsEquals,
  TValidationRuleParamsFileExtensionIs,
  TValidationRuleParamsFileExtensionIsNot,
  TValidationRuleParamsIsBetween,
  TValidationRuleParamsIsEarlierThan,
  TValidationRuleParamsIsGreaterThan,
  TValidationRuleParamsIsLaterThan,
  TValidationRuleParamsIsLessThan,
  TValidationRuleParamsIsNotBetween,
  TValidationRuleParamsMaxLength,
  TValidationRuleParamsMaxSelections,
  TValidationRuleParamsMaxValue,
  TValidationRuleParamsMinLength,
  TValidationRuleParamsMinRanked,
  TValidationRuleParamsMinRowsAnswered,
  TValidationRuleParamsMinSelections,
  TValidationRuleParamsMinValue,
  TValidationRuleParamsPattern,
  TValidationRuleParamsPhone,
  TValidationRuleParamsStepMultipleOf,
  TValidationRuleParamsUrl,
  TValidationRuleType,
  TValidatorCheckResult,
} from "@formbricks/types/surveys/validation-rules";
import { countSelections } from "./validators/selection-utils";
import { validateEmail, validatePhone, validateUrl } from "./validators/validation-utils";

/**
 * Generic validator interface
 * Uses type assertions internally to handle the discriminated union params
 */
export interface TValidator {
  check: (
    value: TResponseDataValue,
    params: TValidationRuleParams,
    element: TSurveyElement
  ) => TValidatorCheckResult;
  getDefaultMessage: (params: TValidationRuleParams, element: TSurveyElement, t: TFunction) => string;
}

/**
 * Check if a value is empty
 */
const isEmpty = (value: TResponseDataValue): boolean => {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0)
  );
};

/**
 * Parse numeric value from string or number
 */
const parseNumericValue = (value: TResponseDataValue): number | null => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

// Residual tolerance expressed in units of the last representable bit of the value being judged. Rounding a
// single multiply-add costs two to three of those units, so eight leaves headroom without ever reaching a
// neighbouring grid point.
const GRID_TOLERANCE_ULP_MULTIPLE = 8;
// Hard cap on the residual tolerance. It is a fraction of the STEP, never of the submitted value, which is
// what stops a large answer from buying itself a large tolerance.
const GRID_TOLERANCE_STEP_FRACTION = 1e-6;
// A finite double always prints as [-]digits[.digits][e(+|-)digits] - "0.2", "1e-7", "1.5e+21" - so these
// three groups plus the sign describe every operand the grid test can be handed.
const DECIMAL_NOTATION_PATTERN = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/i;

/**
 * A number expressed exactly as `digits / 10 ** scale`, with `digits` held as a BigInt so it is never
 * subject to the 53-bit limit that makes scaled doubles untrustworthy at high magnitudes.
 */
interface TScaledDecimal {
  digits: bigint;
  scale: number;
}

/**
 * Decompose a number into its exact decimal form, or null when it has none.
 *
 * The decomposition is taken from the shortest decimal string that round-trips back to the same double,
 * which is the decimal the survey author typed and the respondent sees - `0.2` rather than the binary
 * fraction 0.200000000000000011102230246251565... Comparing those decimals is what makes a 0.1 grid accept
 * 0.3, and it is exact: no digit of the printed form is discarded, so the returned pair describes the
 * operand and nothing else.
 *
 * Every finite double has such a form and no bound is placed on how precise it may be, so this rule owns
 * the whole of its own judgement: there is no configuration it must be shielded from by the element schema
 * that injects it. Only a non-finite operand has no decimal form at all.
 */
const toScaledDecimal = (value: number): TScaledDecimal | null => {
  if (!Number.isFinite(value)) {
    return null;
  }

  const match = DECIMAL_NOTATION_PATTERN.exec(String(value));
  if (!match) {
    return null;
  }

  const [, sign, whole, fraction = "", exponent = "0"] = match;
  let digits = BigInt(whole + fraction);
  let scale = fraction.length - Number(exponent);

  if (scale < 0) {
    // A positive exponent that outruns the fraction describes an integer, e.g. 1.5e+21. Fold it into the
    // digits so every operand ends up with a non-negative scale and the three can share one.
    digits *= 10n ** BigInt(-scale);
    scale = 0;
  }

  return { digits: sign === "-" ? -digits : digits, scale };
};

/**
 * Restate a decimal on a coarser scale. Exact by construction: scaling up only appends zeroes.
 */
const liftToScale = (decimal: TScaledDecimal, scale: number): bigint =>
  decimal.digits * 10n ** BigInt(scale - decimal.scale);

/**
 * Whether the exact decimal `digits / 10 ** scale` is no larger than the finite double `bound`.
 *
 * The comparison stays in the BigInt domain deliberately. Dividing the digits by `10 ** scale` to get a
 * double would report every residual as zero once the scale passed 308, because `10 ** 309` is Infinity -
 * turning this fail-closed check into a fail-open one exactly where precision is highest. Restating both
 * sides on one shared scale answers the same question with no such cliff, which is what lets this rule
 * accept any finite operand instead of needing a ceiling on how precise one may be.
 */
const isScaledDecimalAtMost = (decimal: TScaledDecimal, bound: number): boolean => {
  const scaledBound = toScaledDecimal(bound);
  if (scaledBound === null) {
    return false;
  }

  const scale = Math.max(decimal.scale, scaledBound.scale);
  return liftToScale(decimal, scale) <= liftToScale(scaledBound, scale);
};

/**
 * Whether `value` sits on the grid of `step` anchored at `offset`.
 *
 * The verdict is decided by exact decimal arithmetic. All three operands are restated on one shared scale
 * as BigInt integers and the remainder is taken there, which is immune both to the artefacts that make `%`
 * unusable on decimals - `0.3 / 0.1` evaluates to 2.9999999999999996, so `(value - offset) % step === 0`
 * wrongly rejects 0.3 on a 0.1 grid, whereas comparing 3 against 1 answers it exactly - and to the 53-bit
 * ceiling that makes scaled *doubles* untrustworthy: at 1e15 the spacing between representable doubles is
 * 0.125, so reconstructing the nearest point of a 0.2 grid there lands back on the submitted value and
 * reports zero distance for a value that is half a step off. BigInts have no such ceiling, so magnitude
 * changes nothing about the answer.
 *
 * Only one deviation from an exact grid point is forgiven, and only within a hard bound: the representation
 * error the operands themselves carry. A client computing `min + n * step` in binary floating point yields
 * 0.30000000000000004 for the third point of a 0.1 grid, which is that grid point for every practical
 * purpose. The allowance is the smaller of a few units in the last place of the value and a millionth of
 * the STEP - never a fraction of the submitted value, which is what stops a large answer from buying itself
 * a large tolerance, and never enough to reach, let alone pass, a neighbouring grid point.
 */
const isOnStepGrid = (value: number, step: number, offset: number): boolean => {
  const scaledValue = toScaledDecimal(value);
  const scaledStep = toScaledDecimal(step);
  const scaledOffset = toScaledDecimal(offset);
  // Fail closed: an operand with no decimal form cannot be shown to sit on the grid.
  if (scaledValue === null || scaledStep === null || scaledOffset === null) {
    return false;
  }

  const scale = Math.max(scaledValue.scale, scaledStep.scale, scaledOffset.scale);
  const stepDigits = liftToScale(scaledStep, scale);
  if (stepDigits <= 0n) {
    return false;
  }

  // Normalise the remainder to be non-negative so a value below the grid's origin is measured exactly like
  // one above it: on a step-5 grid anchored at 0, -10 is on the grid and -7 is two away from -5.
  const distance = liftToScale(scaledValue, scale) - liftToScale(scaledOffset, scale);
  const remainder = ((distance % stepDigits) + stepDigits) % stepDigits;
  if (remainder === 0n) {
    return true;
  }

  const gapDigits = remainder < stepDigits - remainder ? remainder : stepDigits - remainder;
  const magnitude = Math.max(Math.abs(value), Math.abs(offset));
  const tolerance = Math.min(
    magnitude * Number.EPSILON * GRID_TOLERANCE_ULP_MULTIPLE,
    step * GRID_TOLERANCE_STEP_FRACTION
  );

  return isScaledDecimalAtMost({ digits: gapDigits, scale }, tolerance);
};

/**
 * Registry of all validators, keyed by rule type
 */
export const validators: Record<TValidationRuleType, TValidator> = {
  minLength: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsMinLength;
      // Skip validation if value is not a string or is empty
      if (typeof value !== "string" || value === "") {
        return { valid: true };
      }
      return { valid: value.length >= typedParams.min };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsMinLength;
      return t("errors.min_length", { min: typedParams.min });
    },
  },

  maxLength: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsMaxLength;
      // Skip validation if value is not a string
      if (typeof value !== "string") {
        return { valid: true };
      }
      return { valid: value.length <= typedParams.max };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsMaxLength;
      return t("errors.max_length", { max: typedParams.max });
    },
  },

  pattern: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsPattern;
      // Skip validation if value is empty
      if (!value || typeof value !== "string" || value === "") {
        return { valid: true };
      }

      // ReDoS protection: cap pattern length to prevent catastrophic backtracking
      // Patterns longer than 512 chars can cause exponential time complexity
      if (typedParams.pattern.length > 512) {
        console.warn(`Pattern too long (${typedParams.pattern.length} chars), rejecting to prevent ReDoS`);
        return { valid: false };
      }

      // ReDoS protection: cap value length to prevent exponential backtracking
      // Values longer than 4096 chars can cause main-thread lockup with malicious patterns
      if (value.length > 4096) {
        console.warn(`Value too long (${value.length} chars), rejecting to prevent ReDoS`);
        return { valid: false };
      }

      try {
        const regex = new RegExp(typedParams.pattern, typedParams.flags);
        return { valid: regex.test(value) };
      } catch {
        // If regex is invalid, consider it valid (design-time should catch this)
        console.warn(`Invalid regex pattern: ${typedParams.pattern}`);
        return { valid: true };
      }
    },
    getDefaultMessage: (_params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      return t("errors.invalid_format");
    },
  },

  email: {
    check: (value: TResponseDataValue): TValidatorCheckResult => {
      // Skip validation if value is empty
      if (!value || typeof value !== "string" || value === "") {
        return { valid: true };
      }
      return { valid: validateEmail(value) };
    },
    getDefaultMessage: (
      _params: TValidationRuleParamsEmail,
      _element: TSurveyElement,
      t: TFunction
    ): string => {
      return t("errors.please_enter_a_valid_email_address");
    },
  },

  url: {
    check: (value: TResponseDataValue): TValidatorCheckResult => {
      // Skip validation if value is empty
      if (!value || typeof value !== "string" || value === "") {
        return { valid: true };
      }
      return { valid: validateUrl(value) };
    },
    getDefaultMessage: (
      _params: TValidationRuleParamsUrl,
      _element: TSurveyElement,
      t: TFunction
    ): string => {
      return t("errors.please_enter_a_valid_url");
    },
  },

  phone: {
    check: (value: TResponseDataValue): TValidatorCheckResult => {
      // Skip validation if value is empty
      if (!value || typeof value !== "string" || value === "") {
        return { valid: true };
      }
      return { valid: validatePhone(value) };
    },
    getDefaultMessage: (
      _params: TValidationRuleParamsPhone,
      _element: TSurveyElement,
      t: TFunction
    ): string => {
      return t("errors.please_enter_a_valid_phone_number");
    },
  },

  minValue: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsMinValue;
      // Skip validation if value is empty (let required handle empty)
      if (isEmpty(value)) {
        return { valid: true };
      }

      const numValue = parseNumericValue(value);
      if (numValue === null) {
        return { valid: true }; // Let pattern/type validation handle non-numeric
      }

      return { valid: numValue >= typedParams.min };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsMinValue;
      return t("errors.min_value", { min: typedParams.min });
    },
  },

  maxValue: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsMaxValue;
      // Skip validation if value is empty (let required handle empty)
      if (isEmpty(value)) {
        return { valid: true };
      }

      const numValue = parseNumericValue(value);
      if (numValue === null) {
        return { valid: true }; // Let pattern/type validation handle non-numeric
      }

      return { valid: numValue <= typedParams.max };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsMaxValue;
      return t("errors.max_value", { max: typedParams.max });
    },
  },

  stepMultipleOf: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsStepMultipleOf;
      // Skip validation if value is empty (let required handle empty)
      if (isEmpty(value)) {
        return { valid: true };
      }

      // A grid answer is contractually a single finite number, so the type is checked here rather than
      // coerced: string coercion would let "50" and even "50junk" through, and a null parse result would
      // wave arrays and objects past unchecked. The evaluator applies the same contract to a slider answer
      // before any rule runs, so the two layers agree rather than one deferring to the other.
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { valid: false };
      }

      // A step that describes no grid describes no constraint, so the answer passes here rather than being
      // rejected: configuration is the element schema's error to report, not this rule's. The schema rejects a
      // non-positive step, a non-numeric one and an infinite one with its own author-facing message, and the
      // evaluator refuses to inject these rules at all for a slider whose configuration it cannot read -
      // rejecting the answer through its own configuration gate instead - so nothing an author can save
      // reaches this branch with the constraint silently dropped. Deciding it here as well would report a
      // configuration mistake as if it were the respondent's, on a value that may be perfectly valid.
      const { step, offset: rawOffset } = typedParams;
      if (typeof step !== "number" || !Number.isFinite(step) || step <= 0) {
        return { valid: true };
      }

      // The origin is not the same case. There is a grid to test against here, and an origin that is not a
      // finite number places it nowhere, so the value cannot be shown to sit on it: measuring from a
      // non-finite origin yields a distance that compares false against any tolerance. Rejecting is what
      // keeps that outcome explicit rather than an artefact of arithmetic on NaN.
      if (rawOffset !== undefined && (typeof rawOffset !== "number" || !Number.isFinite(rawOffset))) {
        return { valid: false };
      }

      // Alignment is measured from `offset`, the grid's origin, rather than from zero, so a grid
      // anchored at 10 with a step of 5 accepts 15 but rejects 12.
      const offset = rawOffset ?? 0;

      return { valid: isOnStepGrid(value, step, offset) };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsStepMultipleOf;
      return t("errors.step_multiple_of", { step: typedParams.step });
    },
  },

  minSelections: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsMinSelections;
      // If value is not an array, check fails (need selections)
      if (!Array.isArray(value)) {
        return { valid: false };
      }

      const selectionCount = countSelections(value);
      return { valid: selectionCount >= typedParams.min };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsMinSelections;
      return t("errors.min_selections", { min: typedParams.min });
    },
  },

  maxSelections: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsMaxSelections;
      // If value is not an array, rule doesn't apply (graceful)
      if (!Array.isArray(value)) {
        return { valid: true };
      }

      const selectionCount = countSelections(value);
      return { valid: selectionCount <= typedParams.max };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsMaxSelections;
      return t("errors.max_selections", { max: typedParams.max });
    },
  },
  equals: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsEquals;
      // Skip validation if value is empty
      if (!value || typeof value !== "string" || value === "") {
        return { valid: true };
      }
      return { valid: value === typedParams.value };
    },
    getDefaultMessage: (_params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      return t("errors.value_must_equal", { value: (_params as TValidationRuleParamsEquals).value });
    },
  },
  doesNotEqual: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsDoesNotEqual;
      // Skip validation if value is empty
      if (!value || typeof value !== "string" || value === "") {
        return { valid: true };
      }
      return { valid: value !== typedParams.value };
    },
    getDefaultMessage: (_params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      return t("errors.value_must_not_equal", {
        value: (_params as TValidationRuleParamsDoesNotEqual).value,
      });
    },
  },
  contains: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsContains;
      // Skip validation if value is empty
      if (!value || typeof value !== "string" || value === "") {
        return { valid: true };
      }
      return { valid: value.includes(typedParams.value) };
    },
    getDefaultMessage: (_params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      return t("errors.value_must_contain", { value: (_params as TValidationRuleParamsContains).value });
    },
  },
  doesNotContain: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsDoesNotContain;
      // Skip validation if value is empty
      if (!value || typeof value !== "string" || value === "") {
        return { valid: true };
      }
      return { valid: !value.includes(typedParams.value) };
    },
    getDefaultMessage: (_params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      return t("errors.value_must_not_contain", {
        value: (_params as TValidationRuleParamsDoesNotContain).value,
      });
    },
  },
  isGreaterThan: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsIsGreaterThan;
      // Skip validation if value is empty (let required handle empty)
      if (isEmpty(value)) {
        return { valid: true };
      }

      const numValue = parseNumericValue(value);
      if (numValue === null) {
        return { valid: true }; // Let pattern/type validation handle non-numeric
      }

      return { valid: numValue > typedParams.min };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsIsGreaterThan;
      return t("errors.is_greater_than", { min: typedParams.min });
    },
  },
  isLessThan: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsIsLessThan;
      // Skip validation if value is empty (let required handle empty)
      if (isEmpty(value)) {
        return { valid: true };
      }

      const numValue = parseNumericValue(value);
      if (numValue === null) {
        return { valid: true }; // Let pattern/type validation handle non-numeric
      }

      return { valid: numValue < typedParams.max };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsIsLessThan;
      return t("errors.is_less_than", { max: typedParams.max });
    },
  },
  isLaterThan: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsIsLaterThan;
      // Skip validation if value is empty
      if (!value || typeof value !== "string" || value === "") {
        return { valid: true };
      }
      // Compare dates as strings (YYYY-MM-DD format)
      return { valid: value > typedParams.date };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsIsLaterThan;
      return t("errors.is_later_than", { date: typedParams.date });
    },
  },
  isEarlierThan: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsIsEarlierThan;
      // Skip validation if value is empty
      if (!value || typeof value !== "string" || value === "") {
        return { valid: true };
      }
      // Compare dates as strings (YYYY-MM-DD format)
      return { valid: value < typedParams.date };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsIsEarlierThan;
      return t("errors.is_earlier_than", { date: typedParams.date });
    },
  },
  isBetween: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsIsBetween;
      // Skip validation if value is empty
      if (!value || typeof value !== "string" || value === "") {
        return { valid: true };
      }
      // Compare dates as strings (YYYY-MM-DD format)
      return { valid: value > typedParams.startDate && value < typedParams.endDate };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsIsBetween;
      return t("errors.is_between", { startDate: typedParams.startDate, endDate: typedParams.endDate });
    },
  },
  isNotBetween: {
    check: (value: TResponseDataValue, params: TValidationRuleParams): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsIsNotBetween;
      // Skip validation if value is empty
      if (!value || typeof value !== "string" || value === "") {
        return { valid: true };
      }
      // Compare dates as strings (YYYY-MM-DD format)
      return { valid: value < typedParams.startDate || value > typedParams.endDate };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsIsNotBetween;
      return t("errors.is_not_between", { startDate: typedParams.startDate, endDate: typedParams.endDate });
    },
  },
  minRanked: {
    check: (
      value: TResponseDataValue,
      params: TValidationRuleParams,
      element: TSurveyElement
    ): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsMinRanked;
      // Skip validation if value is empty
      if (!value || !Array.isArray(value) || value.length === 0) {
        return { valid: true };
      }
      if (element.type !== "ranking") {
        return { valid: true };
      }
      // Count how many options have been ranked (array length)
      const rankedCount = value.length;
      return { valid: rankedCount >= typedParams.min };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsMinRanked;
      return t("errors.minimum_options_ranked", { min: typedParams.min });
    },
  },
  rankAll: {
    check: (
      value: TResponseDataValue,
      _params: TValidationRuleParams,
      element: TSurveyElement
    ): TValidatorCheckResult => {
      if (element.type !== "ranking") {
        return { valid: true };
      }
      // Skip validation if value is empty
      if (!value || !Array.isArray(value) || value.length === 0) {
        return { valid: true };
      }
      // All options must be ranked
      const allItemsRanked = value.length === element.choices.length;
      return { valid: allItemsRanked };
    },
    getDefaultMessage: (_params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      return t("errors.all_options_must_be_ranked");
    },
  },
  minRowsAnswered: {
    check: (
      value: TResponseDataValue,
      params: TValidationRuleParams,
      element: TSurveyElement
    ): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsMinRowsAnswered;
      // Skip validation if value is empty
      if (!value || typeof value !== "object" || Array.isArray(value) || value === null) {
        return { valid: true };
      }
      if (element.type !== "matrix") {
        return { valid: true };
      }
      // Matrix responses are Record<string, string> where keys are row labels and values are column labels
      // Count non-empty answers (rows that have been answered)
      const answeredCount = Object.values(value).filter(
        (v) => v !== "" && v !== null && v !== undefined
      ).length;
      return { valid: answeredCount >= typedParams.min };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsMinRowsAnswered;
      return t("errors.minimum_rows_answered", { min: typedParams.min });
    },
  },
  answerAllRows: {
    check: (
      value: TResponseDataValue,
      _params: TValidationRuleParams,
      element: TSurveyElement
    ): TValidatorCheckResult => {
      if (element.type !== "matrix") {
        return { valid: true };
      }
      // Skip validation if value is empty (let required handle empty)
      if (!value || typeof value !== "object" || Array.isArray(value) || value === null) {
        return { valid: true };
      }
      // Matrix responses are Record<string, string> where keys are localized row labels
      // Count non-empty answers (rows that have been answered)
      const answeredCount = Object.values(value).filter(
        (v) => v !== "" && v !== null && v !== undefined
      ).length;
      // All rows must be answered
      const allRowsAnswered = answeredCount === element.rows.length;
      return { valid: allRowsAnswered };
    },
    getDefaultMessage: (_params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      return t("errors.all_rows_must_be_answered");
    },
  },
  fileExtensionIs: {
    check: (
      value: TResponseDataValue,
      params: TValidationRuleParams,
      element: TSurveyElement
    ): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsFileExtensionIs;
      if (element.type !== "fileUpload") {
        return { valid: true };
      }
      // Skip validation if value is empty
      if (!value || !Array.isArray(value) || value.length === 0) {
        return { valid: true };
      }
      // Normalize expected extensions: ensure they start with a dot
      const expectedExtensions = new Set(
        typedParams.extensions.map((ext) =>
          ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`
        )
      );

      // Check all files in the array
      for (const fileUrl of value) {
        if (typeof fileUrl !== "string") continue;
        // Extract filename from URL
        const urlPath = fileUrl.split("?")[0]; // Remove query params
        const fileName = urlPath.split("/").pop() || "";
        if (!fileName.includes(".")) {
          return { valid: false };
        }
        const fileExtension = `.${fileName.split(".").pop()?.toLowerCase() ?? ""}`;
        // Check if file extension matches any of the expected extensions
        if (!expectedExtensions.has(fileExtension)) {
          return { valid: false };
        }
      }
      return { valid: true };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsFileExtensionIs;
      const extensions = typedParams.extensions
        .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`))
        .join(", ");
      return t("errors.file_extension_must_be", { extension: extensions });
    },
  },
  fileExtensionIsNot: {
    check: (
      value: TResponseDataValue,
      params: TValidationRuleParams,
      element: TSurveyElement
    ): TValidatorCheckResult => {
      const typedParams = params as TValidationRuleParamsFileExtensionIsNot;
      if (element.type !== "fileUpload") {
        return { valid: true };
      }
      // Skip validation if value is empty
      if (!value || !Array.isArray(value) || value.length === 0) {
        return { valid: true };
      }
      // Normalize forbidden extensions: ensure they start with a dot
      const forbiddenExtensions = new Set(
        typedParams.extensions.map((ext) =>
          ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`
        )
      );

      // Check all files in the array
      for (const fileUrl of value) {
        if (typeof fileUrl !== "string") continue;
        // Extract filename from URL
        const urlPath = fileUrl.split("?")[0]; // Remove query params
        const fileName = urlPath.split("/").pop() || "";
        if (!fileName.includes(".")) {
          continue; // Files without extensions are allowed
        }
        const fileExtension = `.${fileName.split(".").pop()?.toLowerCase() ?? ""}`;
        // Check if file extension matches any of the forbidden extensions
        if (forbiddenExtensions.has(fileExtension)) {
          return { valid: false };
        }
      }
      return { valid: true };
    },
    getDefaultMessage: (params: TValidationRuleParams, _element: TSurveyElement, t: TFunction): string => {
      const typedParams = params as TValidationRuleParamsFileExtensionIsNot;
      const extensions = typedParams.extensions
        .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`))
        .join(", ");
      return t("errors.file_extension_must_not_be", { extension: extensions });
    },
  },
};
