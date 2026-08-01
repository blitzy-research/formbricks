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
 * handlers below close that gap so a respondent can select the minimum directly.
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
  lowerLabel,
  upperLabel,
  showValue = true,
  required = false,
  requiredLabel,
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

  // Whether the interaction in progress has already produced a value. The primitive reports a change only
  // when the next value differs from the one it holds, and an unanswered control parks its thumb at `min`,
  // so a first press, a drag ending at the lower bound or a backward keystroke would all be swallowed and
  // the respondent could never select the minimum directly - most visibly on a range that starts at `0`.
  const hasEmittedRef = React.useRef(false);

  // The primitive positions its thumb from a numeric array, so clamp a real answer into the configured
  // bounds and fall back to `min` when unanswered. The thumb fill below is what keeps that fallback
  // distinguishable from a slider genuinely answered with `min`.
  const trackValue = hasValue ? [Math.min(Math.max(value, safeMin), safeMax)] : [safeMin];

  // Radix emits an array; this single-thumb control consumes the first value. Short-circuit while disabled,
  // and re-check the emitted value because the response contract is a single finite number.
  const handleValueChange = (next: number[]): void => {
    if (disabled) {
      return;
    }

    const [selected] = next;
    if (typeof selected !== "number" || !Number.isFinite(selected)) {
      return;
    }

    hasEmittedRef.current = true;
    onChange(selected);
  };

  // Composed ahead of the primitive's own handler, so every interaction starts
  // from a clean flag and only the press being released is ever inspected.
  const beginInteraction = (): void => {
    hasEmittedRef.current = false;
  };

  // Recovers a swallowed selection: an interaction that ran to completion on an
  // unanswered control without producing a value is a request for the parked
  // minimum, so emit it explicitly. The flag is what keeps a reported
  // interaction from being emitted a second time, which is why the recovery is
  // driven by what the primitive did rather than by which key was pressed — that
  // keeps it correct in both text directions, where the primitive itself decides
  // which arrow counts as backward.
  const commitParkedMinimum = (): void => {
    if (disabled || hasValue || hasEmittedRef.current) {
      return;
    }
    hasEmittedRef.current = true;
    onChange(safeMin);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (SLIDER_KEYS.includes(event.key)) {
      beginInteraction();
    }
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (SLIDER_KEYS.includes(event.key)) {
      commitParkedMinimum();
    }
  };

  // Ids derived from `inputId` so every relationship below is stable across
  // renders and unique to this element.
  const errorId = `${inputId}-error`;
  const hasError = Boolean(errorMessage);

  return (
    <div className="w-full space-y-4" id={elementId} dir={dir}>
      {/* `htmlFor` is deliberately not passed: the primitive renders its root as a span, which is not a
          labelable element. The role-bearing thumb below carries its own accessible name. */}
      <ElementHeader
        headline={headline}
        description={description}
        required={required}
        requiredLabel={requiredLabel}
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
          onPointerUp={commitParkedMinimum}
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
              identity, name and state all belong here rather than on the
              role-less root: `id` so the readout resolves to the element that
              owns the value, `aria-label` for the accessible name, `aria-disabled`
              and `aria-invalid` for state, and `aria-describedby` so the error is
              announced together with the value. `aria-required` is deliberately
              absent, because ARIA does not define it for the `slider` role; the
              required marker the header renders carries that instead. */}
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            id={inputId}
            aria-label={headline}
            aria-disabled={disabled}
            aria-invalid={hasError}
            aria-describedby={hasError ? errorId : undefined}
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
