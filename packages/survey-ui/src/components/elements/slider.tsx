import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";
import { ElementError } from "@/components/general/element-error";
import { ElementHeader } from "@/components/general/element-header";
import { Label } from "@/components/general/label";
import { cn } from "@/lib/utils";

/**
 * Grid used when the configuration describes no usable one.
 *
 * The primitive divides by `step` to snap a position onto the grid, so a zero or non-finite step would
 * resolve every position to `Infinity` or `NaN`. The element schema rejects such a configuration, so this
 * only keeps a draft an author is still typing operable, and it resolves to the same grid a range control
 * assumes when no step is declared.
 */
const FALLBACK_STEP = 1;

/** Widest decimal scale this component normalizes a reconstructed value at. */
const MAX_DECIMAL_PLACES = 20;

/**
 * The keys the primitive answers by moving the handle, and therefore the only keys whose release can
 * express a selection.
 *
 * `Enter` and `Space` are deliberately absent. `Enter` submits the surrounding form, so treating it as a
 * selection would silently answer an untouched required slider with its minimum and defeat the required
 * check the response contract depends on.
 */
const VALUE_ADJUSTING_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

/**
 * Decimal places a number needs, including the magnitudes JavaScript prints in exponential notation.
 *
 * `String(1e-7)` is `"1e-7"`, which carries no decimal point even though the value needs seven places, so
 * reading the fraction alone would understate every such number.
 */
const decimalPlaces = (input: number): number => {
  if (!Number.isFinite(input)) return 0;

  const [mantissa, exponent] = String(Math.abs(input)).split("e");
  const fraction = mantissa.split(".")[1] ?? "";
  if (!exponent) return fraction.length;

  return Math.max(fraction.length - Number(exponent), 0);
};

/**
 * Props for the Slider element component.
 *
 * This is a **presentational** component - it holds no response state, performs no validation and speaks no
 * survey vocabulary. The renderer layer (`packages/surveys`) owns the response value, resolves the localized
 * strings and supplies the already-translated `requiredLabel` and `errorMessage`, which is why this
 * component never calls a translation helper itself.
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
  /** Minimum selectable value (the lower bound of the configured range). Must be less than `max` */
  min: number;
  /** Maximum selectable value (the upper bound of the configured range). Must be greater than `min` */
  max: number;
  /**
   * Increment between selectable values, measured from `min`, so the selectable values are `min + n * step`.
   * Must be greater than `0`, and no wider than `max - min`
   */
  step: number;
  /** Currently selected value; `undefined` means unanswered */
  value?: number;
  /** Callback function called when the value changes */
  onChange: (value: number) => void;
  /** Optional label for the lower end of the scale */
  lowerLabel?: string;
  /** Optional label for the upper end of the scale */
  upperLabel?: string;
  /** Whether the currently selected value is displayed. Defaults to `true` */
  showValue?: boolean;
  /** Whether the field is required (shows required indicator). Defaults to `false` */
  required?: boolean;
  /** Custom label for the required indicator. Defaults to `"Required"` */
  requiredLabel?: string;
  /** Error message to display */
  errorMessage?: string;
  /** Text direction. Defaults to `"auto"`, which inherits the direction from the surrounding document */
  dir?: "ltr" | "rtl" | "auto";
  /** Whether the controls are disabled. Defaults to `false` */
  disabled?: boolean;
  /** Image URL to display above the headline */
  imageUrl?: string;
  /** Video URL to display above the headline */
  videoUrl?: string;
}

