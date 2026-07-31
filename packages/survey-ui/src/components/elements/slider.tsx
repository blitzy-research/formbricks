import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";
import { ElementError } from "@/components/general/element-error";
import { ElementHeader } from "@/components/general/element-header";
import { Label } from "@/components/general/label";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Props interface
// ---------------------------------------------------------------------------

/**
 * Props for the Slider element component.
 *
 * This is a **presentational** component — it holds no state, performs no
 * validation and speaks no survey vocabulary. The renderer layer
 * (`packages/surveys/`) owns the response value, resolves the localized
 * strings and supplies the already-translated `requiredLabel` and
 * `errorMessage`, which is why this component never calls a translation
 * helper itself.
 */
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Presentational Slider element for the survey-ui design system.
 *
 * Renders a single-thumb, continuous numeric control built on the Radix slider
 * primitive, which supplies the pointer interaction, the `role="slider"`
 * semantics and the full keyboard contract (arrow keys move by one `step`,
 * Page keys jump, Home/End snap to the bounds) — none of that is
 * re-implemented here.
 *
 * Every colour, radius and font resolves to a design token the package already
 * exposes, so survey authors can theme the control through the same variables
 * that theme every other input. No new token is introduced.
 *
 * ### The unanswered state
 * The primitive hides its thumb whenever the bound value is `undefined`, so an
 * unanswered slider parks the thumb at `min` for positioning purposes while the
 * *response* value deliberately stays `undefined`. The thumb is filled with the
 * input background rather than the brand colour so the difference is visible:
 * a slider whose `min` is `0` would otherwise look identical whether it was
 * never touched or genuinely answered with `0`. Nothing is emitted on mount —
 * `onChange` fires only on real interaction — because downstream required-field
 * validation treats a numeric `0` as a real answer, and the summary view counts
 * untouched sliders as dismissed.
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
  // The primitive understands only "ltr" | "rtl", so "auto" becomes `undefined`
  // and it resolves the direction itself (from a surrounding direction provider
  // when the host supplies one, otherwise left-to-right) instead of being handed
  // a value it cannot read. Callers keep the repository's three-value contract,
  // which is still applied to the wrapper, the labels and the error message.
  const sliderDir = dir === "auto" ? undefined : dir;

  // A missing or non-numeric value means "unanswered" and is never coerced.
  const hasValue = typeof value === "number" && !Number.isNaN(value);

  // The primitive positions its thumb from a numeric array, so clamp a real
  // answer into the configured bounds and fall back to `min` when unanswered.
  const trackValue = hasValue ? [Math.min(Math.max(value, min), max)] : [min];

  // Single-thumb control, so the first array entry is the answer. Short-circuit
  // while disabled so a stray pointer or key event cannot mutate the response.
  const handleValueChange = (next: number[]): void => {
    if (!disabled) {
      onChange(next[0]);
    }
  };

  return (
    <div className="w-full space-y-4" id={elementId} dir={dir}>
      {/* Headline, description, required marker and optional media */}
      <ElementHeader
        headline={headline}
        description={description}
        required={required}
        requiredLabel={requiredLabel}
        htmlFor={inputId}
        imageUrl={imageUrl}
        videoUrl={videoUrl}
      />

      {/* Slider body. `relative` anchors the absolutely positioned error bar
          that ElementError renders, so it must stay on this wrapper. */}
      <div className="relative">
        <ElementError errorMessage={errorMessage} dir={dir} />

        {/* Selected-value readout. `output` is the semantic element for a
            computed value and is announced as such by assistive technology. */}
        {showValue && hasValue ? (
          <output
            className="text-input-text font-input font-input-weight mb-2 block text-center"
            htmlFor={inputId}>
            {trackValue[0]}
          </output>
        ) : null}

        {/* `id` lives here so the header's and the readout's `htmlFor` both resolve
            to a real element. `aria-label` is repeated on the thumb below because
            the primitive puts `role="slider"` there; `aria-required` is not carried
            over, because ARIA does not define it for the `slider` role. */}
        <SliderPrimitive.Root
          data-slot="slider"
          id={inputId}
          min={min}
          max={max}
          step={step}
          value={trackValue}
          onValueChange={handleValueChange}
          disabled={disabled}
          dir={sliderDir}
          aria-label={headline}
          aria-required={required}
          className={cn(
            "relative flex w-full touch-none select-none items-center",
            disabled && "cursor-not-allowed opacity-50"
          )}>
          <SliderPrimitive.Track
            data-slot="slider-track"
            className="bg-input-bg border-input-border rounded-input relative h-2 w-full grow overflow-hidden border">
            <SliderPrimitive.Range data-slot="slider-range" className="bg-brand absolute h-full" />
          </SliderPrimitive.Track>
          {/* The primitive puts `role="slider"` on the thumb and reads the
              accessible name from the thumb's own `aria-label`, so the headline
              is repeated here — without it the control would announce as the
              generic fallback name. */}
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            aria-label={headline}
            className={cn(
              "border-brand focus-visible:ring-ring block h-5 w-5 rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
              hasValue ? "bg-brand" : "bg-input-bg"
            )}
          />
        </SliderPrimitive.Root>

        {/* Labels */}
        {(lowerLabel ?? upperLabel) ? (
          <div className="mt-4 flex justify-between gap-8 px-1.5">
            {lowerLabel ? (
              <Label variant="default" className="max-w-[50%] text-xs leading-6" dir={dir}>
                {lowerLabel}
              </Label>
            ) : null}
            {upperLabel ? (
              <Label variant="default" className="max-w-[50%] text-right text-xs leading-6" dir={dir}>
                {upperLabel}
              </Label>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { Slider };
export type { SliderProps };
