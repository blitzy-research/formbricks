/**
 * The one grid mechanism the Slider control uses.
 *
 * A slider's selectable values are `min + n * step` for whole `n`, measured from `min` rather than from
 * zero, and the shared response rule that judges a submitted answer decides membership of exactly that set
 * with exact decimal arithmetic. The control therefore may not invent a second, approximate notion of the
 * grid: whatever it emits has to be a point of the same set, for every configuration the element schema
 * admits.
 *
 * That is achieved by never asking the underlying primitive about values at all. The primitive is driven in
 * *tick space* - a whole number `0 .. tickCount` with a step of one - where its own snapping and rounding
 * are exact integer arithmetic, and the tick is converted to a number here, once, on the way out. Two
 * classes of defect disappear with that change rather than being compensated for:
 *
 * - The primitive rounds a snapped value to the decimal precision of the *step*, read from the step's
 *   printed form. A step of `1e-7` prints with no decimal point at all, so it would round every position to
 *   a whole number; and an origin finer than its step - `10.5` in steps of `1` - would be rounded to whole
 *   numbers, none of which is a point of its own grid. In tick space the step is `1` and the rounding is a
 *   no-op.
 * - Counting whole steps by dividing a value by the step needs a tolerance for binary-fraction noise, and a
 *   tolerance proportional to the quotient reaches a whole step once the quotient is large: on `0 .. 1e9`
 *   in steps of `1`, a relative tolerance of 1e-9 is one full step, which is enough to rewrite a selection
 *   of the maximum as one step below it. Here there is no such division: the tick IS the count.
 */

/**
 * Highest tick index the control will address.
 *
 * Beyond this, whole numbers are no longer exactly representable as doubles, so neither the primitive's
 * integer snapping nor the conversion below would be exact. Together with the magnitude bound below, this is
 * what makes a grid the element schema does not admit - `0 .. 1` in steps of `1e-30` describes 1e30 points -
 * reachable only in part rather than incorrectly: every value the control can then emit is still exactly a
 * point of the grid, and a value that is merely unreachable is a presentation limit, whereas a value off the
 * grid would be persisted and then rejected as invalid. Only a draft an author is still typing can reach
 * that state; a published configuration is bounded by the schema to a grid this offers in full.
 */
const MAX_TICK_INDEX = Number.MAX_SAFE_INTEGER;

/**
 * Decimal places `toFixed` can be asked for. Anything finer has no fixed-point form to be restated in, and
 * asking for one would silently truncate the value instead of cleaning it.
 */
const MAX_DECIMAL_SCALE = 20;

/**
 * The fraction of a step the shared response rule forgives a value for being away from an exact grid point.
 * Mirrored here because it is what decides how far the reconstruction below may drift.
 */
const GRID_ALLOWANCE_FRACTION = 1e-6;

/** Units in the last place a multiply-add can cost. Two to three, so four leaves headroom. */
const RECONSTRUCTION_ULPS = 4;

/**
 * Units of `10 ** -scale` a grid point may reach while its restated decimal form still survives a double
 * round trip: `magnitude * 2 ** -51 < 0.5 * 10 ** -scale`, i.e. `magnitude * 10 ** scale < 2 ** 50`.
 *
 * Mirrored from `parseSurveySliderConfiguration` in `@formbricks/types`, which rejects any configuration
 * whose widest bound passes the same limit. This package deliberately does not depend on that one - its
 * components take primitive props and know nothing about survey schemas - so the bound is restated here, and
 * the two must be changed together. Keeping them equal is what makes the control's grid and the schema's
 * grid the same set: a configuration the schema accepts is offered in full here, and a draft configuration
 * the schema rejects is still only ever offered as far as it can be answered.
 */
const MAX_SCALED_MAGNITUDE = 2 ** 50;

/**
 * Decimal places a number needs, including the magnitudes JavaScript prints in exponential notation.
 *
 * `String(1e-7)` is `"1e-7"`, which carries no decimal point even though the value needs seven places, so
 * reading the fraction alone - as the primitive does internally - understates every such number.
 */
export const decimalPlaces = (input: number): number => {
  if (!Number.isFinite(input)) return 0;

  const [mantissa, exponent] = String(Math.abs(input)).split("e");
  const fraction = mantissa.split(".")[1] ?? "";
  if (!exponent) return fraction.length;

  return Math.max(fraction.length - Number(exponent), 0);
};

/**
 * The largest magnitude at which a value of this grid can still be told apart from a neighbouring point.
 *
 * Two regimes, because two different things bound the arithmetic:
 * - While the grid's points have a decimal form `toFixed` can express, `tickToValue` restates the
 *   reconstruction onto that form, and what limits it is how many units of that scale a double can count.
 *   Above that limit the restatement no longer recovers the point: at `1e15` on a `0.2` grid, adjacent
 *   doubles are `0.125` apart, so `min + tick * step` rounds to a neighbour and is restated as a value half
 *   a step off the grid - which the control would emit and the server would then reject.
 * - Beyond that scale there is no restatement at all, so the raw reconstruction is what is emitted, and it
 *   may only drift as far as the shared response rule forgives: doubles are spaced
 *   `magnitude * Number.EPSILON` apart, so once a few of those outgrow a millionth of the step, no double
 *   there is close enough to a grid point to be accepted as one.
 *
 * The two are deliberately not combined: the second says nothing useful about a grid that is restated
 * exactly, and applying it there would cut `0 .. 1e15` in steps of `1` down to its first billion points
 * even though every one of them is an integer a double holds exactly.
 */
