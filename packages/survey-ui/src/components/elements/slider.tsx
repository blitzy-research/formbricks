import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";
import { ElementError } from "@/components/general/element-error";
import { ElementHeader } from "@/components/general/element-header";
import { Label } from "@/components/general/label";
import { cn } from "@/lib/utils";

/** Fallback required marker, kept identical to the default `ElementHeader` applies. */
const DEFAULT_REQUIRED_LABEL = "Required";

/**
 * Grid used when the configuration describes no usable one.
 *
 * The primitive divides by `step` to snap a position onto the grid, so a zero or non-finite step would
 * resolve every position to `Infinity` or `NaN`. The element schema already rejects such a configuration,
 * so this only keeps a draft an author is still typing operable, and it resolves to the same grid a range
 * control assumes when no step is declared.
 */
const FALLBACK_STEP = 1;

/**
 * The keys the primitive answers by moving the thumb, and therefore the only keys whose release can
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
 * Relative tolerance applied when counting grid steps.
 *
 * Dividing by a decimal step leaves binary-fraction noise in the count, so a count that is a whole number
 * arithmetically can come out a hair above or below one. The same order of magnitude the shared
 * `stepMultipleOf` response rule tolerates is allowed here, so the two agree on where a grid point is.
 */
const GRID_TOLERANCE = 1e-9;

/**
 * Decimal places a number needs, including the magnitudes JavaScript prints in exponential notation.
 */
const decimalPlaces = (input: number): number => {
  if (!Number.isFinite(input)) return 0;

  const [mantissa, exponent] = String(Math.abs(input)).split("e");
  const fraction = mantissa.split(".")[1] ?? "";
  if (!exponent) return fraction.length;

  return Math.max(fraction.length - Number(exponent), 0);
};

/** Rounds to a fixed number of decimals, which is what removes accumulated binary-fraction noise. */
const roundToScale = (input: number, scale: number): number =>
  Number(input.toFixed(Math.min(Math.max(scale, 0), 20)));

