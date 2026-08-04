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

// Decimals the mean is printed with. Two is what every averaged card in this folder shows - the rating,
// opinion-scale and payment cards all print `toFixed(2)` - and it is also all the precision there is to show:
// `getElementSummary` rounds the Slider mean through the same shared two-decimal helper before it reaches here.
const DISPLAY_DECIMALS = 2;

// The placeholder this folder already uses for a figure that is unavailable (see SummaryMetadata).
const UNAVAILABLE_AVERAGE_TEXT = "-";

/** What the card needs in order to render the average row and its bar. */
export interface TSliderSummaryDisplay {
  /** The mean at its display precision, or the placeholder for an unavailable figure. */
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
 * Resolves the average text and the bar position for one Slider summary.
 *
 * The aggregation always emits a finite average, so the non-finite fallback only guards a summary read back from
 * an older cache or assembled by hand; without it the card would print the literal `Infinity` while the bar
 * silently clamped itself to full.
 */
export const getSliderSummaryDisplay = (
  elementSummary: TSurveyElementSummarySlider
): TSliderSummaryDisplay => {
  const { min, max } = elementSummary.element.range;
  const { average } = elementSummary;
  const hasFiniteAverage = Number.isFinite(average);

  return {
    averageText: hasFiniteAverage ? average.toFixed(DISPLAY_DECIMALS) : UNAVAILABLE_AVERAGE_TEXT,
    normalized: hasFiniteAverage ? getPositionWithinRange(average, min, max) : 0,
  };
};
