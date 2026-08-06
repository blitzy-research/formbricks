// Element Type Enum (same as question types)
export enum TSurveyElementTypeEnum {
  FileUpload = "fileUpload",
  OpenText = "openText",
  MultipleChoiceSingle = "multipleChoiceSingle",
  MultipleChoiceMulti = "multipleChoiceMulti",
  NPS = "nps",
  CTA = "cta",
  Rating = "rating",
  Consent = "consent",
  PictureSelection = "pictureSelection",
  Cal = "cal",
  Date = "date",
  Matrix = "matrix",
  Address = "address",
  Ranking = "ranking",
  ContactInfo = "contactInfo",
  Payment = "payment",
  OpinionScale = "opinionScale",
  Slider = "slider",
}

/** The numeric configuration of a slider element, once it has been proven usable. */
export interface TSurveySliderConfiguration {
  /** Inclusive lower bound, and the origin the step grid is anchored at */
  min: number;
  /** Inclusive upper bound */
  max: number;
  /** Increment between selectable values, measured from `min` */
  step: number;
}

/**
 * Which of the configuration rules an issue reports.
 *
 * `path` locates the mistake and `message` states it in English, which is what a Zod issue and an API error
 * need. Neither is a stable handle: two rules share the `["range"]` path and two more share `["step"]`, and
 * matching on the sentence would break the moment its wording is improved. The code is that handle, so a
 * consumer that has to react to a specific rule - an editor field that shows the mistake in the author's own
 * language - can select on it without restating what makes a configuration usable.
 */
export type TSurveySliderConfigurationIssueCode =
  | "minimumNotANumber"
  | "maximumNotANumber"
  | "minimumNotBelowMaximum"
  | "rangeTooWide"
  | "stepNotPositive"
  | "stepWiderThanRange"
  | "stepTooFineForRange";

/** One reason a slider configuration was rejected, addressed at the field that carries the mistake. */
export interface TSurveySliderConfigurationIssue {
  /** Which rule was broken, for a consumer that has to react to this rule in particular */
  code: TSurveySliderConfigurationIssueCode;
  /** Path relative to the element, ready to hand to a Zod issue */
  path: (string | number)[];
  message: string;
}

export type TSurveySliderConfigurationResult =
  | { valid: true; configuration: TSurveySliderConfiguration }
  | { valid: false; issues: TSurveySliderConfigurationIssue[] };

/**
 * Decimal places a number needs, including the magnitudes JavaScript prints in exponential notation.
 *
 * `String(1e-7)` is `"1e-7"`, which carries no decimal point even though the value needs seven places, so
 * reading the fraction alone would understate every such number.
 */
const decimalPlaces = (input: number): number => {
  if (!Number.isFinite(input)) return 0;

  const [mantissa, exponent] = String(Math.abs(input)).split("e");
  const fraction = mantissa.split(".")[1] ?? "";
  if (!exponent) return fraction.length;

  return Math.max(fraction.length - Number(exponent), 0);
};

/**
 * The decimal places a number's PRINTED form carries, which is a different question.
 *
 * A range control reads a step's scale off its printed form - `String(step).split(".")[1]` - so a step
 * JavaScript prints in exponential notation is read as carrying no decimals at all, and its grid collapses
 * onto whole numbers. `1e-7` needs seven places and shows none; `1.5e-7` needs eight and shows four.
 */
const printedDecimalPlaces = (input: number): number => (String(input).split(".")[1] ?? "").length;

/**
 * Whether a grid of `step`, reaching `magnitude`, can actually be walked in double precision.
 *
 * A range control does not add a step to a value and stop there. It divides the distance from the origin by
 * the step, rounds that to the nearest whole number of steps, multiplies back, and then restates the result
 * at the step's own decimal scale - a `Math.round(value * 10 ** scale) / 10 ** scale`. That restatement is
 * exact only while `value * 10 ** scale` stays inside the range of integers a double represents exactly. Past
 * it, the rounding lands on the wrong multiple, and the symptom is what a respondent sees: pressing the arrow
 * key skips a grid point, or stops moving the handle altogether. A range of `0` to `1e15` in steps of `0.2`
 * is the smallest realistic configuration that breaks this way - `1e15 * 10` is `1e16`, and doubles stop
 * being exact above `9007199254740991`.
 *
 * The two conditions below are therefore the same requirement stated at both ends of the scale: the grid,
 * measured in units of the step's finest decimal place, has to be a whole number a double holds exactly, and
 * the step's scale has to be the one a control reading its printed form will actually see.
 *
 * This is deliberately conservative at the top of the double range: a configuration whose grid happens to
 * survive because its step is a power of two is rejected along with the ones that do not. Refusing a range
 * above roughly a quadrillion with a fractional step costs nothing real, and the alternative - accepting a
 * grid the control cannot walk - is the defect this exists to prevent.
 */
