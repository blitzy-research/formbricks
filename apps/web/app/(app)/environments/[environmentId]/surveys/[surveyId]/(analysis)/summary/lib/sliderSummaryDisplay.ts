import { TSurveyElementSummarySlider } from "@formbricks/types/surveys/types";

/**
 * Presentation arithmetic for the Slider summary card.
 *
 * The card itself renders; the two things that have to be *decided* before it can render live here, so they can
 * be executed and asserted directly rather than inferred from rendered output: how the mean is printed, and
 * where along the configured range it sits.
 *
 * None of this affects whether an answer is valid. The grid rule in the shared evaluator owns that; these
 * functions only present a mean the aggregation has already computed.
 */

// Decimals a mean is printed with at minimum. Two is what every averaged card in this folder shows - the
// rating, opinion-scale and payment cards all print `toFixed(2)` - so an ordinary Slider reads exactly like
// the cards beside it.
const MINIMUM_DISPLAY_DECIMALS = 2;

// Decimals allowed beyond the grid's own precision. The mean of several answers on a grid of `step` is a
// multiple of `step / count`, so it is routinely finer than any single selectable value; two extra places
// show that a mean sits between two grid points without turning the figure into a wall of digits.
const DISPLAY_DECIMALS_BEYOND_GRID = 2;

// Ceiling imposed by `toFixed`, which accepts at most 100 fraction digits and is only meaningful while the
// figure it produces still round-trips. Beyond this the mean is printed in exponential notation instead.
const MAXIMUM_DISPLAY_DECIMALS = 20;

// The placeholder this folder already uses for a figure that is unavailable (see SummaryMetadata).
const UNAVAILABLE_AVERAGE_TEXT = "-";

/**
 * Decimal places a number needs, including the magnitudes JavaScript prints in exponential notation.
 *
 * `String(1e-7)` is `"1e-7"`, which carries no decimal point even though the value needs seven places, so
 * reading the fraction alone would understate every such bound.
 */
const decimalPlaces = (input: number): number => {
  if (!Number.isFinite(input)) return 0;

  const [mantissa, exponent] = String(Math.abs(input)).split("e");
  const fraction = mantissa.split(".")[1] ?? "";
  if (!exponent) return fraction.length;

  return Math.max(fraction.length - Number(exponent), 0);
};

/** What the card needs in order to render the average row and its bar. */
export interface TSliderSummaryDisplay {
  /**
   * The mean at the precision this element's own grid calls for, or the placeholder for an unavailable
   * figure.
   */
  averageText: string;
  /**
   * Where the mean sits within the configured range, as a fraction measured from the minimum.
   *
   * Deliberately NOT clamped: `ProgressBar` clamps its own progress into [0, 1] and floors it to a whole
   * percent, so a mean outside the range already renders as a full or empty bar. What it cannot rescue is
   * `NaN`, which is why every path that could produce one resolves to 0 here instead.
   */
  normalized: number;
}

/**
 * Where `value` sits along `min`..`max`, as a fraction the progress bar can take, or 0 when the bounds
 * describe no range at all.
 *
 * Both the offset and the span are halved before dividing. A stored range may be as wide as the whole double
 * range, and the direct forms break on one: `max - min` overflows to Infinity for a range spanning it, which
 * divides a finite offset down to 0 and reports a mean two thirds along as an empty bar, and once the offset
 * overflows too the ratio becomes Infinity over Infinity - a NaN that would reach the markup as `width: NaN%`.
 * Halving first keeps both terms representable, and because both are halved the ratio is unchanged: division by
 * two is exact for every normal double, so an ordinary range resolves to exactly the same fraction it did.
 *
 * The result is always finite: each half is at most `Number.MAX_VALUE / 2` in magnitude, so neither difference
 * can overflow, and the divisor is positive by the time it is used. A range so narrow that halving collapses
 * its span into the subnormals degrades to an empty bar rather than to a NaN width, as a collapsed or inverted
 * pair does.
 */
export const getPositionWithinRange = (value: number, min: number, max: number): number => {
  const halfSpan = max / 2 - min / 2;
  // Written as a negated comparison so a NaN span - from a bound that is not a number at all - takes this
  // branch too rather than falling through to a division.
  if (!(halfSpan > 0)) {
    return 0;
  }

  return (value / 2 - min / 2) / halfSpan;
};

/**
 * Decimals to print a mean of this element's answers with.
 *
 * Derived from the element's own configuration rather than fixed, because a Slider's precision is whatever its
 * author chose: a range of 0 to 0.001 in steps of 0.0001 has no figure to show at two decimals, and would read
 * as `0.00` for every possible answer. The grid's precision is the wider of what its bounds and its step need,
 * and the mean is allowed a couple of places beyond that. An ordinary whole-number range resolves to exactly
 * the two decimals the sibling cards print.
 */
const getDisplayDecimals = (min: number, max: number, step: number): number => {
  const gridPrecision = Math.max(decimalPlaces(min), decimalPlaces(max), decimalPlaces(step));

  return Math.min(
    Math.max(gridPrecision + DISPLAY_DECIMALS_BEYOND_GRID, MINIMUM_DISPLAY_DECIMALS),
    MAXIMUM_DISPLAY_DECIMALS
  );
};

/**
 * Prints a finite mean at the precision its element's configuration calls for.
 *
 * `toFixed` already switches to exponential notation above 1e21, which is what keeps an extreme mean a readable
 * figure instead of 300 characters of digits. The explicit fallback covers the other end: a grid finer than a
 * fixed-point form can express would print a real mean as `0.00000000000000000000`, and reporting a mean of
 * zero for answers that were not zero is exactly the loss this function exists to avoid.
 */
const formatAverage = (average: number, min: number, max: number, step: number): string => {
  const fixed = average.toFixed(getDisplayDecimals(min, max, step));

  if (average !== 0 && Number(fixed) === 0) {
    return average.toExponential();
  }

  return fixed;
};

/**
 * Resolves the average text and the bar position for one Slider summary.
 *
 * The aggregation publishes the mean unrounded, so both decisions here are taken from the figure the
 * arithmetic actually produced. It always emits a finite average, so the non-finite fallback only guards a
 * summary read back from an older cache or assembled by hand; without it the card would print the literal
 * `Infinity` while the bar silently clamped itself to full.
 */
export const getSliderSummaryDisplay = (
  elementSummary: TSurveyElementSummarySlider
): TSliderSummaryDisplay => {
  const { min, max } = elementSummary.element.range;
  const { step } = elementSummary.element;
  const { average } = elementSummary;
  const hasFiniteAverage = Number.isFinite(average);

  return {
    averageText: hasFiniteAverage ? formatAverage(average, min, max, step) : UNAVAILABLE_AVERAGE_TEXT,
    normalized: hasFiniteAverage ? getPositionWithinRange(average, min, max) : 0,
  };
};
