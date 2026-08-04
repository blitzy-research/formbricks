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

/** One reason a slider configuration was rejected, addressed at the field that carries the mistake. */
export interface TSurveySliderConfigurationIssue {
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
 * reading the fraction alone would understate every such number. This is the scale the grid's points are
 * expressed on: a point of `min + n * step` needs no more decimals than the wider of the origin and the step.
 */
const decimalPlaces = (input: number): number => {
  if (!Number.isFinite(input)) return 0;

  const [mantissa, exponent] = String(Math.abs(input)).split("e");
  const fraction = mantissa.split(".")[1] ?? "";
  if (!exponent) return fraction.length;

  return Math.max(fraction.length - Number(exponent), 0);
};

/**
 * Decimal places a fixed-point restatement can express. Beyond this a grid point has no decimal form to be
 * restated in, so the arithmetic that reconstructs it has to be judged by its rounding error instead.
 */
const MAX_DECIMAL_SCALE = 20;

/**
 * Units of `10 ** -scale` a grid point may reach while its decimal form still survives a double round trip.
 *
 * Reconstructing a point costs a multiply and an add, so the double that comes out sits within about two
 * units in the last place of the true point - `magnitude * 2 ** -51`. Restating it at the grid's decimal
 * scale recovers the point exactly only while that error stays below half a unit of that scale, and
 * requiring `magnitude * 2 ** -51` to stay under `0.5 * 10 ** -scale` rearranges to requiring
 * `magnitude * 10 ** scale` to stay under `2 ** 50`.
 *
 * So a grid is exactly expressible while its widest point, counted in units of its own decimal scale, fits
 * in `2 ** 50` - roughly sixteen significant digits, which is all a double carries.
 */
const MAX_SCALED_MAGNITUDE = 2 ** 50;

/**
 * The fraction of a step the shared `stepMultipleOf` response rule forgives a value for being away from an
 * exact grid point, and the units in the last place a reconstruction can cost. Mirrored from that rule
 * because together they decide how far a reconstruction may drift and still be accepted as an answer.
 */
const GRID_ALLOWANCE_FRACTION = 1e-6;
const RECONSTRUCTION_ULPS = 4;

/**
 * The largest magnitude at which a point of this grid is still expressible as a double the response rule
 * accepts as a point of it.
 *
 * Two regimes, because two different things bound the arithmetic:
 * - while the grid's points have a decimal form a fixed-point restatement can express, the restatement lands
 *   on the point itself and the bound is how many units of that scale a double can count - `MAX_SCALED_MAGNITUDE`;
 * - beyond that scale there is no restatement, so the raw reconstruction is what is submitted, and it may
 *   only drift as far as the response rule forgives - a millionth of the step, spent on a few units in the
 *   last place of the magnitude.
 *
 * The two are deliberately NOT combined. The second bound is `step * 1.1e9`, which says nothing useful about
 * a grid that is restated exactly: it would reject `0 .. 1e15` in steps of `1`, every point of which is an
 * integer a double holds exactly.
 */
const highestRepresentableMagnitude = (min: number, step: number): number => {
  const scale = Math.max(decimalPlaces(min), decimalPlaces(step));
  if (scale <= MAX_DECIMAL_SCALE) {
    // `10 ** scale` is finite for every scale that reaches here, so this never divides by Infinity.
    return MAX_SCALED_MAGNITUDE / 10 ** scale;
  }

  return (step * GRID_ALLOWANCE_FRACTION) / (Number.EPSILON * RECONSTRUCTION_ULPS);
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
 * - every point of the grid is still expressible as a double the response rule accepts as a point of it - a
 *   grid finer than the numbers it is measured in cannot be offered and answered consistently, so the range
 *   and the step have to agree about how much precision they ask for.
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
    issues.push({ path: ["range", "min"], message: "Minimum value must be a finite number" });
  }
  if (max === null) {
    issues.push({ path: ["range", "max"], message: "Maximum value must be a finite number" });
  }

  // Only meaningful once both bounds are numbers, and reported once - an author who typed one bad bound has
  // made a single mistake and should be told about a single mistake.
  let usableSpan: number | null = null;
  if (min !== null && max !== null) {
    const span = max - min;
    if (min >= max) {
      issues.push({ path: ["range"], message: "Minimum value must be less than the maximum value" });
    } else if (!Number.isFinite(span)) {
      issues.push({ path: ["range"], message: "The range between the minimum and the maximum is too wide" });
    } else {
      usableSpan = span;
    }
  }

  const step = typeof rawStep === "number" && Number.isFinite(rawStep) && rawStep > 0 ? rawStep : null;

  if (step === null) {
    issues.push({ path: ["step"], message: "Step must be greater than zero" });
  } else if (usableSpan !== null && step > usableSpan) {
    // A step wider than the range would leave only the minimum selectable, which is a configuration error the
    // author should see in the editor rather than discover from respondents.
    issues.push({ path: ["step"], message: "Step cannot be larger than the range" });
  } else if (
    min !== null &&
    max !== null &&
    usableSpan !== null &&
    Math.max(Math.abs(min), Math.abs(max)) > highestRepresentableMagnitude(min, step)
  ) {
    // The grid asks for more precision than a double carries at this magnitude, so its points cannot all be
    // told apart: a control offering them would emit values the shared `stepMultipleOf` rule rejects as off
    // grid, and the survey would refuse the answers it invited. The constraint is a joint one - a coarser
    // step or narrower bounds both satisfy it - so it is reported the same way "Step cannot be larger than
    // the range" is: at the step, naming both numbers.
    issues.push({
      path: ["step"],
      message: "The range and the step ask for more precision than a number can hold",
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