/**
 * Single-value numeric element: the respondent picks one number on a continuous scale.
 *
 * Configuration. `min` must be less than `max`, and `step` must be greater than `0` and no wider than
 * `max - min`; the survey schema rejects a configuration that breaks either rule. The selectable values are
 * `min + n * step`, so the grid is anchored at `min` rather than at zero. A value arriving from outside the
 * range is drawn at the nearer bound but reported back unchanged, leaving the survey's own validation to
 * reject it.
 *
 * Value. The control is fully controlled and emits nothing on mount: `undefined` means unanswered, and an
 * unanswered control parks the handle at `min` with the handle left unfilled, so a slider nobody touched
 * stays distinguishable from one answered with `min`. `onChange` receives a plain number.
 *
 * Accessibility. The primitive supplies `role="slider"`, the live value semantics and the full key contract -
 * arrow keys step by one increment, Page keys jump, Home and End move to the bounds - and the handle is
 * named from the headline and carries the required state, the role being on the handle rather than on the
 * root. The value readout is an `output` bound to the control.
 *
 * Appearance. Every part is token-driven - colour, radius and font come from the existing design tokens
 * rather than from hard-coded values - and each carries a stable slot attribute a consumer can target:
 * `slider`, `slider-track`, `slider-range` and `slider-thumb`. `dir` accepts `"ltr"`, `"rtl"` or `"auto"`,
 * and the track, the fill and the endpoint labels invert together.
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
  // A value that is not a finite number is not an answer, and is never coerced into one.
  const hasValue = typeof value === "number" && Number.isFinite(value);
  const safeStep = Number.isFinite(step) && step > 0 ? step : FALLBACK_STEP;

  // The primitive understands only "ltr" | "rtl", so "auto" becomes `undefined` and it resolves the
  // direction itself instead of being handed a value it cannot read. Callers keep the repository's
  // three-value contract, which is still applied to the wrapper, the labels and the error message.
  const sliderDir = dir === "auto" ? undefined : dir;

  // OFFSET SPACE. The primitive is driven from zero - `0 .. max - min` - rather than from `min`, and the
  // offset is converted back to the element's own number once, on the way out. The reason is the primitive's
  // snapping: it rounds the value it settles on to the decimal places of the STEP's printed form, so an
  // origin carrying more decimals than its step - `10.5` in steps of `1` - is rounded to whole numbers, none
  // of which is a point of that element's own grid, and the shared step-grid rule would then reject every
  // answer the control invited. Anchored at zero the snapped value is always `n * step`, which never needs
  // more decimals than `step` itself, so the rounding is exact for every configuration the schema admits.
  const span = Number.isFinite(max - min) && max > min ? max - min : safeStep;
  const displayedValue = hasValue ? Math.min(Math.max(value, min), max) : min;
  const offsetValue = displayedValue - min;

  /** The element's own number for a position the primitive reports, restated to clear arithmetic noise. */
  const toElementValue = (offset: number): number => {
    const reconstructed = min + offset;
    if (!Number.isFinite(reconstructed)) return Number.NaN;

    // A grid point needs no more decimals than the wider of the origin and the step, so restating the sum at
    // that scale removes what the addition leaves behind without moving the value: `0.05 + 0.1` arrives as
    // `0.15000000000000002` and leaves here as `0.15`. A scale beyond the normalization cap is returned
    // unchanged, so its precision is neither expanded nor truncated.
    const scale = Math.max(decimalPlaces(min), decimalPlaces(safeStep));
    if (scale > MAX_DECIMAL_PLACES) return reconstructed;

    const restated = Number(reconstructed.toFixed(scale));
    return Number.isFinite(restated) ? restated : reconstructed;
  };

  /**
   * Handle visibility under `preact/compat`.
   *
   * The respondent runtime builds this package with React aliased to `preact/compat`, and the primitive
   * resolves which value its handle owns by looking that handle up in a collection registered from a
   * deferred effect. Under the alias the state update the handle's own ref callback performs re-renders in a
   * microtask, before deferred effects run, so the memoised lookup misses, settles on -1 and never
   * recomputes: the primitive then hides the handle with `display: none` and the arrow keys address a handle
   * that is not there. Replacing the handle's DOM node once, after the collection has been registered, forces
   * that lookup to run again against a populated collection - which is all this does, exactly once, and only
   * when the symptom is actually observed, so it is inert under a renderer that flushes effects before
   * re-rendering.
   */
  const thumbRef = React.useRef<HTMLSpanElement | null>(null);
  const [thumbGeneration, setThumbGeneration] = React.useState(0);
  React.useEffect(() => {
    if (thumbGeneration > 0) return;
    if (thumbRef.current?.style.display === "none") {
      setThumbGeneration(1);
    }
  }, [thumbGeneration]);

  /**
   * Whether the primitive reported a value during the interaction in progress.
   *
   * A ref rather than state, because nothing about it is rendered, and it must be readable synchronously
   * within a single interaction rather than after the next render.
   */
  const reportedDuringInteraction = React.useRef(false);

  const handleValueChange = (next: number[]): void => {
    if (disabled) return;

    const [nextOffset] = next;
    if (typeof nextOffset !== "number") return;

    const nextValue = toElementValue(nextOffset);
    if (Number.isFinite(nextValue)) {
      reportedDuringInteraction.current = true;
      onChange(nextValue);
    }
  };

  const beginInteraction = (): void => {
    reportedDuringInteraction.current = false;
  };

  /**
   * Records the value the handle is parked on, for the one selection the primitive never reports.
   *
   * The primitive raises no change when an interaction resolves to the position the handle already holds,
   * which is every interaction asking for the minimum of an unanswered slider: `Home`, a back-stepping arrow
   * and a press at the low end of the track would all leave the answer unrecorded, so a required slider
   * could not be completed at its own minimum. Only an interaction that reported nothing, on a control that
   * is still unanswered, is completed this way - so an interaction that did report cannot have its answer
   * overwritten by the position the handle happened to start from.
   */
  const endInteraction = (): void => {
    if (disabled || hasValue || reportedDuringInteraction.current) return;

    const parkedValue = toElementValue(offsetValue);
    if (Number.isFinite(parkedValue)) {
      onChange(parkedValue);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (VALUE_ADJUSTING_KEYS.has(event.key)) {
      beginInteraction();
    }
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (VALUE_ADJUSTING_KEYS.has(event.key)) {
      endInteraction();
    }
  };

  return (
    <div className="w-full space-y-4" id={elementId} dir={dir}>
      <ElementHeader
        headline={headline}
        description={description}
        required={required}
        requiredLabel={requiredLabel}
        htmlFor={inputId}
        imageUrl={imageUrl}
        videoUrl={videoUrl}
      />

      {/* Slider body. `relative` anchors the absolutely positioned indicator bar that ElementError renders,
          so it must stay on this wrapper with the error as its first child. */}
      <div className="relative">
        <ElementError errorMessage={errorMessage} dir={dir} />

        {/* Selected-value readout. `output` is the semantic element for a computed value and is announced as
            such by assistive technology, and `htmlFor` ties it to the control that produced it. The figure is
            the value itself, never the clamped position the handle is drawn at, so a value arriving from
            outside the range stays visible to the respondent who has to correct it. */}
        {showValue && hasValue ? (
          <output
            className="text-input-text font-input font-input-weight mb-2 block text-center"
            htmlFor={inputId}>
            {value}
          </output>
        ) : null}

        {/* Driven in offset space - see the note above. `id` lives here so the readout's `htmlFor` resolves
            to a real element; `output`'s `for` may reference elements a label could not. */}
        <SliderPrimitive.Root
          data-slot="slider"
          id={inputId}
          aria-label={headline}
          min={0}
          max={span}
          step={safeStep}
          value={[offsetValue]}
          onValueChange={handleValueChange}
          onPointerDown={beginInteraction}
          onPointerUp={endInteraction}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          disabled={disabled}
          dir={sliderDir}
          className={cn(
            "relative flex w-full touch-none select-none items-center",
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          )}>
          <SliderPrimitive.Track
            data-slot="slider-track"
            className="bg-input-bg border-input-border rounded-input relative h-2 w-full grow overflow-hidden border">
            <SliderPrimitive.Range data-slot="slider-range" className="bg-brand absolute h-full" />
          </SliderPrimitive.Track>

          {/* The handle carries `role="slider"`, the live value and the focus. Its `aria-value*` set is
              supplied here rather than left to the primitive, which would publish the offset it is driven
              with instead of the number the respondent is choosing. `aria-required` belongs here for the
              same reason the role does: the primitive's root is a roleless element, where assistive
              technology has no widget to attach the state to.

              While the control is unanswered the handle publishes the minimum as its current value, because
              the slider role requires one - the unfilled handle is the visual signal that nothing has been
              chosen yet. Announcing that state instead would take a translated string, which this
              presentational component takes no part in resolving.

              `asChild` renders the element below in its place, which is what lets the node be replaced once
              when the primitive fails to resolve its handle - see the note above. The primitive merges its
              own props, styles and ref onto it. */}
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            aria-label={headline}
            aria-required={required}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={displayedValue}
            className={cn(
              "border-brand block h-5 w-5 rounded-full border-2 outline-none",
              "transition-colors",
              // Fill is what tells an untouched control apart from one answered with the minimum.
              hasValue ? "bg-brand" : "bg-input-bg",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
              disabled ? "cursor-not-allowed" : "cursor-grab"
            )}
            asChild>
            <span key={thumbGeneration} ref={thumbRef} />
          </SliderPrimitive.Thumb>
        </SliderPrimitive.Root>

        {/* Endpoint labels, laid out exactly as the OpinionScale label row is so the two controls align */}
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

export { Slider };
export type { SliderProps };