const highestRepresentableMagnitude = (min: number, step: number): number => {
  const scale = Math.max(decimalPlaces(min), decimalPlaces(step));
  if (scale <= MAX_DECIMAL_SCALE) {
    return MAX_SCALED_MAGNITUDE / 10 ** scale;
  }

  return (step * GRID_ALLOWANCE_FRACTION) / (Number.EPSILON * RECONSTRUCTION_ULPS);
};

/**
 * The number a tick addresses: `min + tick * step`, restated exactly wherever a decimal form exists.
 *
 * A grid point needs no more decimals than the wider of the grid's origin and its step, so restating the
 * product at that scale removes the noise the multiply-add leaves without moving the value - `0.05 + 1 * 0.1`
 * comes out of the arithmetic as `0.15000000000000002` and out of here as `0.15`. When the scale is finer
 * than `toFixed` can express, the raw reconstruction is returned unchanged rather than truncated: it is
 * within a couple of units in the last place of the true grid point, which the shared response rule forgives,
 * whereas a truncated value could be an entirely different number.
 *
 * Returns `NaN` for a reconstruction that is not a finite number, which the caller treats as "no value" and
 * never emits.
 */
export const tickToValue = (tick: number, min: number, step: number): number => {
  const reconstructed = min + tick * step;
  if (!Number.isFinite(reconstructed)) return Number.NaN;

  const scale = Math.max(decimalPlaces(min), decimalPlaces(step));
  if (scale > MAX_DECIMAL_SCALE) return reconstructed;

  const restated = Number(reconstructed.toFixed(scale));
  return Number.isFinite(restated) ? restated : reconstructed;
};

/**
 * How many steps of this grid a double can still place exactly.
 *
 * Precision limits every grid eventually, not only the ones too fine to restate: whether the value that is
 * emitted is the restated decimal or the raw reconstruction, past some magnitude it stops being a point of
 * the grid it came from. `highestRepresentableMagnitude` says where that is for each of those two regimes,
 * and the grid is offered only as far as it holds. Offering more would be a control that lets a respondent
 * pick a value the server then rejects - which is exactly the mismatch this module exists to prevent.
 *
 * The configuration the element schema accepts is bounded by the same limit, so for any published slider this
 * returns more ticks than the range itself contains and the whole grid is offered. It binds only a draft an
 * author is still typing, which reaches the runtime without passing that schema.
 */
const ticksWithinRepresentableMagnitude = (min: number, step: number): number => {
  const bound = highestRepresentableMagnitude(min, step);

  // The origin is a point of every grid, so a grid anchored past the bound has none that can be placed.
  if (!(Math.abs(min) <= bound)) return 0;

  // Values climb from `min` towards `+bound`, so the headroom is measured from the *signed* origin rather
  // than from its magnitude: a grid anchored at `-1e15` has the whole of `-bound .. +bound` ahead of it, and
  // subtracting `|min|` instead would cut such a grid off less than a tenth of the way along its own range.
  const headroom = bound - min;
  if (!(headroom > 0)) return 0;

  return Math.min(Math.floor(headroom / step), MAX_TICK_INDEX);
};

/**
 * How many whole steps fit between the bounds - the highest tick index the control offers.
 *
 * `0` means the configuration describes no grid at all, which the element schema rejects but a draft an
 * author is still typing can still render.
 *
 * Both terms are halved before dividing so that a span as wide as the double range cannot overflow to
 * `Infinity` on the way in; halving both leaves the quotient unchanged, because division by two is exact.
 * The quotient is then taken to the *nearest* whole number rather than truncated - dividing by a decimal
 * step lands a hair below the whole number it should be, and `0.3 / 0.1` evaluating to `2.9999999999999996`
 * would otherwise cost the grid its last point - and the candidate is kept only if the value it addresses is
 * actually inside the range, which is what holds a grid whose last point overshoots the maximum, such as
 * `10.5 .. 20` in steps of `1`, at `19.5`.
 */
export const getTickCount = (min: number, max: number, step: number): number => {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0) return 0;

  const halfSpan = max / 2 - min / 2;
  // Written as a negated comparison so an inverted, collapsed or NaN span takes this branch too.
  if (!(halfSpan > 0)) return 0;

  const halfStep = step / 2;
  // A step so small that halving it underflows describes a grid finer than the bounds below, so it resolves
  // there rather than through a division by zero.
  const quotient = halfStep > 0 ? halfSpan / halfStep : Number.POSITIVE_INFINITY;

  const nearest = Math.min(
    Number.isFinite(quotient) ? Math.round(quotient) : MAX_TICK_INDEX,
    MAX_TICK_INDEX,
    ticksWithinRepresentableMagnitude(min, step)
  );
  if (nearest <= 0) return 0;

  const highest = tickToValue(nearest, min, step);
  if (Number.isFinite(highest) && highest <= max) return nearest;

  return nearest - 1;
};

/**
 * The tick whose value is closest to `value`, held inside `0 .. tickCount`.
 *
 * This is the positioning direction, so a value that is not a point of the grid - an answer from an earlier
 * configuration, or one posted straight to the API - resolves to the nearest point rather than being
 * refused: the handle has to be drawn somewhere. The value itself is never rewritten by this; the caller
 * keeps reporting and displaying the number it was given, and the shared response rule decides whether it is
 * a valid answer.
 */
export const valueToTick = (value: number, min: number, step: number, tickCount: number): number => {
  if (!Number.isFinite(value) || tickCount <= 0) return 0;

  const halfStep = step / 2;
  if (!(halfStep > 0)) return 0;

  // Halved for the same reason as in `getTickCount`: an offset as wide as the double range must not
  // overflow before it is divided.
  const quotient = (value / 2 - min / 2) / halfStep;
  if (Number.isNaN(quotient)) return 0;

  return Math.min(Math.max(Math.round(quotient), 0), tickCount);
};
