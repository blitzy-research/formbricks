import * as React from "react";
import { ElementError } from "@/components/general/element-error";
import { ElementHeader } from "@/components/general/element-header";
import { Label } from "@/components/general/label";
import { cn } from "@/lib/utils";

/**
 * Increments a page key, or a shifted arrow key, moves the value by. One step is the arrow-key increment,
 * so the larger jump is expressed as a multiple of it rather than as a share of the range: a respondent
 * paging through a grid always lands on a grid point, whatever the range happens to be.
 */
const SKIP_STEP_MULTIPLIER = 10;

/**
 * Relative slack allowed when deciding whether a value already sits on the step grid. Binary floating point
 * cannot hold most decimal steps exactly - `0.3 / 0.1` evaluates to 2.9999999999999996 - so grid membership
 * is decided against a tolerance rather than against zero, the same way the shared response validator does
 * before accepting an answer.
 */
const GRID_EPSILON = 1e-9;

/**
 * Ceiling on the decimal scale a reconstructed grid point may be rounded back to: `toFixed` states 0 to 100
 * places. A grid finer than that is left exactly as computed rather than rounded at a coarser scale, because
 * the rounding only tidies representation error and must never move a value off its own grid.
 */
const MAX_GRID_DECIMALS = 100;

// A finite double always prints as [-]digits[.digits][e(+|-)digits] - "0.2", "1e-7", "1.5e+21" - so these
// groups describe every bound and step this control can be handed. Only the fraction and the exponent are
// captured, because they are the two parts that decide how many decimal places the value needs.
const DECIMAL_NOTATION_PATTERN = /^-?\d+(?:\.(?<fraction>\d+))?(?:e(?<exponent>[+-]\d+))?$/i;

/**
 * Thumb diameter in pixels, matching the `h-5 w-5` utilities it is rendered with (1.25rem at the 16px root
 * font size). The thumb is positioned by its own leading edge, so its width is what keeps it inside the
 * track at both ends of the range instead of overhanging them.
 */
const THUMB_SIZE_PX = 20;

/** Fallback announcement for an unanswered control, mirroring how `ElementHeader` defaults its own label. */
const DEFAULT_UNANSWERED_LABEL = "No value selected";

/** Fallback required marker, kept identical to the default `ElementHeader` applies. */
const DEFAULT_REQUIRED_LABEL = "Required";

/**
 * Routes every subsequent event for `pointerId` to `element`, so a drag stays with the control once the
 * pointer leaves it. Pointer capture is treated as optional because a layout-less test renderer does not
 * implement it, and a drag that cannot be captured still works - it simply ends when the pointer leaves.
 */
const capturePointer = (element: HTMLElement | null, pointerId: number): void => {
  if (element && typeof element.setPointerCapture === "function") {
    element.setPointerCapture(pointerId);
  }
};

/** Hands `pointerId` back to the document, guarded the same way `capturePointer` is. */
const releasePointer = (element: HTMLElement | null, pointerId: number): void => {
  if (
    !element ||
    typeof element.hasPointerCapture !== "function" ||
    typeof element.releasePointerCapture !== "function"
  ) {
    return;
  }

  if (element.hasPointerCapture(pointerId)) {
    element.releasePointerCapture(pointerId);
  }
};

/**
 * Decimal places needed to state a number exactly, or `null` when it has no such decimal form.
 *
 * The count is taken from the shortest decimal string that round-trips back to the same double - the decimal
 * a survey author typed and a respondent sees, `0.2` rather than the binary fraction
 * 0.200000000000000011102230246251565... Exponential form is read rather than refused, because that is how
 * every small step prints: `String(1e-7)` is `"1e-7"`, which needs seven places and not none. A positive
 * exponent that outruns the fraction means the value is an integer, such as 1.5e+21, and needs no places.
 *
 * This measures the same scale the shared response validator measures, so the grid this control emits onto
 * is the grid that validator accepts. It is restated here rather than imported because this package
 * deliberately depends on no other workspace package.
 */
