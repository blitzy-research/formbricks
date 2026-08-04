import { describe, expect, test } from "vitest";
import { decimalPlaces, getTickCount, tickToValue, valueToTick } from "../slider-grid";

/**
 * The Slider control's grid arithmetic, exercised directly.
 *
 * The component specs beside this file prove what the control reports for an interaction; these prove the
 * property those reports depend on, at magnitudes and precisions a rendered interaction cannot conveniently
 * reach: **every tick the control offers addresses a value the shared response rule accepts as a point of
 * `min + n * step`, and that value is inside the configured range and inside the double range.**
 *
 * That property is what makes the control and the server agree, and it holds for every configuration - not
 * only for the ones an author can publish. The two are kept in step from opposite ends:
 *
 * - `parseSurveySliderConfiguration` in `@formbricks/types` refuses a configuration whose grid asks for more
 *   precision than a double carries, so no published slider can describe one.
 * - `getTickCount` here applies the same limit to the ticks it offers, so a DRAFT configuration - which
 *   reaches the runtime without passing that schema - is offered only as far as it can be answered. Ticks it
 *   withholds are values a respondent cannot reach; ticks it offered wrongly would be values the server
 *   rejects after the fact, which is the failure this bound exists to prevent.
 *
 * Where the grid's points have a decimal form `toFixed` can restate, "accepts" means exactly on the grid,
 * with no tolerance at all - the assertions below are written that way deliberately. Only beyond that scale,
 * where no restatement exists, does the reconstruction rely on the fraction of a step the response rule
 * forgives, and those cases say so explicitly.
 */

/**
 * Whether `value` is exactly a point of the grid `min + n * step`.
 *
 * Exact decimal arithmetic over BigInts, which is the arithmetic the shared `stepMultipleOf` response rule
 * performs - so what is asserted here is membership of the set the server accepts, not of an approximation
 * of it. No tolerance is allowed: the rule forgives a couple of units in the last place, and proving the
 * stricter property is what shows the control is not relying on that allowance.
 */
const isOnGrid = (value: number, min: number, step: number): boolean => {
  const toExactDecimal = (input: number): { digits: bigint; scale: number } => {
    const {
      sign = "",
      whole = "0",
      fraction = "",
      exponent = "0",
    } = /^(?<sign>-?)(?<whole>\d+)(?:\.(?<fraction>\d+))?(?:e(?<exponent>[+-]?\d+))?$/i.exec(String(input))
      ?.groups ?? {};
    let digits = BigInt(whole + fraction);
    let scale = fraction.length - Number(exponent);
    if (scale < 0) {
      digits *= 10n ** BigInt(-scale);
      scale = 0;
    }
    return { digits: sign === "-" ? -digits : digits, scale };
  };

  const parts = [value, min, step].map(toExactDecimal);
  const scale = Math.max(...parts.map((part) => part.scale));
  const [scaledValue, scaledMin, scaledStep] = parts.map(
    (part) => part.digits * 10n ** BigInt(scale - part.scale)
  );

  return scaledStep > 0n && (scaledValue - scaledMin) % scaledStep === 0n;
};

