import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";
import { ElementError } from "@/components/general/element-error";
import { ElementHeader } from "@/components/general/element-header";
import { Label } from "@/components/general/label";
import { cn } from "@/lib/utils";

/**
 * The keys the underlying primitive acts on: one step at a time with the arrow keys, a larger jump with
 * the page keys and the bounds with Home and End. A key release only counts as a finished slider
 * interaction when it came from one of these, so Tab or a character key can never commit a value.
 */
const SLIDER_KEYS = ["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home", "PageDown", "PageUp"];

/**
 * Relative slack allowed when deciding whether a value already sits on the step grid. Binary floating point
 * cannot hold most decimal steps exactly - `0.3 / 0.1` evaluates to 2.9999999999999996 - so grid membership
 * is decided against a tolerance rather than against zero, the same way the shared response validator does
 * before accepting an answer.
 */
const GRID_EPSILON = 1e-9;

/**
 * Ceiling for the decimal scale a reconstructed grid point is rounded back to. `toFixed` accepts 0 to 100
 * places, and no realistic configuration needs more than this many.
 */
const MAX_GRID_DECIMALS = 20;

/** Fallback announcement for an unanswered control, mirroring how `ElementHeader` defaults its own label. */
const DEFAULT_UNANSWERED_LABEL = "No value selected";

/** Fallback required marker, kept identical to the default `ElementHeader` applies. */
const DEFAULT_REQUIRED_LABEL = "Required";

/**
 * Decimal places in a number's plain decimal form, or `null` when it is written in exponential form and so
 * has no fixed decimal scale to round back to.
 */
const decimalPlaces = (value: number): number | null => {
  const text = String(value);
  if (text.includes("e") || text.includes("E")) {
    return null;
  }

  const separator = text.indexOf(".");
  return separator === -1 ? 0 : text.length - separator - 1;
};

interface SliderProps {
  /** Unique identifier for the element container */
  elementId: string;
  /** The main element or prompt text displayed as the headline */
  headline: string;
  /** Optional descriptive text displayed below the headline */
  description?: string;
  /** Unique identifier for the slider control */
  inputId: string;
  /** Minimum selectable value (the lower bound of the configured range) */
  min: number;
  /** Maximum selectable value (the upper bound of the configured range) */
  max: number;
  /** Increment between selectable values */
  step: number;
  /** Currently selected value; `undefined` means unanswered */
  value?: number;
  /** Callback function called when the value changes */
  onChange: (value: number) => void;
  /**
   * Callback function called once per completed interaction - a pointer release or a key release - with the
   * value that interaction settled on. Live movement reports through `onChange`; this reports completion, so
   * a consumer measuring interaction time counts each drag or keystroke exactly once.
   */
  onValueCommit?: (value: number) => void;
  /** Optional label for the lower end of the scale */
  lowerLabel?: string;
  /** Optional label for the upper end of the scale */
  upperLabel?: string;
  /** Whether the currently selected value is displayed */
  showValue?: boolean;
  /** Whether the field is required (shows required indicator) */
  required?: boolean;
  /** Custom label for the required indicator */
  requiredLabel?: string;
  /**
   * Text announced in place of the numeric value while the element is unanswered, so assistive technology
   * can tell an untouched control apart from one genuinely answered with the minimum
   */
  unansweredLabel?: string;
  /** Error message to display */
  errorMessage?: string;
  /** Text direction */
  dir?: "ltr" | "rtl" | "auto";
  /** Whether the controls are disabled */
  disabled?: boolean;
  /** Image URL to display above the headline */
  imageUrl?: string;
  /** Video URL to display above the headline */
  videoUrl?: string;
}

/**
 * Single-thumb, continuous numeric element built on the Radix slider primitive, which supplies the
 * pointer interaction, the `role="slider"` semantics and the keyboard contract.
 *
 * An unanswered control parks its thumb at `min` while the response value stays `undefined`, and the
 * primitive reports a change only when the next value differs from the one it holds. The pointer and key
 * handlers below close that gap so a respondent can select the minimum directly, and they report each
 * finished interaction once through `onValueCommit`.
 *
 * Every emitted value is repositioned onto the grid of `step` anchored at `min`, because the primitive
 * clamps to `max` after rounding and would otherwise hand a respondent a value the shared response
 * validator rejects on a range whose span is not a whole number of steps.
 */
