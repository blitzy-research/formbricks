import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";
import { ElementError } from "@/components/general/element-error";
import { ElementHeader } from "@/components/general/element-header";
import { Label } from "@/components/general/label";
import { cn } from "@/lib/utils";
import { getTickCount, tickToValue, valueToTick } from "./slider-grid";

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
 * Reduces a headline or description to the text an accessible name may be built from.
 *
 * Either string may carry the markup a rich-text editor produced, and markup in an accessible name is read
 * out verbatim by a screen reader. Parsing is skipped entirely when there is no tag to remove, and a parse
 * that yields nothing falls back to the original string rather than to an empty name.
 */
const toPlainText = (input: string): string => {
  if (!input.includes("<")) return input;

  try {
    const parsed = new DOMParser().parseFromString(input, "text/html").body.textContent;
    return parsed && parsed.trim() !== "" ? parsed : input;
  } catch {
    return input;
  }
};

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
 * `aria-valuemax` / `aria-valuetext` in the element's own numbers, and the control supports dragging,
 * pressing anywhere on the track, the arrow keys, Page Up / Page Down and Home / End. The handle is named
 * from the headline and described by the description, both as text rather than as the markup a rich editor
 * may have produced. Required-ness is announced through `aria-describedby`, because ARIA defines no required
 * state for the slider role, and an error message is announced the same way alongside `aria-invalid`.
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
  // the track, the full key contract, `role="slider"` with the live `aria-value*` set and right-to-left
  // inversion. None of that is re-implemented here, and the composition and `data-slot` attributes follow
  // `progress.tsx`. Four details of the integration are not obvious:
  //
  // Tick space. The primitive is driven with whole tick indices - `0 .. tickCount`, step `1` - rather than
  // with the element's own numbers, and `slider-grid.ts` converts a tick to a number once, on the way out.
  // That module carries the reasoning; what matters here is the consequence: the primitive's snapping and
  // rounding are exact integer arithmetic, so no configuration the element schema admits can produce a
  // value off the grid, and the control needs no correction pass of its own. Because the primitive then
  // reports ticks, the `aria-value*` set it publishes is replaced below with the real numeric domain.
  //
  // Live position versus committed answer. A drag reports a value for every movement, and each one that
  // reached the renderer would clone the block and survey response records and re-run the
  // time-to-completion bookkeeping. So the two are separated: `onValueChange` moves the thumb, the fill
  // and the readout locally, while `onChange` - the callback that writes the response - fires once per
  // interaction from `onValueCommit`. The caller's `value` remains the source of truth and is reconciled
  // back into the live position whenever it changes.
  //
  // Recovering the value on show. The primitive raises neither `onValueChange` nor `onValueCommit` when an
  // interaction resolves to the tick already held, so an interaction asking for the position the handle is
  // already on goes unreported. That covers two cases the respondent has to be able to express. An
  // unanswered control parks its handle at `min`, so `Home`, a back-stepping arrow or a press at the low end
  // of the track would leave the answer unrecorded - a required slider could not be completed at all, and an
  // optional one would silently drop the low end of its own range. And a stored value the presentation could
  // not show faithfully is held at the nearest point it can, so pressing that point - the obvious way to
  // accept what is on screen - would leave the unshowable value in place. `commitDisplayedValue` closes
  // both: it records what the handle is showing, and `commit` ignores it when that is already the answer.
  //
  // Thumb resolution under `preact/compat`. The respondent runtime builds this package with React aliased
  // to `preact/compat`, and the primitive resolves which value its thumb owns by looking that thumb up in
  // a collection registered from a `useEffect`. Under the alias, the state update the thumb's own ref
  // callback performs re-renders in a microtask, before deferred effects run, so the memoised lookup
  // misses on the single pass that computes it, settles on -1 and never recomputes: the primitive finds no
  // value for the thumb, hides it with `display: none`, and the keyboard addresses a thumb that is not
  // there. Replacing the thumb's DOM node once, after the collection has been registered, forces that
  // lookup to run again against a populated collection. `thumbGeneration` does exactly that, exactly once,
  // and only when the symptom is actually observed - so it is inert under a renderer that flushes effects
  // before re-rendering.
  const hasError = Boolean(errorMessage);
  const errorId = `${inputId}-error`;
  const requiredId = `${inputId}-required`;
  const labelId = `${inputId}-label`;
  const descriptionId = `${inputId}-description`;

  // The thumb carries `role="slider"`, so it is the element whose name and description assistive technology
  // reads. The header's own label cannot supply either: it is rendered for a `span`, which is not a
  // labelable element, so the association has no effect. Text-only copies of the headline and the
  // description are rendered instead, and referenced from the thumb by id.
  const accessibleName = toPlainText(headline);
  const accessibleDescription = description ? toPlainText(description) : undefined;
  // ARIA defines no required state for the `slider` role, so required-ness is announced as a description
  // alongside the value instead, in reading order: what the question asks, then that it must be answered,
  // then what is wrong with the current answer.
  const describedBy =
    [accessibleDescription ? descriptionId : null, required ? requiredId : null, hasError ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

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

  const safeStep = Number.isFinite(step) && step > 0 ? step : FALLBACK_STEP;
  // The grid the configuration describes, as a count of whole steps. Zero means it describes none, which
  // only a draft an author is still typing can produce; the primitive still renders one usable handle.
  const tickCount = getTickCount(min, max, safeStep);

  // Where the handle sits, as a tick. An unanswered control parks it at the grid's origin. A value outside
  // the range - or off the grid - is the one thing the presentation cannot show faithfully, since there is
  // no track position for it, so the handle is drawn at the nearest point while the response value itself is
  // left untouched for the shared evaluator to judge.
  const displayedTick = hasValue ? valueToTick(liveValue, min, safeStep, tickCount) : 0;
  // The number that tick addresses, which is what an interaction resolving to the current position records.
  const displayedValue = tickToValue(displayedTick, min, safeStep);

  // The primitive understands only "ltr" | "rtl", so "auto" becomes `undefined` and it resolves the
  // direction itself instead of being handed a value it cannot read. Callers keep the repository's
  // three-value contract, which is still applied to the wrapper, the labels and the error message.
  const sliderDir = dir === "auto" ? undefined : dir;

  // See "Thumb resolution under `preact/compat`" above. The symptom is read from the style the primitive
  // applies when it cannot match the thumb to a value, rather than from the value it publishes, because the
  // `aria-value*` set below is supplied by this component and is therefore present either way.
  const thumbRef = React.useRef<HTMLSpanElement | null>(null);
  const [thumbGeneration, setThumbGeneration] = React.useState(0);
  React.useEffect(() => {
    if (thumbGeneration > 0) return;
    const thumb = thumbRef.current;
    if (thumb?.style.display === "none") {
      setThumbGeneration(1);
    }
  }, [thumbGeneration]);

  // A release only expresses a selection if the press that preceded it began on this control: without
  // that record, a pointer press started elsewhere and merely finished over the control would answer the
  // question. A ref rather than state, because nothing about it is rendered.
  const pressBeganOnControl = React.useRef(false);

  /** The number a tick reported by the primitive addresses. */
  const valueOfTick = (tick: number): number => tickToValue(tick, min, safeStep);

  /** Records an answer, at most once per distinct value, and never while disabled. */
  const commit = (next: number): void => {
    // A reconstruction that is not a finite number is not an answer and is never emitted; the grid module
    // returns `NaN` rather than an approximation when the arithmetic leaves the double range.
    if (disabled || !Number.isFinite(next)) return;
    if (committedValueRef.current === next) return;

    committedValueRef.current = next;
    onChange(next);
  };

  /**
   * Records the value the handle is showing, for the selections the primitive does not report.
   *
   * The primitive raises neither `onValueChange` nor `onValueCommit` when an interaction resolves to the
   * tick it already holds, which is every interaction asking for the position the handle is parked on: an
   * unanswered control would never record its own minimum, and a stored value the presentation had to hold
   * at a bound could not be corrected by pressing that bound. `commit` ignores a value that is already the
   * answer, so an interaction that genuinely changes nothing still records nothing.
   */
  const commitDisplayedValue = (): void => {
    commit(displayedValue);
  };

  /** Moves the presentation only. The answer is recorded when the interaction settles. */
  const handleValueChange = (next: number[]): void => {
    if (disabled) return;

    const [nextTick] = next;
    if (typeof nextTick !== "number") return;

    const nextValue = valueOfTick(nextTick);
    if (!Number.isFinite(nextValue)) return;

    setLiveValue(nextValue);
  };

  /** The primitive's interaction-completion callback: one pointer drag or one key press. */
  const handleValueCommit = (next: number[]): void => {
    commit(valueOfTick(next[0]));
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    // The release rather than the press: the primitive resolves the new value while handling `keydown`,
    // so this is the first point at which a key that resolved to the parked value can be answered.
    if (!VALUE_ADJUSTING_KEYS.has(event.key)) return;

    commitDisplayedValue();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLSpanElement>): void => {
    pressBeganOnControl.current = event.button === 0;
    if (pressBeganOnControl.current) return;

    // A press with any other button is refused outright rather than merely left unrecorded. The primitive
    // acts on every press it sees, and it composes this handler ahead of its own, so preventing the default
    // here is what stops it starting a slide - without which a right or middle press on the track would
    // move the handle and answer the question.
    event.preventDefault();
  };

  const handlePointerUp = (): void => {
    if (!pressBeganOnControl.current) return;
    pressBeganOnControl.current = false;

    commitDisplayedValue();
  };

  const handlePointerCancel = (): void => {
    pressBeganOnControl.current = false;
    // A cancelled press expresses no selection, so the presentation returns to the answer that is actually
    // recorded. Without this the handle and the readout would keep showing the last position a drag passed
    // through, and a filled handle would claim an answer that was never committed.
    setLiveValue(committedValueRef.current);
  };

  return (
    <div className="w-full space-y-4" id={elementId} dir={dir}>
      {/* Headline, description, required marker and optional media. No `htmlFor`: the control the header
          describes is a `span` with `role="slider"`, which a label cannot be associated with, so the
          association is made from the thumb instead - see `accessibleName` above. */}
      <ElementHeader
        headline={headline}
        description={description}
        required={required}
        requiredLabel={requiredLabel}
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

        {/* The accessible name and description of the control, as text-only nodes the thumb points at. The
            header renders the same strings visually; these carry no markup, so a headline written in a rich
            editor is announced as the words it contains rather than as its tags.

            `aria-hidden` keeps them out of the reading order, where they would repeat the header that is
            already there: a node named directly by `aria-labelledby` or `aria-describedby` still supplies
            its text, which is the whole point of referencing it by id rather than copying it into an
            attribute that cannot follow the header's own wording. */}
        <span aria-hidden="true" className="sr-only" id={labelId}>
          {accessibleName}
        </span>
        {accessibleDescription ? (
          <span aria-hidden="true" className="sr-only" id={descriptionId}>
            {accessibleDescription}
          </span>
        ) : null}

        {/* Required state as an accessible description. The header shows this marker visually, but it sits
            outside the label, so this copy is what the thumb itself can point at - hidden from the reading
            order for the same reason as the two above, since the header already announces it. */}
        {required ? (
          <span aria-hidden="true" className="sr-only" id={requiredId}>
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

        {/* Driven in tick space - see the component's note. `id` lives here so the readout's `htmlFor`
            resolves to a real element; `output`'s `for` may reference any element, unlike a label's. */}
        <SliderPrimitive.Root
          data-slot="slider"
          id={inputId}
          min={0}
          max={tickCount}
          step={1}
          value={[displayedTick]}
          onValueChange={handleValueChange}
          onValueCommit={handleValueCommit}
          onKeyUp={handleKeyUp}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
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

          {/* The thumb carries `role="slider"`, the live value and the focus, so the accessible name and
              the descriptions belong here rather than on the root.

              The `aria-value*` set is supplied here rather than left to the primitive, which would publish
              the tick index it is driven with. These are the numbers the respondent is choosing between,
              and `aria-valuetext` is what a screen reader reads in place of a bare number.

              `asChild` renders the element below in its place, which is what lets the node be replaced
              once when the primitive fails to resolve its thumb - see the component's note on
              `preact/compat`. The primitive merges its own props, styles and ref onto it. */}
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            aria-labelledby={labelId}
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={displayedValue}
            aria-valuetext={String(displayedValue)}
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