describe("decimalPlaces", () => {
  test.each([
    [0, 0],
    [1, 0],
    [100, 0],
    [0.5, 1],
    [0.0007, 4],
    [-2.25, 2],
  ] as [number, number][])("reads %s as needing %s places", (input, expected) => {
    expect(decimalPlaces(input)).toBe(expected);
  });

  test.each([
    [1e-7, 7],
    [1.5e-7, 8],
    [1e-21, 21],
  ] as [number, number][])("reads the exponential form %s as needing %s places", (input, expected) => {
    // The printed form carries no decimal point, so reading only its fraction - as the slider primitive
    // does internally - would report zero places and round every point of such a grid away.
    expect(decimalPlaces(input)).toBe(expected);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "reads %s as needing none",
    (input) => {
      expect(decimalPlaces(input)).toBe(0);
    }
  );
});

describe("getTickCount", () => {
  test.each([
    ["a whole grid", 0, 100, 5, 20],
    ["a unit grid", 0, 100, 1, 100],
    ["a range a billion steps wide", 0, 1_000_000_000, 1, 1_000_000_000],
    ["a decimal grid whose quotient is not exact", 0, 0.3, 0.1, 3],
    ["a grid finer than the primitive can round", 0, 1, 1e-7, 10_000_000],
    ["an origin finer than the step", 10.5, 20.5, 1, 10],
    ["a grid spanning zero", -50, 50, 0.5, 200],
    ["a grid that does not start at zero", 10, 50, 5, 8],
  ] as [string, number, number, number, number][])(
    "counts the steps of %s",
    (_label, min, max, step, expected) => {
      expect(getTickCount(min, max, step)).toBe(expected);
    }
  );

  test.each([
    ["a step that overshoots the maximum", 0, 10, 3, 3],
    ["a step that fits only once", 0, 10, 6, 1],
    ["an origin whose last point overshoots", 10.5, 20, 1, 9],
  ] as [string, number, number, number, number][])(
    "holds %s inside the range",
    (_label, min, max, step, expected) => {
      expect(getTickCount(min, max, step)).toBe(expected);
      expect(tickToValue(expected, min, step)).toBeLessThanOrEqual(max);
      expect(tickToValue(expected + 1, min, step)).toBeGreaterThan(max);
    }
  );

  test.each([
    ["an inverted range", 100, 0, 5],
    ["a collapsed range", 5, 5, 1],
    ["a non-positive step", 0, 100, 0],
    ["a negative step", 0, 100, -5],
    ["a non-finite step", 0, 100, Number.POSITIVE_INFINITY],
    ["a non-finite bound", 0, Number.POSITIVE_INFINITY, 1],
    ["a bound that is not a number", 0, Number.NaN, 1],
  ] as [string, number, number, number][])("describes no grid for %s", (_label, min, max, step) => {
    expect(getTickCount(min, max, step)).toBe(0);
  });

  test("bounds a grid whose points a double cannot tell apart", () => {
    // 1e30 points. Past a certain magnitude the spacing between doubles outgrows this grid's step, so a
    // value there cannot be shown to be a point of it and the shared response rule would reject it. The
    // element schema refuses such a configuration outright, so only a draft reaches this path; the grid is
    // then offered as far as it is representable - which is still over a billion points - rather than in
    // full and approximately.
    const tickCount = getTickCount(0, 1, 1e-30);

    expect(tickCount).toBeGreaterThan(1_000_000_000);
    expect(tickCount).toBeLessThan(Number.MAX_SAFE_INTEGER);
    // The bound is where it is because of precision, not because of the range: every tick offered is inside
    // the configured bounds with room to spare.
    expect(tickToValue(tickCount, 0, 1e-30)).toBeLessThan(1);
  });

  test("offers only the origin when even the first step is beyond what a double can place", () => {
    // The origin is 29 orders of magnitude coarser than the step, so no second point of this grid is
    // distinguishable from the first. The origin itself is exact, and is all the control offers.
    expect(getTickCount(0.5, 1, 1e-30)).toBe(0);
    expect(tickToValue(0, 0.5, 1e-30)).toBe(0.5);
  });

  test("stops a grid one step short of leaving the double range", () => {
    // The second point of this grid is not a finite number.
    expect(getTickCount(1.7e308, 1.79e308, 1e307)).toBe(0);
  });

  test("offers the whole of the widest grid the element schema admits", () => {
    // Every point of this grid is an integer a double holds exactly, 1e15 of them, and the control offers all
    // of them: the bound is about the precision the range and the step ask for together, never about
    // magnitude alone. Getting this wrong in the other direction - withholding ticks of a published
    // configuration - would leave part of a slider's own range unreachable.
    expect(getTickCount(0, 1e15, 1)).toBe(1e15);
    expect(tickToValue(1e15, 0, 1)).toBe(1e15);
  });

  test("measures its headroom from the signed origin, so a grid below zero is offered in full", () => {
    // A grid anchored at -1e12 climbs through zero, so the magnitude its values reach is bounded by its
    // maximum, not by |min| + span. Measuring the headroom from |min| instead would cut this grid off at
    // roughly a tenth of its own range.
    const tickCount = getTickCount(-1e12, 1e12, 0.5);

    expect(tickCount).toBe(4e12);
    expect(tickToValue(tickCount, -1e12, 0.5)).toBe(1e12);
  });
});

/**
 * The configurations the element schema refuses, offered here anyway.
 *
 * A draft an author is still typing is persisted without passing the element schema, so the runtime can be
 * handed a grid the schema would have rejected. The control's contract in that state is not "render nothing"
 * but "never offer a value the server will reject": these are the two cross-layer counterexamples that
 * motivated the shared representability limit, plus the mid-magnitude case that shows the same defect with
 * numbers an author could plausibly have typed.
 */
describe("grids a double cannot express are offered only as far as they can be answered", () => {
  test.each([
    // A 0.3 grid on a 1e21 origin: adjacent doubles there are 131072 apart, so 436907 nominal points share
    // two representable values. Only the origin itself is a point of the grid, and only the origin is offered.
    ["a fine grid on an origin past the safe integer range", 1e21, 1.0000000000000001e21, 0.3],
    // 1e20 nominal points, of which a double can index 9e15. The prefix that is offered is exact.
    ["a step finer than the range can express", 0, 1, 1e-20],
    // The spacing between doubles at 1e15 is 0.125, over half of this step, so the reconstruction of a high
    // tick rounds onto a neighbour and would be restated half a step off the grid.
    ["a decimal grid whose points scale past a double", 0, 1e15, 0.2],
  ] as [string, number, number, number][])(
    "addresses only points of %s, from either end",
    (_label, min, max, step) => {
      const tickCount = getTickCount(min, max, step);

      // Both ends, the middle, and the two ticks below the last: the top is where the reconstruction carries
      // the most error and where an unbounded grid would first go wrong.
      const ticks = [
        ...new Set([0, 1, 2, Math.floor(tickCount / 2), tickCount - 2, tickCount - 1, tickCount]),
      ].filter((tick) => tick >= 0 && tick <= tickCount);

      for (const tick of ticks) {
        const value = tickToValue(tick, min, step);

        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(min);
        expect(value).toBeLessThanOrEqual(max);
        expect(isOnGrid(value, min, step)).toBe(true);
      }
    }
  );

  test("holds a 0.3 grid on a 1e21 origin at its origin alone", () => {
    // The concrete counterexample: 436907 ticks were offered before the limit was shared with the schema,
    // and every interaction above the midpoint submitted a value 0.1 off the grid - which the response rule
    // rejects, tolerating only a millionth of the step.
    expect(getTickCount(1e21, 1.0000000000000001e21, 0.3)).toBe(0);
    expect(tickToValue(0, 1e21, 0.3)).toBe(1e21);
    expect(isOnGrid(tickToValue(0, 1e21, 0.3), 1e21, 0.3)).toBe(true);
  });

  test("never offers the half-step values a 0.2 grid at 1e15 would round onto", () => {
    // 1000000000000000.5 and 1000000000000000.9 are each a whole half-step off this grid, and are exactly
    // the values the unbounded reconstruction produced. The offered grid stops long before them.
    const tickCount = getTickCount(0, 1e15, 0.2);
    const highest = tickToValue(tickCount, 0, 0.2);

    expect(highest).toBeLessThan(1000000000000000);
    for (const tick of [tickCount, tickCount - 1, tickCount - 2]) {
      expect(isOnGrid(tickToValue(tick, 0, 0.2), 0, 0.2)).toBe(true);
    }
  });
});

describe("tickToValue", () => {
  test.each([
    ["the origin", 0, 0, 5, 0],
    ["a whole grid", 7, 0, 5, 35],
    ["a decimal grid", 3, 0, 0.1, 0.3],
    ["an offset decimal grid", 1, 0.05, 0.1, 0.15],
    ["an origin finer than the step", 1, 10.5, 1, 11.5],
    ["a grid finer than a whole number of places", 1, 0, 0.0007, 0.0007],
    ["a grid spanning zero", 1, -50, 10, -40],
    ["a grid a billion steps wide", 1_000_000_000, 0, 1, 1_000_000_000],
    ["a grid too fine for the primitive to round", 1, 0, 1e-7, 1e-7],
    ["a fine grid on a large origin", 1, 1_000_000, 1e-7, 1_000_000.0000001],
  ] as [string, number, number, number, number][])(
    "restates %s exactly",
    (_label, tick, min, step, expected) => {
      expect(tickToValue(tick, min, step)).toBe(expected);
    }
  );

  test("returns no value when the reconstruction leaves the double range", () => {
    expect(tickToValue(2, 1.7e308, 1e308)).toBeNaN();
  });

  test("keeps the raw reconstruction when the grid is finer than a fixed-point form can express", () => {
    // Restating at 30 decimal places is impossible, and truncating to the 20 that are possible would return
    // a different number altogether. The reconstruction is within a unit or two of the last place of the
    // true point, which the shared response rule forgives.
    const reconstructed = tickToValue(3, 0, 1e-30);

    expect(Number.isFinite(reconstructed)).toBe(true);
    expect(reconstructed).toBeCloseTo(3e-30, 40);
  });

  test.each([
    ["a whole grid", 0, 100, 5],
    ["a decimal grid", 0, 1, 0.1],
    ["an origin finer than the step", 10.5, 20.5, 1],
    ["a grid spanning zero", -50, 50, 0.5],
    ["a grid too fine for the primitive to round", 0, 1, 1e-7],
    ["a fine grid on a large origin", 1_000_000, 1_000_001, 1e-7],
    ["a range a billion steps wide", 0, 1_000_000_000, 1],
    ["a grid whose last point overshoots", 0, 10, 3],
  ] as [string, number, number, number][])(
    "addresses only points of %s, from either end",
    (_label, min, max, step) => {
      const tickCount = getTickCount(min, max, step);
      // Both ends and a sample from the middle: the ends are where a relative tolerance fails, and the
      // middle is where a decimal step accumulates the most noise.
      const ticks = [0, 1, 2, Math.floor(tickCount / 2), tickCount - 1, tickCount].filter(
        (tick) => tick >= 0 && tick <= tickCount
      );

      for (const tick of ticks) {
        const value = tickToValue(tick, min, step);

        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(min);
        expect(value).toBeLessThanOrEqual(max);
        expect(isOnGrid(value, min, step)).toBe(true);
      }
    }
  );
});

describe("valueToTick", () => {
  test("finds the tick of a value that is a point of the grid", () => {
    expect(valueToTick(35, 0, 5, 20)).toBe(7);
  });

  test("finds the nearest tick for a value between two points", () => {
    expect(valueToTick(7, 0, 5, 20)).toBe(1);
    expect(valueToTick(8, 0, 5, 20)).toBe(2);
  });

  test("holds a value above the range at the last tick", () => {
    expect(valueToTick(140, 0, 5, 20)).toBe(20);
  });

  test("holds a value below the range at the first tick", () => {
    expect(valueToTick(-20, 0, 5, 20)).toBe(0);
  });

  test("measures from the grid's own origin", () => {
    expect(valueToTick(30, 10, 5, 8)).toBe(4);
  });

  test("survives a span as wide as the double range", () => {
    // Halving both terms before dividing is what keeps this from overflowing to Infinity and then to NaN.
    expect(valueToTick(0, -1e308, 1e307, Number.MAX_SAFE_INTEGER)).toBe(10);
  });

  test.each([
    ["a value that is not a number", Number.NaN, 0, 5, 20],
    ["a grid with no ticks", 5, 0, 5, 0],
    ["a step that describes no grid", 5, 0, 0, 20],
  ] as [string, number, number, number, number][])(
    "resolves %s to the first tick",
    (_label, value, min, step, tickCount) => {
      expect(valueToTick(value, min, step, tickCount)).toBe(0);
    }
  );
});
