import { describe, expect, test } from "vitest";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import type { TSurveyElementSummarySlider } from "@formbricks/types/surveys/types";
import { getPositionWithinRange, getSliderSummaryDisplay } from "./sliderSummaryDisplay";

/**
 * Unit tests for the Slider summary card's presentation arithmetic.
 *
 * Two decisions are covered, both of which the card takes before it renders anything: how a mean is printed,
 * and where along the configured range it sits. Both are pure functions of the summary, so they are executed
 * directly here rather than inferred from rendered markup.
 *
 * What is NOT covered here is the card's markup - the header wiring, the dismissed footer, the empty state, the
 * bound and scale label rows. Those are rendered-component concerns and belong to the integration route per this
 * repository's testing guidance. The values this file pins are what that markup displays, so a mistake in the
 * arithmetic fails here rather than being discovered by reading a screenshot.
 *
 * On the bar: `normalized` is deliberately unclamped, because `ProgressBar` clamps its own progress into [0, 1]
 * and floors it to a whole percent. The assertions below therefore state the raw fraction, and note the
 * rendered outcome where the two differ.
 */

interface SummaryOverrides {
  responseCount?: number;
  average?: number;
  dismissedCount?: number;
  range?: { min: number; max: number };
  step?: number;
}

function createSliderSummary(overrides: SummaryOverrides = {}): TSurveyElementSummarySlider {
  const {
    responseCount = 4,
    average = 50,
    dismissedCount = 0,
    range = { min: 0, max: 100 },
    step = 5,
  } = overrides;

  return {
    type: TSurveyElementTypeEnum.Slider,
    element: {
      id: "slider-1",
      type: TSurveyElementTypeEnum.Slider,
      headline: { default: "How satisfied are you?" },
      required: true,
      range,
      step,
      lowerLabel: { default: "Not satisfied" },
      upperLabel: { default: "Very satisfied" },
      showValue: true,
    },
    responseCount,
    average,
    dismissed: { count: dismissedCount },
  } as TSurveyElementSummarySlider;
}

/** Shorthand for the average text a given summary resolves to. */
const averageTextFor = (overrides: SummaryOverrides): string =>
  getSliderSummaryDisplay(createSliderSummary(overrides)).averageText;

/** Shorthand for the bar fraction a given summary resolves to. */
const normalizedFor = (overrides: SummaryOverrides): number =>
  getSliderSummaryDisplay(createSliderSummary(overrides)).normalized;

// ---------------------------------------------------------------------------
// The average, at the two decimals every averaged card in this folder shows
// ---------------------------------------------------------------------------

describe("getSliderSummaryDisplay — average text", () => {
  test("renders the average to two decimal places", () => {
    expect(averageTextFor({ average: 62.5 })).toBe("62.50");
  });

  test("renders a whole-number average with trailing zeros rather than bare", () => {
    // Two decimals is what every sibling summary card in this folder shows.
    expect(averageTextFor({ average: 42 })).toBe("42.00");
  });

  test("rounds rather than truncates a long average", () => {
    // 110 / 3 — the mean of an exact division, whose own decimal scale is 15 places.
    expect(averageTextFor({ average: 36.666666666666664, step: 5 })).toBe("36.67");
  });

  test("renders an average of zero rather than treating it as missing", () => {
    expect(averageTextFor({ average: 0 })).toBe("0.00");
  });

  test("renders a negative average", () => {
    expect(averageTextFor({ average: -12.5, range: { min: -50, max: 50 }, step: 5 })).toBe("-12.50");
  });

  test("prints a fine grid's mean at the precision that grid calls for", () => {
    // The precision is derived from the element's own configuration. At the two decimals the sibling cards
    // print, every possible mean of this range would read as 0.00 - which is the figure the card exists to
    // report. Four places for the grid, two more for a mean that sits between two of its points.
    expect(averageTextFor({ average: 0.0005, range: { min: 0, max: 0.001 }, step: 0.0001 })).toBe("0.000500");
  });

  test("prints a mean between two points of a fine grid at full precision", () => {
    // The mean of 0.0001 and 0.0002 - a figure that is not itself selectable, and that two decimals would
    // report as 0.00 and the grid's own four as 0.0002 rather than 0.00015.
    expect(averageTextFor({ average: 0.00015, range: { min: 0, max: 0.001 }, step: 0.0001 })).toBe(
      "0.000150"
    );
  });

  test("takes the precision from the bounds when they are finer than the step", () => {
    expect(averageTextFor({ average: 10.5, range: { min: 0.005, max: 20.005 }, step: 5 })).toBe("10.50000");
  });

  test("takes the precision from a step written in exponential notation", () => {
    // `String(1e-7)` carries no decimal point at all, so reading its fraction alone would report no places
    // and print every mean of this range as 0.00.
    expect(averageTextFor({ average: 5e-7, range: { min: 0, max: 1e-6 }, step: 1e-7 })).toBe("0.000000500");
  });

  test("falls back to exponential notation when no fixed-point form can express the mean", () => {
    // A grid this fine needs more decimals than `toFixed` can produce, and printing 0 for a mean that is not
    // zero is the loss this fallback exists to prevent.
    expect(averageTextFor({ average: 5e-30, range: { min: 0, max: 1e-28 }, step: 1e-30 })).toBe("5e-30");
  });

  test("still prints a genuine zero as a fixed figure on a grid too fine for one", () => {
    expect(averageTextFor({ average: 0, range: { min: 0, max: 1e-28 }, step: 1e-30 })).toBe(
      "0.00000000000000000000"
    );
  });

  test("prints an offset grid's mean at the same two decimals", () => {
    expect(averageTextFor({ average: 26, range: { min: 10, max: 50 }, step: 5 })).toBe("26.00");
  });

  test("prints a very large mean without spelling out its magnitude in digits", () => {
    // `toFixed` hands back exponential notation above 1e21, so an extreme mean stays a readable figure in the
    // average row instead of 300 characters of digits.
    expect(averageTextFor({ average: 9e306, range: { min: 0, max: 9e306 }, step: 1 })).toBe("9e+306");
  });

  test.each([
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["NaN", Number.NaN],
  ] as [string, number][])("falls back to a dash for %s", (_label, average) => {
    // The aggregation guards its own output, so these can only arrive from a summary read back from an older
    // cache or assembled by hand. Without the guard the card prints the literal `Infinity` while the bar
    // silently clamps itself to full.
    expect(averageTextFor({ average })).toBe("-");
  });
});