/**
 * Props for the Slider element component.
 *
 * This is a **presentational** component — it holds no response state, performs no validation and speaks
 * no survey vocabulary. The renderer layer (`packages/surveys`) owns the response value, resolves the
 * localized strings and supplies the already-translated `requiredLabel` and `errorMessage`, which is why
 * this component never calls a translation helper itself.
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
  /** Callback function called once an interaction settles on a value */
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
 * `min + n * step`, so the grid is anchored at `min` rather than at zero, and the control only ever reports
 * a value that sits on that grid. A value arriving from outside the range is drawn at the nearer bound but
 * reported back unchanged, leaving the survey's own validation to reject it.
 *
 * Value. The control is fully controlled and emits nothing on mount: `undefined` means unanswered, and an
 * unanswered control parks the handle at `min` with the handle left unfilled, so a slider nobody touched
 * stays distinguishable from one answered with `min`. `onChange` receives a plain number, and it is called
 * once per settled interaction - one drag, one key press, one press on the track - rather than for every
 * intermediate position a drag passes through.
 *
 * Accessibility. The handle exposes `role="slider"` with a live `aria-valuenow` / `aria-valuemin` /
 * `aria-valuemax`, and the control supports dragging, pressing anywhere on the track, the arrow keys,
 * Page Up / Page Down and Home / End. Required-ness is announced through `aria-describedby`, because ARIA
 * defines no required state for the slider role, and an error message is announced the same way alongside
 * `aria-invalid`.
 *
 * Appearance. Every part is token-driven - no colour, radius or font is hard-coded and no new `--fb-*`
 * variable is introduced - and each carries the `data-slot` attribute a consumer can target: `slider`,
 * `slider-track`, `slider-range` and `slider-thumb`. `dir` accepts `"ltr"`, `"rtl"` or `"auto"`, and the
 * track, the fill and the endpoint labels invert together.
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
  requiredLabel = DEFAULT_REQUIRED_LABEL,
  errorMessage,
  dir = "auto",
  disabled = false,
  imageUrl,
  videoUrl,
}: Readonly<SliderProps>): React.JSX.Element {
  // Implementation note - built on `@radix-ui/react-slider`, which owns dragging, pressing anywhere on
  // the track, the full key contract, `role="slider"` with the live `aria-value*` set, right-to-left
  // inversion and snapping to `min + n * step`. None of that is re-implemented here, and the composition
  // and `data-slot` attributes follow `progress.tsx`. Three details of the integration are not obvious:
  //
  // Live position versus committed answer. A drag reports a value for every movement, and each one that
  // reached the renderer would clone the block and survey response records and re-run the
  // time-to-completion bookkeeping. So the two are separated: `onValueChange` moves the thumb, the fill
  // and the readout locally, while `onChange` - the callback that writes the response - fires once per
  // interaction from `onValueCommit`. The caller's `value` remains the source of truth and is reconciled
  // back into the live position whenever it changes.
  //
  // Recovering the parked value. The primitive raises neither `onValueChange` nor `onValueCommit` when an
  // interaction resolves to the value already held, and an unanswered control parks its thumb at `min`, so
  // every interaction asking for the minimum - `Home`, a back-stepping arrow, or a press at the low end of
  // the track - would leave the answer unrecorded: a required slider could not be completed at all and an
  // optional one would silently drop the low end of its own range. `commitParkedValue` closes that gap,
  // and only while the control is still unanswered, because once an answer exists every real change
  // reaches `onValueCommit` on its own.
  //
  // Thumb resolution under `preact/compat`. The respondent runtime builds this package with React aliased
  // to `preact/compat`, and the primitive resolves which value its thumb owns by looking that thumb up in
  // a collection registered from a `useEffect`. Under the alias, the state update the thumb's own ref
  // callback performs re-renders in a microtask, before deferred effects run, so the memoised lookup
  // misses on the single pass that computes it, settles on -1 and never recomputes: the thumb renders
  // `display: none`, publishes no `aria-valuenow` and the keyboard addresses a thumb that is not there.
  // Replacing the thumb's DOM node once, after the collection has been registered, forces that lookup to
  // run again against a populated collection. `thumbGeneration` does exactly that, exactly once, and only
  // when the symptom is actually observed - so it is inert under a renderer that flushes effects before
  // re-rendering.
  const hasError = Boolean(errorMessage);
  const errorId = `${inputId}-error`;
  const requiredId = `${inputId}-required`;
  // ARIA defines no required state for the `slider` role, so required-ness is announced as a description
  // alongside the value instead.
  const describedBy =
    [required ? requiredId : null, hasError ? errorId : null].filter(Boolean).join(" ") || undefined;

  // A value that is not a finite number is not an answer, and is never coerced into one.
  const answeredValue = typeof value === "number" && Number.isFinite(value) ? value : undefined;

  // The position the control is currently showing. It leads the answer during an interaction and is
  // reconciled back to it whenever the caller's value changes - including after a commit, where the two
  // already agree and the assignment is a no-op.
  const [liveValue, setLiveValue] = React.useState<number | undefined>(answeredValue);
  const committedValueRef = React.useRef<number | undefined>(answeredValue);
  React.useEffect(() => {
    setLiveValue(answeredValue);
    committedValueRef.current = answeredValue;
  }, [answeredValue]);

  const hasValue = liveValue !== undefined;

  // The primitive positions its thumb from a numeric array, so an answer is clamped into the configured
  // bounds for display and an unanswered control falls back to `min`. A value outside the range is the one
  // thing the presentation cannot show faithfully - there is no track position for it - so it is drawn at
  // the nearer bound while the response value itself is left untouched for the shared evaluator to reject.
  const trackValue = [Math.min(Math.max(liveValue ?? min, min), max)];
  const safeStep = Number.isFinite(step) && step > 0 ? step : FALLBACK_STEP;

  // The primitive understands only "ltr" | "rtl", so "auto" becomes `undefined` and it resolves the
  // direction itself instead of being handed a value it cannot read. Callers keep the repository's
  // three-value contract, which is still applied to the wrapper, the labels and the error message.
  const sliderDir = dir === "auto" ? undefined : dir;

  // See "Thumb resolution under `preact/compat`" above.
  const thumbRef = React.useRef<HTMLSpanElement | null>(null);
  const [thumbGeneration, setThumbGeneration] = React.useState(0);
  React.useEffect(() => {
    if (thumbGeneration > 0) return;
    const thumb = thumbRef.current;
    // A resolved thumb always publishes its value, because this control always supplies one.
    if (thumb && !thumb.hasAttribute("aria-valuenow")) {
      setThumbGeneration(1);
    }
  }, [thumbGeneration]);

  // A release only expresses a selection if the press that preceded it began on this control: without
  // that record, a pointer press started elsewhere and merely finished over the control would answer the
  // question. A ref rather than state, because nothing about it is rendered.
  const pressBeganOnControl = React.useRef(false);

  /**
   * Holds a reported value to the grid the element actually declares.
   *
   * The primitive snaps to `min + n * step` and then rounds the result to the *step's* own decimal
   * precision, which is coarser than the grid whenever `min` carries more decimals than `step`: a range of
   * `10.5` to `20.5` in steps of `1` reports whole numbers, none of which is a point on its own grid, and
   * the shared `stepMultipleOf` response rule would reject every one of them. Rebuilding the value from
   * the grid's own origin removes that gap. A grid point needs no more decimals than the wider of its
   * origin and its step, so rounding to that scale is exact rather than lossy, and every ordinary
   * configuration comes back out of here as the number the primitive already reported.
   */
  const snapToGrid = (candidate: number): number => {
    if (!Number.isFinite(candidate) || !Number.isFinite(min) || !Number.isFinite(max)) return candidate;

    // Ties resolve downwards, which is what recovers the point the interaction asked for: the primitive
    // rounds a half-step away from the grid upwards. The tolerance keeps a ratio that only *looks* like a
    // tie, because of binary-fraction noise, on the side it belongs to.
    const stepRatio = (candidate - min) / safeStep;
    const wholeSteps = Math.ceil(stepRatio - 0.5 - GRID_TOLERANCE * Math.max(1, Math.abs(stepRatio)));
    // Held inside the range, because the upper bound itself need not be a point on the grid.
    const highestStep = Math.max(Math.floor((max - min) / safeStep + GRID_TOLERANCE), 0);
    const heldSteps = Math.min(Math.max(wholeSteps, 0), highestStep);

    return roundToScale(min + heldSteps * safeStep, Math.max(decimalPlaces(min), decimalPlaces(safeStep)));
  };

  /** Records an answer, at most once per distinct value, and never while disabled. */
  const commit = (next: number): void => {
    if (disabled || !Number.isFinite(next)) return;

    const answer = snapToGrid(next);
    if (committedValueRef.current === answer) return;

    committedValueRef.current = answer;
    onChange(answer);
  };

  /**
   * Records the value the thumb is parked on, for the one selection the primitive cannot report.
   *
   * Restricted to the unanswered control: an interaction that lands on the value already answered has
   * nothing to record, and every interaction that does change the value reaches `onValueCommit` itself.
   */
  const commitParkedValue = (): void => {
    if (committedValueRef.current !== undefined) return;

    commit(trackValue[0]);
  };

  /** Moves the presentation only. The answer is recorded when the interaction settles. */
  const handleValueChange = (next: number[]): void => {
    if (disabled) return;

    const [nextValue] = next;
    if (typeof nextValue !== "number" || !Number.isFinite(nextValue)) return;

    // Snapped here as well as on commit, so the thumb, the readout and the recorded answer are one value.
    setLiveValue(snapToGrid(nextValue));
  };

  /** The primitive's interaction-completion callback: one pointer drag or one key press. */
  const handleValueCommit = (next: number[]): void => {
    commit(next[0]);
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    // The release rather than the press: the primitive resolves the new value while handling `keydown`,
    // so this is the first point at which a key that resolved to the parked value can be answered.
    if (!VALUE_ADJUSTING_KEYS.has(event.key)) return;

    commitParkedValue();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLSpanElement>): void => {
    // Primary button only, matching the interaction the primitive itself acts on.
    pressBeganOnControl.current = event.button === 0;
  };

  const handlePointerUp = (): void => {
    if (!pressBeganOnControl.current) return;
    pressBeganOnControl.current = false;

    commitParkedValue();
  };

  const handlePointerCancel = (): void => {
    pressBeganOnControl.current = false;
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

      {/* Slider body. `relative` anchors the absolutely positioned error bar that ElementError renders, so
          it must stay on this wrapper. */}
      <div className="relative">
        {/* Wrapped so the message has a stable id the thumb can point at. The wrapper stays unpositioned
            so the error bar keeps resolving against the `relative` ancestor above, and its child's bottom
            margin still collapses through it, leaving the spacing untouched. */}
        {hasError ? (
          <div id={errorId}>
            <ElementError errorMessage={errorMessage} dir={dir} />
          </div>
        ) : null}

        {/* Required state as an accessible description. The header shows this marker visually, but it sits
            outside the label, so this copy is what the thumb itself can point at. */}
        {required ? (
          <span className="sr-only" id={requiredId}>
            {requiredLabel}
          </span>
        ) : null}

        {/* Selected-value readout. `output` is the semantic element for a computed value and is announced as
            such by assistive technology, and `htmlFor` ties it to the control that produced it. The figure is
            the value itself, never the clamped position the handle is drawn at, so a value arriving from
            outside the range stays visible to the respondent who has to correct it. */}
        {showValue && hasValue ? (
          <output
            className="text-input-text font-input font-input-weight mb-2 block text-center"
            htmlFor={inputId}>
            {liveValue}
          </output>
        ) : null}

        {/* `id` lives here so the header's and the readout's `htmlFor` both resolve to a real element.
            `aria-required` stays on the root rather than the thumb, because ARIA does not define it for
            the `slider` role. */}
        <SliderPrimitive.Root
          data-slot="slider"
          id={inputId}
          min={min}
          max={max}
          step={safeStep}
          value={trackValue}
          onValueChange={handleValueChange}
          onValueCommit={handleValueCommit}
          onKeyUp={handleKeyUp}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          disabled={disabled}
          dir={sliderDir}
          aria-required={required}
          className={cn(
            "relative flex w-full touch-none select-none items-center",
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          )}>
          <SliderPrimitive.Track
            data-slot="slider-track"
            className="bg-input-bg border-input-border rounded-input relative h-2 w-full grow overflow-hidden border">
            <SliderPrimitive.Range data-slot="slider-range" className="bg-brand absolute h-full" />
          </SliderPrimitive.Track>

          {/* The thumb carries `role="slider"`, the live value and the focus, so the accessible name and
              the descriptions belong here rather than on the root.

              `asChild` renders the element below in its place, which is what lets the node be replaced
              once when the primitive fails to resolve its thumb - see the component's note on
              `preact/compat`. The primitive merges its own props, styles and ref onto it. */}
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            aria-label={headline}
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            className={cn(
              "border-brand block h-5 w-5 rounded-full border-2 outline-none",
              "transition-[background-color,box-shadow]",
              // Fill is what tells an untouched control apart from one answered with the minimum.
              hasValue ? "bg-brand" : "bg-input-bg",
              // Half-opacity ring, as the checkbox and radio rings are, so that it still reads as a halo
              // once the handle itself is filled with the same brand colour.
              "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
              disabled ? "cursor-not-allowed" : "hover:ring-brand-20 cursor-grab hover:ring-2"
            )}
            asChild>
            <span key={thumbGeneration} ref={thumbRef} />
          </SliderPrimitive.Thumb>
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
