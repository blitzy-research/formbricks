import * as React from "react";
import { ElementError } from "@/components/general/element-error";
import { ElementHeader } from "@/components/general/element-header";
import { Label } from "@/components/general/label";
import { cn } from "@/lib/utils";

/**
 * Thumb diameter in pixels, matching the `h-5 w-5` utilities the visual thumb is rendered with (1.25rem at
 * the 16px root font size) and the explicit size given to the native thumb pseudo-elements below.
 *
 * The two must agree: a native range input places its thumb entirely inside the track, so its centre travels
 * `trackWidth - thumbWidth`. Sizing both to the same number is what keeps the visual thumb exactly under the
 * native one at every position rather than drifting towards the ends.
 */
const THUMB_SIZE_PX = 20;

/** Fallback required marker, kept identical to the default `ElementHeader` applies. */
const DEFAULT_REQUIRED_LABEL = "Required";

/**
 * The keys a range input answers by moving its own value, and therefore the only keys whose release can
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
  /** Increment between selectable values, measured from `min` */
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
 * Single-thumb, continuous numeric element built on a native `<input type="range">`.
 *
 * The input carries the interaction and the accessibility contract, and a decorative layer beneath it
 * carries the appearance. That split is deliberate on three counts.
 *
 * It is required. The respondent runtime (`packages/surveys`) builds this package with React aliased to
 * `preact/compat`, and a collection-based slider primitive cannot resolve its single thumb under that alias:
 * Preact defers `useEffect` while React flushes it before the re-render a ref callback schedules, so the
 * thumb's index memo settles on -1 and never recomputes. In the shipped bundle that produced a thumb
 * rendered `display: none`, no `aria-valuenow`, and arrow keys addressing a thumb that did not exist.
 *
 * It is correct by construction. Dragging, pressing anywhere on the track, primary-button-only activation,
 * the full key contract (arrows, Page Up/Down, Home/End), `role="slider"` with the live `aria-value*` set,
 * and right-to-left inversion are all supplied by the platform rather than reimplemented. Most importantly,
 * HTML defines a range input's allowed values as `min + n * step` - the step base is `min`, not zero - which
 * is exactly the grid the shared `stepMultipleOf` response rule enforces. The control therefore cannot emit
 * a value its own survey would reject, and no value is rounded or clamped on the way out.
 *
 * The appearance stays fully themeable. Native range internals are only styleable through vendor
 * pseudo-elements, which cannot express this package's token classes, so the input is made transparent and
 * the track, fill and thumb are ordinary elements underneath it - each one token-driven and carrying the
 * `data-slot` attribute a consumer would target.
 *
 * An unanswered control parks the thumb at `min` while the response value stays `undefined`, and the thumb
 * fill is what keeps that state distinguishable from a slider genuinely answered with `min`. Parking the
 * thumb there is also why the control cannot rely on the `input` event alone: an interaction asking for the
 * value the thumb is already parked at changes nothing, so HTML reports nothing, and the selection would be
 * lost. `commitHeldValue` below is what closes that gap.
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
  const hasError = Boolean(errorMessage);
  const errorId = `${inputId}-error`;
  const requiredId = `${inputId}-required`;
  // ARIA defines no required state for the `slider` role, and HTML's `required` does not apply to a range
  // input, so required-ness is announced as a description alongside the value instead.
  const describedBy =
    [required ? requiredId : null, hasError ? errorId : null].filter(Boolean).join(" ") || undefined;
  const hasValue = typeof value === "number" && Number.isFinite(value);

  // The visual layer is positioned from the prop rather than read back from the input, so an off-grid value
  // arriving from an earlier submission is drawn where it belongs instead of being moved to the nearest grid
  // point by the input's own sanitisation. A value outside the range is the one thing the presentation cannot
  // show faithfully - there is no track position for it - so it is clamped to the nearer bound, and the
  // response value itself is left untouched for the shared evaluator to reject.
  const span = max - min;
  const clamped = hasValue ? Math.min(Math.max(value, min), max) : min;
  const percent = Number.isFinite(span) && span > 0 ? Math.min(Math.max((clamped - min) / span, 0), 1) : 0;

  // The thumb is positioned by its leading edge and travels `trackWidth - thumbWidth`, so a share of the
  // width is offset by the same share of the thumb. Logical insets carry both the thumb and the fill across
  // writing directions, so they invert together with the native input and with the labels.
  const thumbInset = `calc(${(percent * 100).toString()}% - ${(percent * THUMB_SIZE_PX).toString()}px)`;
  const rangeInsetEnd = `${((1 - percent) * 100).toString()}%`;

  // A step that describes no grid would make the attribute invalid and silently fall back to 1; omitting it
  // reaches the same default without asserting a grid the configuration does not define.
  const safeStep = Number.isFinite(step) && step > 0 ? step : undefined;

  // A release only expresses a selection if the press that preceded it began on this control: without that
  // record, a pointer press started elsewhere and merely finished over the control would answer the question.
  // A ref rather than state, because nothing about it is rendered.
  const pressBeganOnControl = React.useRef(false);

  /**
   * Reads the value the input itself resolved.
   *
   * `valueAsNumber` is already snapped to the grid anchored at `min`, so the number returned here is one the
   * control's own survey accepts. The string fallback covers test renderers that do not implement the
   * property.
   */
  const readHeldValue = (control: HTMLInputElement): number => {
    const parsed = control.valueAsNumber;
    return Number.isNaN(parsed) ? Number(control.value) : parsed;
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    if (disabled) return;

    const next = readHeldValue(event.currentTarget);
    if (!Number.isFinite(next)) return;

    onChange(next);
  };

  /**
   * Records the value the control is holding once an interaction finishes, for the one selection the `input`
   * event cannot report.
   *
   * HTML fires `input` only on an actual change, and an unanswered control's value is already parked at
   * `min`. Every interaction that asks for the minimum - `Home`, `ArrowLeft`, `ArrowDown` and `PageDown`, or
   * a press at the low end of the track - therefore resolves to the value already there and reports nothing,
   * leaving the answer unrecorded: a required slider could not be completed at all, and an optional one would
   * silently drop the low end of its own range. The maximum never had this problem, which is the whole shape
   * of the defect: only the parked value was unreachable.
   *
   * Reading back what the platform resolved, rather than assuming `min`, is what makes this safe on three
   * counts. It is idempotent - when the interaction did move the value, `input` has already reported that same
   * number, so committing it again changes nothing. It needs no notion of direction - `ArrowLeft` moves toward
   * the maximum in a right-to-left survey, so any rule mapping a key to a bound would be wrong there. And it
   * stays on the grid, because the value read back is the one the input snapped to.
   */
  const commitHeldValue = (control: HTMLInputElement): void => {
    if (disabled || hasValue) return;

    const held = readHeldValue(control);
    if (!Number.isFinite(held)) return;

    onChange(held);
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    // The release rather than the press: the platform resolves the new value as the default action of
    // `keydown`, so this is the first point at which the control's own value can be read back.
    if (!VALUE_ADJUSTING_KEYS.has(event.key)) return;

    commitHeldValue(event.currentTarget);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLInputElement>): void => {
    // Primary button only, matching the range input's own activation behaviour.
    pressBeganOnControl.current = event.button === 0;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLInputElement>): void => {
    if (!pressBeganOnControl.current) return;
    pressBeganOnControl.current = false;

    commitHeldValue(event.currentTarget);
  };

  const handlePointerCancel = (): void => {
    pressBeganOnControl.current = false;
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

      {/* Slider body. `relative` anchors the absolutely positioned error bar that ElementError renders, so
          it must stay on this wrapper. */}
      <div className="relative">
        {/* Wrapped so the message has a stable id the control can point at. The wrapper stays unpositioned
            so the error bar keeps resolving against the `relative` ancestor above, and its child's bottom
            margin still collapses through it, leaving the spacing untouched. */}
        {hasError ? (
          <div id={errorId}>
            <ElementError errorMessage={errorMessage} dir={dir} />
          </div>
        ) : null}

        {/* Required state as an accessible description. The header shows this marker visually, but it sits
            outside the label, so this copy is what the control itself can point at. */}
        {required ? (
          <span className="sr-only" id={requiredId}>
            {requiredLabel}
          </span>
        ) : null}

        {/* Selected-value readout. `output` is the semantic element for a computed value and is announced as
            such by assistive technology, and `htmlFor` ties it to the control that produced it. */}
        {showValue && hasValue ? (
          <output
            className="text-input-text font-input font-input-weight mb-2 block text-center"
            htmlFor={inputId}>
            {clamped}
          </output>
        ) : null}

        {/* Control. The input is stretched over the presentation and made transparent, so every pointer and
            key interaction lands on the platform control while the visible slider is drawn beneath it. The
            native thumb is sized explicitly, because its width is what the browser's own thumb travel is
            measured against and therefore what keeps the visible thumb aligned with it. */}
        <div className="relative flex h-5 w-full items-center">
          <input
            type="range"
            id={inputId}
            className={cn(
              "peer absolute inset-0 z-10 m-0 h-full w-full appearance-none bg-transparent p-0 opacity-0",
              "[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none",
              "[&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-0",
              disabled ? "cursor-not-allowed" : "cursor-pointer"
            )}
            min={min}
            max={max}
            step={safeStep}
            value={clamped}
            disabled={disabled}
            dir={dir === "auto" ? undefined : dir}
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            onChange={handleChange}
            onKeyUp={handleKeyUp}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          />

          {/* Presentation only: the input above owns the role, the value and the focus, so these carry no
              semantics and are hidden from assistive technology. */}
          <div
            aria-hidden="true"
            data-slot="slider"
            className={cn(
              "pointer-events-none absolute inset-0 flex w-full items-center",
              disabled ? "opacity-50" : null
            )}>
            <div
              data-slot="slider-track"
              className="bg-input-bg border-input-border rounded-input relative h-2 w-full overflow-hidden border">
              <div
                data-slot="slider-range"
                className="bg-brand absolute inset-y-0"
                style={{ insetInlineStart: 0, insetInlineEnd: rangeInsetEnd }}
              />
            </div>
          </div>

          {/* The handle is a sibling of the input rather than a child of the layer above it, because its
              focus and hover affordances are `peer-*` variants and those resolve against siblings of the
              peer only - nested inside the layer they would compile to selectors that match nothing, and
              a keyboard respondent would get no focus indicator at all. */}
          <div
            aria-hidden="true"
            data-slot="slider-thumb"
            style={{ insetInlineStart: thumbInset }}
            className={cn(
              "border-brand pointer-events-none absolute block h-5 w-5 rounded-full border-2",
              "transition-[background-color,box-shadow]",
              // Fill is what tells an untouched control apart from one answered with the minimum.
              hasValue ? "bg-brand" : "bg-input-bg",
              // Focus and hover affordances mirror the input's own state, since the input is invisible. The
              // ring is half-opacity, as the checkbox and radio rings are, so that it still reads as a halo
              // once the handle itself is filled with the same brand colour.
              "peer-focus-visible:ring-ring/50 peer-focus-visible:ring-[3px]",
              disabled ? "opacity-50" : "peer-hover:ring-brand-20 peer-hover:ring-2"
            )}
          />
        </div>

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