const decimalScale = (value: number): number | null => {
  if (!Number.isFinite(value)) {
    return null;
  }

  const match = DECIMAL_NOTATION_PATTERN.exec(String(value));
  if (!match) {
    return null;
  }

  const fraction = match.groups?.fraction ?? "";
  const exponent = match.groups?.exponent ?? "0";
  return Math.max(0, fraction.length - Number(exponent));
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
 * Single-thumb, continuous numeric element implementing the ARIA slider pattern directly: the thumb carries
 * `role="slider"` with the full `aria-value*` set, takes focus, and owns the keyboard contract, while the
 * root owns the pointer contract so a press anywhere on the track moves the value.
 *
 * The interaction is implemented here rather than delegated to a third-party primitive because the
 * respondent runtime (`packages/surveys`) builds this package with React aliased to `preact/compat`, and a
 * collection-based primitive cannot resolve its single thumb under that alias: Preact defers `useEffect`
 * while React flushes it before the re-render a ref callback schedules, so the thumb's index memo settles on
 * -1 and never recomputes. The result in the shipped bundle was a thumb rendered `display: none`, no
 * `aria-valuenow`, and arrow keys addressing a thumb that did not exist. Everything the primitive supplied -
 * pointer capture, key semantics, ARIA state, right-to-left inversion - is therefore supplied explicitly
 * below, which also makes each of those behaviours directly assertable in both runtimes.
 *
 * An unanswered control parks its thumb at `min` while the response value stays `undefined`, and the thumb
 * fill is what keeps that state distinguishable from a slider genuinely answered with `min`. Every value the
 * control emits is computed from the step grid anchored at `min`, so a respondent selecting the minimum -
 * with Home, with a backward key, or with a press at the low end of the track - selects it because the
 * arithmetic resolved there, never because an interaction was assumed to mean it.
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
  // The root is the element a track press is measured against, and the thumb is the element a press hands
  // focus to so the keyboard contract continues from wherever the pointer left off.
  const rootRef = React.useRef<HTMLSpanElement | null>(null);
  const thumbRef = React.useRef<HTMLSpanElement | null>(null);

  // The value the interaction in progress has produced, or `null` while it has produced none. Holding the
  // value rather than a flag is what lets the completion callback report what the interaction settled on.
  const interactionValueRef = React.useRef<number | null>(null);

  // Identifier of the pointer that opened the current drag. A slider is single-touch: a second finger
  // arriving mid-drag must not steer the value.
  const activePointerRef = React.useRef<number | null>(null);

  // A missing or non-finite value means "unanswered" and is never coerced: neither NaN nor Infinity
  // resolves to a thumb position.
  const hasValue = typeof value === "number" && Number.isFinite(value);

  // Defence in depth for props this package cannot vouch for (an editor preview of a half-configured
  // element, or any direct consumer): the thumb offset and the aria-valuemin/max/now attributes are derived
  // arithmetically, so a single non-finite bound would leave an inoperable control. For any schema-valid
  // element these are identity operations.
  const safeMin = Number.isFinite(min) ? min : 0;
  const orderedMax = Number.isFinite(max) && max > safeMin ? max : safeMin + 1;
  // A span that overflows to Infinity - bounds at opposite ends of the double range - would make every
  // position derived from it non-finite, so such a range collapses to a unit span rather than to a NaN
  // thumb offset.
  const safeMax = Number.isFinite(orderedMax - safeMin) ? orderedMax : safeMin + 1;
  const span = safeMax - safeMin;
  const safeStep = Number.isFinite(step) && step > 0 ? Math.min(step, span) : span;

  // Highest whole number of steps that still fits inside the range, and therefore the last selectable grid
  // point. A span that is not a whole multiple of the step - 0 to 100 by 40 - ends its grid at 80 rather
  // than at `max`. The tolerance keeps a span that only misses by floating-point noise, such as 0.3 by 0.1,
  // reaching its true final point.
  const spanSteps = span / safeStep;
  const nearestSpanSteps = Math.round(spanSteps);
  const wholeSpanSteps =
    Math.abs(spanSteps - nearestSpanSteps) <= GRID_EPSILON * Math.max(1, nearestSpanSteps)
      ? nearestSpanSteps
      : Math.floor(spanSteps);
  // At least one step, so the track is never degenerate, and never beyond the exactly representable
  // integers, so the arithmetic on these coordinates stays exact. A configuration whose step count is not
  // even finite degrades to a single step.
  const maxSteps = Number.isFinite(wholeSpanSteps)
    ? Math.min(Math.max(wholeSpanSteps, 1), Number.MAX_SAFE_INTEGER)
    : 1;

  // Decimal scale shared by the grid's origin and its step, which is the scale a grid point reconstructed
  // from a step position is stated at: three steps of 0.1 read 0.3 rather than 0.30000000000000004. `null`
  // means the scale is unknown or finer than `toFixed` can state, in which case the reconstruction stands as
  // computed rather than being rounded at a coarser scale that would move it off the grid.
  const minScale = decimalScale(safeMin);
  const stepScale = decimalScale(safeStep);
  const requiredScale = minScale === null || stepScale === null ? null : Math.max(minScale, stepScale);
  const gridDecimals = requiredScale === null || requiredScale > MAX_GRID_DECIMALS ? null : requiredScale;

  /** Whole number of steps, rounded to the nearest grid point and kept inside the selectable range. */
  const clampSteps = (steps: number): number => {
    if (!Number.isFinite(steps)) {
      return 0;
    }

    return Math.min(Math.max(Math.round(steps), 0), maxSteps);
  };

  /**
   * The grid point `steps` increments above the minimum, kept inside the configured bounds. Clamping is a
   * floating-point safeguard only: `steps` is already bounded by `clampSteps`, so it can only trim
   * representation error, never a whole step.
   */
  const gridPoint = (steps: number): number => {
    const raw = safeMin + steps * safeStep;
    const rounded = gridDecimals === null ? raw : Number.parseFloat(raw.toFixed(gridDecimals));
    return Math.min(Math.max(rounded, safeMin), safeMax);
  };

  // The value the thumb is drawn at and the value the control announces. An answer is clamped into the
  // configured bounds; an unanswered control parks at the minimum. The thumb fill below is what keeps that
  // fallback distinguishable from a slider genuinely answered with `min`.
  const displayValue = hasValue ? Math.min(Math.max(value, safeMin), safeMax) : safeMin;

  // Grid position the next keyboard step is measured from. Derived from the displayed value rather than
  // stored, so an off-grid value arriving from a prefill still steps onto the grid rather than off it.
  const currentSteps = clampSteps((displayValue - safeMin) / safeStep);

  // Share of the range the thumb sits at. Taken from the value itself, not from its grid position, so a
  // value between two grid points is still drawn where it actually is.
  const percent = Math.min(Math.max(((displayValue - safeMin) / span) * 100, 0), 100);

  /**
   * Resolved writing direction. An explicit `dir` prop is authoritative; `"auto"` is read back from the
   * rendered element, which is what the browser resolved for the content, and falls back to left-to-right
   * before the first paint or in an environment without layout.
   */
  const isRtl = (): boolean => {
    if (dir === "rtl") {
      return true;
    }
    if (dir === "ltr") {
      return false;
    }

    const root = rootRef.current;
    if (!root || typeof globalThis.getComputedStyle !== "function") {
      return false;
    }

    return globalThis.getComputedStyle(root).direction === "rtl";
  };

  /**
   * Records what the interaction produced, then reports it. A value equal to the one already held is not
   * re-announced: several reported positions map onto the same grid point, and rewriting the response with
   * the value it already holds would churn it for no change. Such an interaction is also left unrecorded, so
   * its completion is not billed either.
   */
  const emitValue = (next: number): void => {
    if (hasValue && next === displayValue) {
      return;
    }

    interactionValueRef.current = next;
    onChange(next);
  };

  /**
   * Closes the interaction: report completion once with the value it settled on, then clear the slate. An
   * interaction that produced no value reports nothing, so a press resolving to the value already held is
   * not counted.
   */
  const finishInteraction = (): void => {
    const settledValue = interactionValueRef.current;
    interactionValueRef.current = null;

    if (settledValue !== null) {
      onValueCommit?.(settledValue);
    }
  };

  /**
   * Grid position a key press asks for, or `null` for a key this control does not act on.
   *
   * The horizontal arrows follow the writing direction, because a respondent expects the thumb to move the
   * way the key points; the vertical arrows always mean more and less. Page keys, and a shifted arrow, move
   * by a multiple of the step so a long range stays traversable without holding a key down. Home and End
   * address the grid's ends rather than the raw bounds, so a span the step does not divide evenly still ends
   * on a value the shared response validator accepts.
   */
  const resolveKeySteps = (event: React.KeyboardEvent<HTMLSpanElement>): number | null => {
    const multiplier = event.shiftKey ? SKIP_STEP_MULTIPLIER : 1;
    const forward = isRtl() ? -multiplier : multiplier;

    switch (event.key) {
      case "ArrowUp":
        return currentSteps + multiplier;
      case "ArrowDown":
        return currentSteps - multiplier;
      case "ArrowRight":
        return currentSteps + forward;
      case "ArrowLeft":
        return currentSteps - forward;
      case "PageUp":
        return currentSteps + SKIP_STEP_MULTIPLIER;
      case "PageDown":
        return currentSteps - SKIP_STEP_MULTIPLIER;
      case "Home":
        return 0;
      case "End":
        return maxSteps;
      default:
        return null;
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (disabled) {
      return;
    }

    const requestedSteps = resolveKeySteps(event);
    if (requestedSteps === null) {
      return;
    }

    // The arrow, page and Home/End keys otherwise scroll the page while a respondent is adjusting the value.
    event.preventDefault();
    emitValue(gridPoint(clampSteps(requestedSteps)));
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (disabled || resolveKeySteps(event) === null) {
      return;
    }

    finishInteraction();
  };

  /**
   * Grid point a pointer at `clientX` selects, measured across the root - the full width the track spans.
   *
   * The distance is read from the leading edge, which flips with the writing direction, so a press lands on
   * the value it visually points at in both directions. An environment that reports no width - a layout-less
   * test renderer, or a control measured before its first paint - resolves to the grid's origin rather than
   * to a value derived from a division by zero.
   */
  const valueFromPointer = (clientX: number): number => {
    const rect = rootRef.current?.getBoundingClientRect();

    if (!rect || !Number.isFinite(rect.width) || rect.width <= 0 || !Number.isFinite(clientX)) {
      return gridPoint(0);
    }

    const distance = isRtl() ? rect.right - clientX : clientX - rect.left;
    const ratio = Math.min(Math.max(distance / rect.width, 0), 1);

    return gridPoint(clampSteps(ratio * spanSteps));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLSpanElement>): void => {
    if (disabled) {
      return;
    }

    activePointerRef.current = event.pointerId;

    // Keeping the drag with the root once it leaves the control is how a respondent expects to reach the
    // ends of the range.
    capturePointer(rootRef.current, event.pointerId);

    // A press anywhere on the control hands the keyboard the thumb, so a respondent can refine a pointer
    // selection with the arrow keys, exactly as a native range control behaves.
    thumbRef.current?.focus();

    // Suppresses the text selection and native drag a press on the track would otherwise start.
    event.preventDefault();

    emitValue(valueFromPointer(event.clientX));
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLSpanElement>): void => {
    if (disabled || activePointerRef.current !== event.pointerId) {
      return;
    }

    emitValue(valueFromPointer(event.clientX));
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLSpanElement>): void => {
    if (activePointerRef.current !== event.pointerId) {
      return;
    }

    activePointerRef.current = null;
    releasePointer(rootRef.current, event.pointerId);

    if (!disabled) {
      finishInteraction();
    }
  };

  // Ids derived from `inputId` so every relationship below is stable across renders and unique to this
  // element.
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

  // The thumb is placed by its leading edge rather than by its centre, which is what keeps it inside the
  // track at both ends: at the maximum its edge sits a full thumb width short of the end, at the minimum it
  // sits flush with the start. A logical inset carries that across both writing directions, so the fill and
  // the thumb invert together with no direction-specific arithmetic.
  const thumbInset = `calc(${percent.toString()}% - ${((percent / 100) * THUMB_SIZE_PX).toString()}px)`;

  // Share of the range the fill leaves empty, expressed from the trailing edge so the fill grows from the
  // start of the range whichever way the direction resolves.
  const rangeInsetEnd = `${(100 - percent).toString()}%`;

  return (
    <div className="w-full space-y-4" id={elementId} dir={dir}>
      {/* `htmlFor` is deliberately not passed: the control's role is carried by a span, which is not a
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
            {displayValue}
          </output>
        ) : null}

        {/* Interaction root: it spans the full width the track occupies, so it is
            both the surface a press is measured against and the element a drag is
            captured on. It carries no role of its own - the thumb below does. */}
        <span
          ref={rootRef}
          data-slot="slider"
          aria-disabled={disabled}
          dir={dir === "auto" ? undefined : dir}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          className={cn(
            "relative flex w-full touch-none select-none items-center",
            // A press on the track jumps the value, so the whole control is
            // pointer-interactive while enabled; the thumb narrows that to a grab
            // cursor below.
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          )}>
          <span
            data-slot="slider-track"
            className="bg-input-bg border-input-border rounded-input relative h-2 w-full grow overflow-hidden border">
            {/* Filled portion, ending at the selected value. Logical insets keep it
                growing from the start of the range in both writing directions. */}
            <span
              data-slot="slider-range"
              className="bg-brand absolute h-full"
              style={{ insetInlineStart: 0, insetInlineEnd: rangeInsetEnd }}
            />
          </span>
          {/* The thumb is the control: it carries `role="slider"`, so the element's
              identity, name, value and state all belong here rather than on the
              role-less root. `id` so the readout resolves to the element that owns
              the value, `aria-label` for the accessible name, `aria-disabled` and
              `aria-invalid` for state, `aria-describedby` so the required state and
              the error are announced together with the value, and `aria-valuetext`
              so an unanswered control does not announce the minimum it parks on as
              if it were an answer. `aria-required` is deliberately absent, because
              ARIA does not define it for the `slider` role - the description above
              carries it instead. It sits outside the track, whose overflow is
              clipped, and is vertically centred by the root's flex alignment. */}
          <span
            ref={thumbRef}
            data-slot="slider-thumb"
            id={inputId}
            role="slider"
            // A disabled control leaves the tab order but stays programmatically reachable, so assistive
            // technology can still discover and announce it alongside its `aria-disabled` state.
            tabIndex={disabled ? -1 : 0}
            aria-label={headline}
            aria-orientation="horizontal"
            aria-valuemin={safeMin}
            aria-valuemax={safeMax}
            aria-valuenow={displayValue}
            aria-valuetext={hasValue ? undefined : unansweredLabel}
            aria-disabled={disabled}
            aria-invalid={hasError}
            aria-describedby={describedBy}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            style={{ insetInlineStart: thumbInset }}
            className={cn(
              "border-brand focus-visible:ring-ring absolute block h-5 w-5 rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
              hasValue ? "bg-brand" : "bg-input-bg",
              // The thumb is draggable, so it advertises that: a grab cursor at
              // rest, a closed hand while dragging, and a brand halo that widens
              // from hover to drag. Both halo widths use the same brand tint the
              // package already applies to a selected option, so no value is
              // hardcoded. The dimming stays on the root — repeating the opacity
              // here would dim the thumb twice.
              disabled
                ? "cursor-not-allowed"
                : "hover:ring-brand-20 active:ring-brand-20 cursor-grab hover:ring-2 active:cursor-grabbing active:ring-4"
            )}
          />
        </span>

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