function Slider({
  elementId,
  headline,
  description,
  inputId,
  min,
  max,
  step,
  value,
  onChange,
  onValueCommit,
  lowerLabel,
  upperLabel,
  showValue = true,
  required = false,
  requiredLabel,
  unansweredLabel = DEFAULT_UNANSWERED_LABEL,
  errorMessage,
  dir = "auto",
  disabled = false,
  imageUrl,
  videoUrl,
}: Readonly<SliderProps>): React.JSX.Element {
  // Radix accepts only "ltr" | "rtl"; `undefined` lets it inherit the direction, defaulting to LTR.
  const sliderDir = dir === "auto" ? undefined : dir;

  // A missing or non-finite value means "unanswered" and is never coerced: neither NaN nor Infinity
  // resolves to a thumb position.
  const hasValue = typeof value === "number" && Number.isFinite(value);

  // Defence in depth for props this package cannot vouch for (an editor preview of a half-configured
  // element, or any direct consumer): the primitive derives its thumb offset and aria-valuemin/max/now
  // arithmetically, so a single non-finite bound would leave an inoperable control. For any schema-valid
  // element these are identity operations.
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) && max > safeMin ? max : safeMin + 1;
  const span = safeMax - safeMin;
  const safeStep = Number.isFinite(step) && step > 0 ? Math.min(step, span) : span;

  // Highest whole number of steps that still fits inside the range, and therefore the last selectable grid
  // point. A span that is not a whole multiple of the step - 0 to 100 by 40 - ends its grid at 80 rather
  // than at `max`, which is what the emitted value is capped at. The tolerance keeps a span that only misses
  // by floating-point noise, such as 0.3 by 0.1, reaching its true final point.
  const spanSteps = span / safeStep;
  const nearestSpanSteps = Math.round(spanSteps);
  const maxSteps =
    Math.abs(spanSteps - nearestSpanSteps) <= GRID_EPSILON * Math.max(1, nearestSpanSteps)
      ? nearestSpanSteps
      : Math.floor(spanSteps);

  // Decimal scale shared by the grid's origin and its step. A reconstructed grid point is rounded back to it
  // so three steps of 0.1 read 0.3 rather than 0.30000000000000004, exactly as the primitive rounds its own
  // arithmetic. `null` means at least one operand is exponential and has no fixed scale to round to.
  const minDecimals = decimalPlaces(safeMin);
  const stepDecimals = decimalPlaces(safeStep);
  const gridDecimals =
    minDecimals === null || stepDecimals === null
      ? null
      : Math.min(Math.max(minDecimals, stepDecimals), MAX_GRID_DECIMALS);

  // The grid point `steps` increments above the minimum, kept inside the configured bounds. Clamping is a
  // floating-point safeguard only: `steps` never exceeds `maxSteps`, so it can only trim representation
  // error, never a whole step.
  const gridPoint = (steps: number): number => {
    const raw = safeMin + steps * safeStep;
    const rounded = gridDecimals === null ? raw : Number.parseFloat(raw.toFixed(gridDecimals));
    return Math.min(Math.max(rounded, safeMin), safeMax);
  };

  /**
   * Repositions a value the primitive reported onto the grid the response contract requires.
   *
   * The primitive rounds a movement to the nearest step and then clamps the result into `[min, max]`, so a
   * range whose span is not a whole number of steps lets that clamp land between grid points: 0 to 100 by 40
   * reports 100 from the End key, from an arrow key past 80 and from a press at the far right, while the grid
   * is 0, 40 and 80. The shared validator rejects such an answer - `(100 - 0) / 40` is not an integer - so
   * the control must never emit it. A value already on the grid, which is every value a divisible
   * configuration produces, passes through untouched.
   */
  const normalizeToGrid = (candidate: number): number => {
    const steps = (candidate - safeMin) / safeStep;
    const nearestSteps = Math.round(steps);
    const isOnGrid = Math.abs(steps - nearestSteps) <= GRID_EPSILON * Math.max(1, Math.abs(nearestSteps));
    const boundedSteps = Math.min(Math.max(nearestSteps, 0), maxSteps);

    if (isOnGrid && boundedSteps === nearestSteps) {
      return candidate;
    }

    return gridPoint(boundedSteps);
  };

  // The value the interaction in progress has produced, or `null` while it has produced none. The primitive
  // reports a change only when the next value differs from the one it holds, and an unanswered control parks
  // its thumb at `min`, so a first press, a drag ending at the lower bound or a backward keystroke would all
  // be swallowed and the respondent could never select the minimum directly - most visibly on a range that
  // starts at `0`. Holding the value rather than a flag also lets the completion callback report what the
  // interaction settled on.
  const interactionValueRef = React.useRef<number | null>(null);

  // The primitive positions its thumb from a numeric array, so clamp a real answer into the configured
  // bounds and fall back to `min` when unanswered. The thumb fill below is what keeps that fallback
  // distinguishable from a slider genuinely answered with `min`.
  const trackValue = hasValue ? [Math.min(Math.max(value, safeMin), safeMax)] : [safeMin];

  // Records what the interaction settled on, then reports it. The response value is only rewritten when it
  // actually changes, because normalisation maps several reported positions onto the same grid point and
  // re-announcing one would churn the response for no change - the interaction is still marked as having
  // produced a value, so its completion is reported either way.
  const emitValue = (next: number): void => {
    interactionValueRef.current = next;

    if (hasValue && next === value) {
      return;
    }

    onChange(next);
  };

  // Radix emits an array; this single-thumb control consumes the first value. Short-circuit while disabled,
  // re-check the emitted value because the response contract is a single finite number, and reposition it
  // onto the step grid the shared validator enforces.
  const handleValueChange = (next: number[]): void => {
    if (disabled) {
      return;
    }

    const [selected] = next;
    if (typeof selected !== "number" || !Number.isFinite(selected)) {
      return;
    }

    emitValue(normalizeToGrid(selected));
  };

  // Composed ahead of the primitive's own handler, so every interaction starts
  // from a clean slate and only the press being released is ever inspected.
  const beginInteraction = (): void => {
    interactionValueRef.current = null;
  };

  // Recovers a swallowed selection: an interaction that ran to completion on an
  // unanswered control without producing a value is a request for the parked
  // minimum, so emit it explicitly. `min` is the grid's origin, so it needs no
  // normalisation. The recorded value is what keeps a reported interaction from
  // being emitted a second time, which is why the recovery is driven by what the
  // primitive did rather than by which key was pressed — that keeps it correct in
  // both text directions, where the primitive itself decides which arrow counts
  // as backward.
  const commitParkedMinimum = (): void => {
    if (disabled || hasValue || interactionValueRef.current !== null) {
      return;
    }
    emitValue(safeMin);
  };

  // Closes the interaction: recover the parked minimum if the primitive swallowed
  // it, then report completion once with the value the interaction settled on and
  // clear the slate. An interaction that produced nothing at all reports nothing,
  // so a press that resolves to the value already held is not counted.
  const finishInteraction = (): void => {
    if (disabled) {
      return;
    }

    commitParkedMinimum();

    const settledValue = interactionValueRef.current;
    interactionValueRef.current = null;

    if (settledValue !== null) {
      onValueCommit?.(settledValue);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (SLIDER_KEYS.includes(event.key)) {
      beginInteraction();
    }
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (SLIDER_KEYS.includes(event.key)) {
      finishInteraction();
    }
  };

  // Ids derived from `inputId` so every relationship below is stable across
  // renders and unique to this element.
  const errorId = `${inputId}-error`;
  const requiredId = `${inputId}-required`;
  const hasError = Boolean(errorMessage);

  // ARIA does not define `aria-required` for the `slider` role, so required-ness reaches the control as a
  // description instead. The ids are listed in reading order and only when their text is rendered, so the
  // control describes the required state, the error, or both.
  const descriptionIds: string[] = [];
  if (required) {
    descriptionIds.push(requiredId);
  }
  if (hasError) {
    descriptionIds.push(errorId);
  }
  const describedBy = descriptionIds.length > 0 ? descriptionIds.join(" ") : undefined;

  // Kept identical to the default `ElementHeader` applies, so the marker it renders and the description the
  // control points at always read the same.
  const resolvedRequiredLabel = requiredLabel ?? DEFAULT_REQUIRED_LABEL;

  return (
    <div className="w-full space-y-4" id={elementId} dir={dir}>
      {/* `htmlFor` is deliberately not passed: the primitive renders its root as a span, which is not a
          labelable element. The role-bearing thumb below carries its own accessible name. */}
      <ElementHeader
        headline={headline}
        description={description}
        required={required}
        requiredLabel={resolvedRequiredLabel}
        imageUrl={imageUrl}
        videoUrl={videoUrl}
      />

      {/* Slider body. `relative` anchors the absolutely positioned error bar
          that ElementError renders, so it must stay on this wrapper. */}
      <div className="relative">
        {/* Wrapped so the message has a stable id the control can point at. The
            wrapper stays unpositioned so the error bar keeps resolving against
            the `relative` ancestor above, and its child's bottom margin still
            collapses through it, leaving the spacing untouched. */}
        {hasError ? (
          <div id={errorId}>
            <ElementError errorMessage={errorMessage} dir={dir} />
          </div>
        ) : null}

        {/* Required state as an accessible description. The header already shows
            this marker visually; this copy exists so the role-bearing control can
            point at it, which is how a slider communicates required-ness - ARIA
            defines no `aria-required` for the role. */}
        {required ? (
          <span className="sr-only" id={requiredId}>
            {resolvedRequiredLabel}
          </span>
        ) : null}

        {/* Selected-value readout. `output` is the semantic element for a
            computed value and is announced as such by assistive technology. */}
        {showValue && hasValue ? (
          <output
            className="text-input-text font-input font-input-weight mb-2 block text-center"
            htmlFor={inputId}>
            {trackValue[0]}
          </output>
        ) : null}

        {/* The pointer and key handlers exist only to recover the selection the primitive suppresses at
            the parked minimum; they add no behaviour of their own and run before its own handlers. */}
        <SliderPrimitive.Root
          data-slot="slider"
          min={safeMin}
          max={safeMax}
          step={safeStep}
          value={trackValue}
          onValueChange={handleValueChange}
          onPointerDown={beginInteraction}
          onPointerUp={finishInteraction}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          disabled={disabled}
          dir={sliderDir}
          className={cn(
            "relative flex w-full touch-none select-none items-center",
            // A press on the track jumps the value, so the whole control is
            // pointer-interactive while enabled; the thumb narrows that to a grab
            // cursor below.
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          )}>
          <SliderPrimitive.Track
            data-slot="slider-track"
            className="bg-input-bg border-input-border rounded-input relative h-2 w-full grow overflow-hidden border">
            <SliderPrimitive.Range data-slot="slider-range" className="bg-brand absolute h-full" />
          </SliderPrimitive.Track>
          {/* The primitive puts `role="slider"` on the thumb, so the control's
              identity, name, value and state all belong here rather than on the
              role-less root: `id` so the readout resolves to the element that
              owns the value, `aria-label` for the accessible name, `aria-disabled`
              and `aria-invalid` for state, `aria-describedby` so the required state
              and the error are announced together with the value, and
              `aria-valuetext` so an unanswered control does not announce the
              minimum it parks on as if it were an answer. `aria-required` is
              deliberately absent, because ARIA does not define it for the `slider`
              role - the description above carries it instead. */}
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            id={inputId}
            aria-label={headline}
            aria-disabled={disabled}
            aria-invalid={hasError}
            aria-describedby={describedBy}
            aria-valuetext={hasValue ? undefined : unansweredLabel}
            className={cn(
              "border-brand focus-visible:ring-ring block h-5 w-5 rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
              hasValue ? "bg-brand" : "bg-input-bg",
              // The thumb is draggable, so it advertises that: a grab cursor at
              // rest, a closed hand while dragging, and a brand halo that widens
              // from hover to drag. Both halo widths use the same brand tint the
              // package already applies to a selected option, so no value is
              // hardcoded. The dimming stays on the root — a span never matches
              // the `:disabled` pseudo-class, and repeating the opacity here
              // would dim the thumb twice.
              disabled
                ? "cursor-not-allowed"
                : "hover:ring-brand-20 active:ring-brand-20 cursor-grab hover:ring-2 active:cursor-grabbing active:ring-4"
            )}
          />
        </SliderPrimitive.Root>

        {/* Endpoint labels. Either one can stand alone, so the upper label pushes itself into the end slot
            with a logical inline-start margin instead of relying on `justify-between` having a sibling;
            margin and alignment are both logical, so it stays at the maximum when the direction flips. */}
        {(lowerLabel ?? upperLabel) ? (
          <div className="mt-4 flex justify-between gap-8 px-1.5">
            {lowerLabel ? (
              <Label variant="default" className="max-w-[50%] text-xs leading-6" dir={dir}>
                {lowerLabel}
              </Label>
            ) : null}
            {upperLabel ? (
              <Label variant="default" className="ms-auto max-w-[50%] text-end text-xs leading-6" dir={dir}>
                {upperLabel}
              </Label>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { Slider };
export type { SliderProps };