const isGridRepresentable = (magnitude: number, step: number): boolean => {
  if (printedDecimalPlaces(step) !== decimalPlaces(step)) return false;

  const scaled = magnitude * 10 ** decimalPlaces(step);
  return Number.isFinite(scaled) && scaled <= Number.MAX_SAFE_INTEGER;
};

/**
 * THE canonical definition of a usable slider configuration.
 *
 * Every layer that has to decide whether a slider's `range` and `step` can be trusted asks this one function,
 * so the schema an author is validated against and the evaluator that judges a respondent's answer cannot
 * drift apart: a configuration the editor accepts is exactly a configuration whose answers can be validated,
 * and any other configuration is rejected by both.
 *
 * The parameter is `unknown` on purpose. The compiled element type asserts these fields are present and
 * numeric, but a survey saved through the editor's draft autosave path reaches persistence without passing
 * this schema, so at runtime the fields may be absent, non-numeric or contradictory. Reading them defensively
 * is what lets the evaluator fail closed instead of raising a TypeError.
 *
 * A configuration is usable when, and only when:
 * - `min` and `max` are finite numbers and `min < max` - anything else describes no selectable range;
 * - `max - min` is itself finite - `-1e308` to `1e308` has finite bounds but a span no double can hold, which
 *   would make every derived measurement (a percentage along the track, a mean of the answers) meaningless;
 * - `step` is a finite number greater than zero - a non-positive or infinite step describes no grid;
 * - `step` is no wider than the span - a wider step leaves only the minimum selectable;
 * - the grid can be walked in double precision at the magnitude the bounds reach - see
 *   `isGridRepresentable`. A grid too fine for its own range is one no control can step through, so the
 *   respondent's arrow key would skip points or stop moving the handle.
 */
export const parseSurveySliderConfiguration = (element: unknown): TSurveySliderConfigurationResult => {
  const issues: TSurveySliderConfigurationIssue[] = [];
  const { range, step: rawStep } = (element ?? {}) as { range?: unknown; step?: unknown };
  const bounds = (typeof range === "object" && range !== null ? range : {}) as {
    min?: unknown;
    max?: unknown;
  };

  const min = typeof bounds.min === "number" && Number.isFinite(bounds.min) ? bounds.min : null;
  const max = typeof bounds.max === "number" && Number.isFinite(bounds.max) ? bounds.max : null;

  if (min === null) {
    issues.push({
      code: "minimumNotANumber",
      path: ["range", "min"],
      message: "Minimum value must be a finite number",
    });
  }
  if (max === null) {
    issues.push({
      code: "maximumNotANumber",
      path: ["range", "max"],
      message: "Maximum value must be a finite number",
    });
  }

  // Only meaningful once both bounds are numbers, and reported once - an author who typed one bad bound has
  // made a single mistake and should be told about a single mistake.
  let usableSpan: number | null = null;
  if (min !== null && max !== null) {
    const span = max - min;
    if (min >= max) {
      issues.push({
        code: "minimumNotBelowMaximum",
        path: ["range"],
        message: "Minimum value must be less than the maximum value",
      });
    } else if (!Number.isFinite(span)) {
      issues.push({
        code: "rangeTooWide",
        path: ["range"],
        message: "The range between the minimum and the maximum is too wide",
      });
    } else {
      usableSpan = span;
    }
  }

  const step = typeof rawStep === "number" && Number.isFinite(rawStep) && rawStep > 0 ? rawStep : null;

  if (step === null) {
    issues.push({ code: "stepNotPositive", path: ["step"], message: "Step must be greater than zero" });
  } else if (usableSpan !== null && step > usableSpan) {
    // A step wider than the range would leave only the minimum selectable, which is a configuration error the
    // author should see in the editor rather than discover from respondents.
    issues.push({
      code: "stepWiderThanRange",
      path: ["step"],
      message: "Step cannot be larger than the range",
    });
  } else if (
    min !== null &&
    max !== null &&
    !isGridRepresentable(Math.max(Math.abs(min), Math.abs(max), usableSpan ?? 0), step)
  ) {
    // Reported once, at the step, because the step is the field an author can act on: the same grid becomes
    // usable the moment it is made coarser, and the bounds are usually the part they actually meant. The
    // magnitude the grid has to survive is the largest number it reaches - either bound, or the span the
    // control is driven across - because that is where the arithmetic runs out of precision first.
    issues.push({
      code: "stepTooFineForRange",
      path: ["step"],
      message: "Step is too fine for this range to be selectable",
    });
  }

  // Each unusable operand already recorded its own issue, so this both narrows the three values and reports
  // what was wrong with them.
  if (min === null || max === null || step === null) {
    return { valid: false, issues };
  }

  // The remaining issues are the ones about how the operands relate: an inverted range, an unrepresentable
  // span, a step wider than the span.
  if (issues.length > 0) {
    return { valid: false, issues };
  }

  return { valid: true, configuration: { min, max, step } };
};
