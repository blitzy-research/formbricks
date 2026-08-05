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
  | "stepWiderThanRange";

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
 * - `step` is no wider than the span - a wider step leaves only the minimum selectable.
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
