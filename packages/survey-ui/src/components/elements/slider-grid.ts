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
 * integer snapping nor the conversion below would be exact. A configuration whose grid is finer than this
 * bound - `0 .. 1` in steps of `1e-30` describes 1e30 points - is reachable only in part, which is the
 * correct trade: every value the control can then emit is still exactly a point of the grid, and a value
 * that is merely unreachable is a presentation limit, whereas a value off the grid would be persisted and
 * then rejected as invalid.
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
 * The largest magnitude at which a value of this grid can still be told apart from a neighbouring point.
 *
 * Doubles are spaced `magnitude * Number.EPSILON` apart, so once that spacing outgrows the allowance above,
 * no double is close enough to a grid point to be accepted as one - the grid is finer than the number type
 * can express there, and that is a property of arithmetic rather than of this implementation. It only ever
 * binds a grid whose points cannot be restated exactly as decimals; where they can, the restatement lands on
 * the point itself and no allowance is needed.
 */
const highestRepresentableMagnitude = (step: number): number =>
  (step * GRID_ALLOWANCE_FRACTION) / (Number.EPSILON * RECONSTRUCTION_ULPS);

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
 * How many steps of this grid a double can still place exactly, or `MAX_TICK_INDEX` when precision is not
 * what limits it.
 *
 * A grid whose points have an exact decimal form is placed exactly at any magnitude, because the
 * reconstruction is restated onto that form. Where it does not - a step finer than `MAX_DECIMAL_SCALE`
 * places - the reconstruction carries the rounding error of a multiply-add, and the grid can only be offered
 * as far as that error stays inside what the shared response rule forgives. The alternative would be a
 * control that lets a respondent pick a value the server then rejects.
 */
const ticksWithinRepresentableMagnitude = (min: number, step: number): number => {
  if (Math.max(decimalPlaces(min), decimalPlaces(step)) <= MAX_DECIMAL_SCALE) return MAX_TICK_INDEX;

  // `|min + tick * step| <= |min| + tick * step`, so bounding the right-hand side bounds the magnitude for
  // both directions of the grid.
  const headroom = highestRepresentableMagnitude(step) - Math.abs(min);
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