// ---------------------------------------------------------------------------
// The bar position, measured from the configured minimum
// ---------------------------------------------------------------------------

describe("getSliderSummaryDisplay — average position within the configured range", () => {
  test.each([
    ["the midpoint of a zero-based range", { min: 0, max: 100 }, 50, 0.5],
    ["the minimum of a zero-based range", { min: 0, max: 100 }, 0, 0],
    ["the maximum of a zero-based range", { min: 0, max: 100 }, 100, 1],
    // The case a naive `average / max` gets wrong: measured from the minimum, 20 sits a quarter of the way
    // along 10..50; measured from zero it would read as 40%.
    ["a quarter along an offset range", { min: 10, max: 50 }, 20, 0.25],
    ["the minimum of an offset range", { min: 10, max: 50 }, 10, 0],
    ["the midpoint of a range spanning zero", { min: -50, max: 50 }, 0, 0.5],
    ["a fractional range", { min: 0, max: 1 }, 0.25, 0.25],
    // A range finer than the displayed precision still resolves across its whole width.
    ["a range finer than two decimals", { min: 0, max: 0.001 }, 0.0005, 0.5],
  ] as [string, { min: number; max: number }, number, number][])(
    "places %s at %f of the bar",
    (_label, range, average, expected) => {
      expect(normalizedFor({ range, average })).toBeCloseTo(expected, 10);
    }
  );

  test("reports a fraction above one for an average past the configured maximum", () => {
    // Left unclamped on purpose: ProgressBar clamps into [0, 1], so this renders as a full bar.
    expect(normalizedFor({ range: { min: 0, max: 100 }, average: 150 })).toBe(1.5);
  });

  test("reports a negative fraction for an average below the configured minimum", () => {
    // Renders as an empty bar for the same reason.
    expect(normalizedFor({ range: { min: 10, max: 50 }, average: 5 })).toBe(-0.125);
  });

  test("resolves to zero rather than NaN when the bounds collapsed", () => {
    // The schema refuses to publish `min === max`, so this can only arrive from a summary read back from an
    // older cache. The bar clamps into [0, 1] but cannot rescue NaN, hence the span guard.
    const collapsed = normalizedFor({ range: { min: 25, max: 25 }, average: 25 });

    expect(collapsed).toBe(0);
    expect(Number.isNaN(collapsed)).toBe(false);
  });

  test("resolves to zero rather than a negative fraction when the bounds are inverted", () => {
    expect(normalizedFor({ range: { min: 100, max: 0 }, average: 50 })).toBe(0);
  });

  test("resolves to zero for a non-finite average", () => {
    expect(normalizedFor({ average: Number.POSITIVE_INFINITY })).toBe(0);
    expect(normalizedFor({ average: Number.NaN })).toBe(0);
  });

  test("places a mean correctly on a range as wide as the double range itself", () => {
    // `max - min` overflows to Infinity for this pair, which would divide a finite offset down to 0 and report
    // the midpoint as an empty bar. The halved arithmetic keeps both terms representable.
    const midpoint = normalizedFor({ range: { min: -1e308, max: 1e308 }, average: 0 });

    expect(Number.isFinite(midpoint)).toBe(true);
    expect(midpoint).toBeCloseTo(0.5, 10);
  });

  test("keeps the fraction finite when the offset overflows as well", () => {
    // Both `average - min` and `max - min` overflow here, so the direct form is Infinity over Infinity - a NaN
    // that would reach the markup as `width: NaN%`.
    const position = normalizedFor({
      range: { min: -Number.MAX_VALUE, max: Number.MAX_VALUE },
      average: Number.MAX_VALUE / 2,
    });

    expect(Number.isNaN(position)).toBe(false);
    expect(position).toBeCloseTo(0.75, 10);
  });
});

// ---------------------------------------------------------------------------
// The position helper on its own, where the extreme ranges are easiest to state
// ---------------------------------------------------------------------------

describe("getPositionWithinRange", () => {
  test.each([
    ["the midpoint", 50, 0, 100, 0.5],
    ["the minimum", 10, 10, 50, 0],
    ["the maximum", 50, 10, 50, 1],
    ["a range spanning zero", 0, -50, 50, 0.5],
    ["a range as wide as the doubles allow", 0, -Number.MAX_VALUE, Number.MAX_VALUE, 0.5],
  ] as [string, number, number, number, number][])(
    "reports %s as %f",
    (_label, value, min, max, expected) => {
      expect(getPositionWithinRange(value, min, max)).toBeCloseTo(expected, 10);
    }
  );

  test.each([
    ["a collapsed range", 25, 25, 25],
    ["an inverted range", 50, 100, 0],
    ["a bound that is not a number", 50, Number.NaN, 100],
  ] as [string, number, number, number][])("reports 0 for %s", (_label, value, min, max) => {
    expect(getPositionWithinRange(value, min, max)).toBe(0);
  });
});
