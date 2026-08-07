import * as SliderPrimitive from "@radix-ui/react-slider";
import DOMPurify from "isomorphic-dompurify";
import * as React from "react";
import { ElementError } from "@/components/general/element-error";
import { ElementHeader } from "@/components/general/element-header";
import { Label } from "@/components/general/label";
import { cn } from "@/lib/utils";

/**
 * Fallback announcement for a control nobody has answered yet.
 *
 * The handle has to be drawn somewhere, so an unanswered control parks it at `min` and the primitive publishes
 * `min` as its value. Visually the unfilled handle is what says "not answered"; `aria-valuetext` is what says
 * the same thing to a respondent who cannot see it. The caller supplies the translated wording, so this only
 * covers a consumer that supplies none.
 */
const DEFAULT_UNANSWERED_LABEL = "No value selected";

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
 * One respondent gesture, identified so that only the event that began it can end it.
 *
 * A press and a key press end on different events - `pointerup` and `keyup` - and two presses can be in
 * flight at once on a touch screen, so the gesture is recorded rather than merely flagged. `pointerId` is
 * what makes a release attributable: it names the very pointer whose contact began the gesture, so a release
 * from any other pointer, of any type, is not the end of this one.
 */
type Interaction = { kind: "pointer"; pointerId: number } | { kind: "keyboard" };

/**
 * Whether the event ending a gesture is the one that began it.
 *
 * Without this, a gesture left open by a cancellation could be closed by an entirely unrelated later
 * release - the release of a press that began somewhere else, with a different pointer, possibly of a
 * different type - and that release would answer the question with whatever position the handle is parked on.
 */
const isSameInteraction = (began: Interaction | null, ending: Interaction): boolean => {
  if (began === null) return false;
  if (began.kind === "pointer") {
    return ending.kind === "pointer" && began.pointerId === ending.pointerId;
  }

  return ending.kind === "keyboard";
};

/**
 * Whether a pointer event describes the PRIMARY button.
 *
 * `button` is `0` for the primary mouse button, for a finger in contact and for a pen tip; `1` and `2` are
 * the middle and secondary mouse buttons and `3`/`4` the browser-navigation ones. Only the primary button
 * expresses a selection - a secondary press opens a context menu and a middle press scrolls or opens a link,
 * and neither is an act of answering a question. Any of them nonetheless produces a full `pointerdown`,
 * `pointerup` pair over the control, which is why the button has to be read rather than assumed.
 *
 * Read from `button` alone, deliberately. `isPrimary` distinguishes the first contact of a multi-touch
 * gesture, not the button, and it is `false` on a synthesized event by specification - so gating on it would
 * reject the very interactions this control exists for.
 */
const isPrimaryButton = (event: { button: number }): boolean => event.button === 0;

/**
 * Classes on the selected-value readout.
 *
 * Written as one literal, and deliberately not composed through `cn`: that helper merges classes it reads
 * as setting the same property, and it cannot tell this design system's two font tokens apart - it treats
 * `font-input-weight` as another font family and drops `font-input`. Hiding the readout appends to this
 * instead of merging with it, which nothing here conflicts with.
 *
 * The colour is written as the two-step token chain rather than as the `text-input-text` utility, because
 * that utility compiles to `color: var(--fb-input-text-color)` with no fallback and the theme declares no
 * such variable - it declares `--fb-input-color`. An unresolvable `var()` makes the declaration invalid at
 * computed-value time, so `color` inherits and the readout paints the document's default black while the
 * headline, the description and the endpoint labels beside it all paint the theme's own `#414b5a`. Naming
 * both variables keeps the intent - the input text colour - and resolves it: the chain is exactly the one
 * the stylesheet itself uses for `--fb-input-placeholder-color`, so a theme that does declare
 * `--fb-input-text-color` still wins and nothing new is introduced for one that does not.
 */
const READOUT_CLASS =
  "text-[var(--fb-input-text-color,var(--fb-input-color))] font-input font-input-weight mb-2 block text-center";

/**
 * Elements whose boundary is read as a pause rather than as nothing at all.
 *
 * A headline authored on more than one line is stored as one element per line, and flattening it would
 * otherwise join the last word of one line to the first word of the next.
 */
const TEXT_BOUNDARY_ELEMENTS = "address,blockquote,br,div,h1,h2,h3,h4,h5,h6,li,ol,p,pre,section,table,tr,ul";

/**
 * Flattens a headline to the plain text a person actually reads.
 *
 * The headline is authored with a rich-text editor and stored as markup, which the label renders as
 * sanitized HTML. An accessible name, by contrast, is a plain string that assistive technology reads out
 * verbatim, so the markup has to come off first: handed the stored string directly, a screen reader
 * announces every tag, class and attribute, and a headline containing a script would have its source read
 * aloud. Sanitizing before reading the text is what removes the second case entirely - the elements
 * DOMPurify drops take their content with them - and reading `textContent` rather than stripping tags by
 * hand is what resolves character references to the characters they stand for.
 *
 * Returns an empty string for a headline that carries no readable text, so the caller can leave the name
 * off rather than publish an empty one.
 */
const toPlainText = (html: string): string => {
  const collapsed = html.replace(/\s+/g, " ").trim();
  // Neither markup nor a character reference: this is already the text a person reads, and parsing it
  // would only cost a document on every headline in the overwhelmingly common case.
  if (!collapsed || !/[<&]/.test(collapsed)) return collapsed;

  try {
    const sanitized = DOMPurify.sanitize(collapsed, { FORBID_ATTR: ["style"] });
    // Parsed rather than pattern-matched, for the same reason the labels are: a parser is the only thing
    // that reads markup the way a browser does. The document is inert - nothing in it runs or loads.
    const { body } = new DOMParser().parseFromString(sanitized, "text/html");
    for (const boundary of Array.from(body.querySelectorAll(TEXT_BOUNDARY_ELEMENTS))) {
      boundary.before(" ");
    }

    return (body.textContent ?? "").replace(/\s+/g, " ").trim();
  } catch {
    // No document to parse with. Reporting no name is the safe outcome: the alternative is announcing the
    // markup, which is the very thing this exists to prevent.
    return "";
  }
};

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
  /** Custom label for the required indicator */
  requiredLabel?: string;
  /**
   * Announcement used in place of the value while the control is unanswered, so that "not answered yet" and
   * "answered with the lower bound" are as distinguishable to assistive technology as they are on screen.
   * Defaults to `"No value selected"`
   */
  unansweredLabel?: string;
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
 * stays distinguishable from one answered with `min`. `onChange` receives a plain number.
 *
 * Interaction. Only the primary button answers the question. A secondary or middle press is refused outright,
 * so it can neither start a slide nor be mistaken on release for a selection of the parked position. A press
 * the browser cancels is dropped rather than left open, and a release only completes the very press that began
 * it, so nothing an unrelated later pointer does can fabricate an answer.
 *
 * Accessibility. The primitive supplies `role="slider"`, the live value semantics and the full key contract -
 * arrow keys step by one increment, Page keys jump, Home and End move to the bounds - and the handle carries
 * the role, the value, the required state and the focus, the primitive's own root having no role at all. The
 * handle's accessible name is the headline flattened to plain text, so a headline authored as rich text is
 * announced as the question rather than as its markup. Activating the headline or the description focuses the
 * handle, which is what a label would do; the header deliberately renders no `label` element, because the
 * only element it could reference is the primitive's roleless root and a label may reference only a labelable
 * control. An error message is announced twice over: immediately, because the container it appears in is an
 * assertive live region, and again on demand through the handle's `aria-describedby` alongside
 * `aria-invalid`. While the control is unanswered the handle carries an `aria-valuetext` saying so, because
 * the parked position would otherwise be announced as an answer. The value readout is an `output` bound to
 * the control. The handle and the rail each accept the pointer across 44px, added as transparent
 * pseudo-elements so the target is larger than the paint.
 *
 * Appearance. Every part is token-driven - no colour, radius or font is hard-coded and no new `--fb-*`
 * variable is introduced - and each carries a stable slot attribute a consumer can target: `slider`,
 * `slider-track`, `slider-range` and `slider-thumb`. `dir` accepts `"ltr"`, `"rtl"` or `"auto"`, and the
 * track, the fill and the endpoint labels invert together. `lowerLabel` and `upperLabel` are independently
 * optional, and each is drawn at the endpoint it names whether or not the other is present. The handle
 * answers hover, focus and press with
 * three distinct rings - a pale 2px halo, a 3px brand ring offset by a ring of the input surface, and a 5px
 * halo while held - none of which changes its geometry, so nothing under the respondent's pointer moves.
 * Under forced colours, where a ring cannot paint at all, focus is shown as an outline the mode fills with a
 * system colour instead.
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
  unansweredLabel = DEFAULT_UNANSWERED_LABEL,
  errorMessage,
  dir = "auto",
  disabled = false,
  imageUrl,
  videoUrl,
}: Readonly<SliderProps>): React.JSX.Element {
  const hasError = Boolean(errorMessage);
  const errorId = `${inputId}-error`;
  // Only the error message is a description. Required-ness is a STATE, published as `aria-required` on the
  // handle - the one element in the composition that carries a role, and a role for which ARIA defines the
  // attribute. Describing it instead would restate the marker `ElementHeader` already renders, which assistive
  // technology reads from the document anyway, so it was announced twice.
  const describedBy = hasError ? errorId : undefined;

  // The name the handle is announced by. Memoised because an interaction re-renders this component on
  // every movement while the headline it is derived from does not change, and flattening parses a document.
  const accessibleName = React.useMemo(() => toPlainText(headline), [headline]);
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
   * Moves focus to the handle when the respondent activates the question's own text.
   *
   * This is the behaviour a `<label for>` would have supplied, and it is supplied here instead because it
   * cannot be supplied there: the only element the header could point at is the primitive's root, and HTML
   * lets a label reference only a labelable control - a button, an input, a select and so on. The root is a
   * `span`, so the reference resolved to nothing, `label.control` was null, and activating the headline moved
   * focus nowhere at all. The header therefore renders its text as plain spans (see the composition below)
   * and this handler restores the one thing the broken association was there to provide.
   *
   * The handle is the element that carries the role, the value and the focus, so it is the only sensible
   * destination. A disabled control is left alone, exactly as a native one would be.
   */
  const focusThumb = (): void => {
    if (disabled) return;
    thumbRef.current?.focus();
  };

  /**
   * Whether the primitive reported a value during the interaction in progress.
   *
   * A ref rather than state, because nothing about it is rendered, and it must be readable synchronously
   * within a single interaction rather than after the next render.
   */
  const reportedDuringInteraction = React.useRef(false);

  // The gesture in progress, or `null` when there is none. `pointerup` fires on release over the handle
  // however the press started, so without this record a press begun elsewhere and merely finished here would
  // answer the question with the position the handle happens to be parked on. Recording WHICH gesture is open
  // rather than merely that one is - see `Interaction` - is what additionally stops a gesture the browser
  // cancelled from being closed by an unrelated later release. A ref rather than state, because nothing about
  // it is rendered and it has to be readable within the interaction that wrote it.
  const interactionRef = React.useRef<Interaction | null>(null);

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

  const beginInteraction = (interaction: Interaction): void => {
    reportedDuringInteraction.current = false;
    interactionRef.current = interaction;
  };

  /**
   * Drops the gesture in progress without completing it.
   *
   * A cancellation is not a release: the browser has taken the pointer away - a touch became a scroll, the
   * window lost focus, the device was disconnected - and no `pointerup` will follow for it. Left recorded, the
   * abandoned gesture would be closed by whatever release came next, however unrelated, and that release would
   * answer the question with the position the handle is parked on. Clearing it is what makes the cancellation
   * final, and what leaves the committed answer - which lives in the caller's state, not here - exactly as it
   * was before the gesture began.
   */
  const abandonInteraction = (): void => {
    interactionRef.current = null;
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
   *
   * Completes only the gesture that is actually open, and only from the event that began it. Anything else -
   * a release with no gesture recorded, a release from a different pointer, a key release closing a press -
   * leaves both the gesture and the answer untouched.
   */
  const endInteraction = (ending: Interaction): void => {
    if (!isSameInteraction(interactionRef.current, ending)) return;

    // Consumed whatever the outcome, so one press can complete at most one selection.
    const reported = reportedDuringInteraction.current;
    abandonInteraction();

    if (disabled || hasValue || reported) return;

    const parkedValue = toElementValue(offsetValue);
    if (Number.isFinite(parkedValue)) {
      onChange(parkedValue);
    }
  };

  /**
   * Opens a press, or refuses one that cannot express a selection.
   *
   * A non-primary press is stopped here rather than merely ignored. `preventDefault` is what stops it: the
   * primitive composes its own `pointerdown` behind this handler and skips it once the default is prevented,
   * so a secondary or middle press never captures the pointer, never starts a slide and never moves focus to
   * the handle. Without that, the primitive would answer the question from the press position - and this
   * component would answer it from the parked position on release - for an input the respondent never meant
   * as an answer.
   *
   * A non-primary press arriving DURING a primary one leaves that primary gesture exactly as it is: it is not
   * reopened, which would forget that a value had already been reported, and not abandoned, which would
   * discard a press the respondent is still making.
   */
  const handlePointerDown = (event: React.PointerEvent<HTMLSpanElement>): void => {
    if (!isPrimaryButton(event)) {
      event.preventDefault();
      return;
    }

    beginInteraction({ kind: "pointer", pointerId: event.pointerId });
  };

  /**
   * Closes a press.
   *
   * A non-primary release is not the end of a primary press - releasing the secondary button while the
   * primary one is still held is exactly that case - so it neither completes nor abandons the gesture.
   */
  const handlePointerUp = (event: React.PointerEvent<HTMLSpanElement>): void => {
    if (!isPrimaryButton(event)) return;

    endInteraction({ kind: "pointer", pointerId: event.pointerId });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (VALUE_ADJUSTING_KEYS.has(event.key)) {
      beginInteraction({ kind: "keyboard" });
    }
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (VALUE_ADJUSTING_KEYS.has(event.key)) {
      endInteraction({ kind: "keyboard" });
    }
  };

  /*
   * Styling notes for the composition below. Kept here rather than beside the class lists because a comment
   * inside a call's argument list survives this package's unminified build and ships in the library chunk,
   * whereas a statement-level block like this one does not.
   *
   * Handle fill. `bg-brand` versus `bg-input-bg` is what tells an untouched control apart from one answered
   * with the minimum - the two are otherwise identical, handle position included.
   *
   * Ring colour, declared unconditionally. Whichever variant supplies a ring WIDTH must not be able to paint
   * an unbranded ring. Tailwind wraps `hover:` utilities in `@media (hover: hover)`, and a consuming
   * application's own stylesheet may well provide an ungated `hover:ring-2` of its own - which is exactly
   * what happens when this control is embedded in an application built on an older Tailwind. The width then
   * applies while the gated colour does not, and the ring falls back to Tailwind's stock blue. Declaring the
   * colour on the base rule removes that possibility and costs nothing by itself: a ring colour with no ring
   * width paints nothing.
   *
   * Focus indicator, as two concentric rings. A single translucent brand halo measured 1.9-2.4:1 against the
   * page, the track AND the handle's own border - the border being the same brand colour, so the halo had
   * almost nothing to contrast with. A full-opacity brand ring separated from the handle by a ring of the
   * input surface gives the indicator a high-contrast boundary on both of its sides, whatever it sits over:
   * the brand against the page or the track, and the surface against the brand-filled handle and the range.
   *
   * Pressed state. The ring widens and the cursor becomes `grabbing`. Without it the handle looked identical
   * held and merely focused, and a `cursor-grab` affordance that never becomes `grabbing` contradicts itself.
   * The root repeats the cursor because a drag captures the pointer: once it leaves the handle the cursor
   * resolves against whatever is under it, which is the track or the root, and would otherwise flicker back.
   *
   * Forced-colours focus. That mode discards every author colour and suppresses box shadows outright, so the
   * three rings above cannot paint at all - and `outline-none` used to leave nothing in their place, making a
   * focused handle pixel-for-pixel identical to an unfocused one. `focus-visible:outline-hidden` keeps
   * suppressing the browser's own indicator in normal colours, exactly as `outline-none` did, while declaring
   * a real 2px outline under forced colours for the mode to repaint in a system colour. One indicator in
   * either rendering, never two at once.
   *
   * Pointer targets. The rail is 8px tall and the handle 20px across, both well under the 44px a fingertip
   * needs, and the handle is absolutely positioned so it contributes no height to the element the primitive
   * listens on. Each therefore carries a transparent `::before` that extends its pointer target to 44px: a
   * pseudo-element is hit tested as part of the element that owns it, sits out of flow, and paints nothing, so
   * every measurement of this control - and every pixel of it - is what it was. The same reason rules out
   * padding, a min-size or a larger handle, all of which would move the layout.
   *
   * Every interaction affordance is a ring, an outline or a cursor. None is a size, a translation or a scale,
   * so nothing under the respondent's pointer moves when they hover, focus or press.
   */
  return (
    <div className="w-full space-y-4" id={elementId} dir={dir}>
      {/* No `htmlFor`. The header would point it at the primitive's root, which is a `span` and therefore not
          a labelable element, so the browser resolved the reference to nothing: `label.control` was null,
          Chrome reported "Incorrect use of <label for=FORM_ELEMENT>" for both the headline and the
          description, and clicking either left focus on the document body. Without it the header renders the
          same text as spans - no invalid reference, and nothing announced twice - while `onClick` supplies the
          one behaviour the association was for, and the handle keeps carrying the accessible name itself. */}
      <ElementHeader
        headline={headline}
        description={description}
        required={required}
        requiredLabel={requiredLabel}
        imageUrl={imageUrl}
        videoUrl={videoUrl}
        onClick={focusThumb}
      />

      {/* Slider body. `relative` anchors the absolutely positioned indicator bar that ElementError renders,
          so it must stay on this wrapper with the error as its first child. */}
      <div className="relative">
        {/* Wrapped so the message has a stable id the handle can point at. The wrapper stays unpositioned, so
            the indicator bar keeps resolving against the `relative` ancestor above and the child's bottom
            margin still collapses through it - the spacing is unchanged.

            The wrapper is also the live region. It is mounted only while there is something to say, so its
            insertion is the announcement - which is what a respondent who cannot see the message needs, since
            submitting leaves focus on the submit button and nothing else would speak. `assertive` rather than
            `polite` because the submission the respondent just made did not happen, and `aria-atomic` so the
            whole message is read rather than only the words that changed between two different errors. The
            handle's `aria-describedby` points at this same node, so the message is also available on demand
            once focus reaches the control. */}
        {hasError ? (
          <div id={errorId} role="alert" aria-live="assertive" aria-atomic="true">
            <ElementError errorMessage={errorMessage} dir={dir} />
          </div>
        ) : null}

        {/* Selected-value readout. `output` is the semantic element for a computed value and is announced as
            such by assistive technology, and `htmlFor` ties it to the control that produced it. The figure is
            the value itself, never the clamped position the handle is drawn at, so a value arriving from
            outside the range stays visible to the respondent who has to correct it.

            Mounted for the whole life of the control whenever it is enabled, and merely hidden until there is
            something to show, so that its box is reserved from the first paint. Creating it on the first
            answer instead would insert 30px of new content ABOVE the track at the exact moment the respondent
            is touching it, displacing the handle - and the submit button - out from under their pointer. The
            placeholder is a no-break space rather than an empty string, because an empty inline box collapses
            to zero height and would reserve nothing. `visibility: hidden` keeps the placeholder out of the
            accessibility tree as well as out of sight, so nothing announces a value that does not exist. And
            because the region exists before the value first changes, that first change is announced. */}
        {showValue ? (
          <output
            // `cn` is deliberately not used for this one class list. Its tailwind-merge step treats
            // `font-input` (the family token) and `font-input-weight` (the weight token) as a single
            // conflicting `font-*` group and keeps only the later of the two, which would silently drop the
            // readout's font family. Composing the string directly keeps both tokens, and there is nothing
            // here for a merge to resolve: every class is this component's own and `invisible` conflicts with
            // none of them.
            className={READOUT_CLASS + (hasValue ? "" : " invisible")}
            htmlFor={inputId}>
            {hasValue ? value : "\u00a0"}
          </output>
        ) : null}

        {/* `id` lives here so the header's and the readout's `htmlFor` both resolve to a real element.
            The primitive gives this element no role, and an ARIA attribute that is not global - `aria-required`
            in particular - is invalid on an element without one, so nothing is announced from here: the value,
            the name and every state live on the handle below, required-ness among them. The primitive sets its
            own `aria-disabled` on this node, which is cleared explicitly so that this value replaces it rather
            than being merged behind it - leaving the roleless node carrying no `aria-*` at all. `data-disabled`,
            which the primitive also sets, is untouched: it carries no ARIA meaning and is what the disabled
            styling hangs off. */}
        <SliderPrimitive.Root
          data-slot="slider"
          id={inputId}
          name={inputId}
          min={0}
          max={span}
          step={safeStep}
          value={[offsetValue]}
          onValueChange={handleValueChange}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          // Both are cancellations, and both are needed. `pointercancel` is the browser saying the contact is
          // gone without a release - a touch that became a scroll, a window that lost focus, a device that was
          // unplugged. `lostpointercapture` covers the quieter case of the capture the primitive takes being
          // dropped without a cancel at all, which leaves the release to be delivered somewhere else entirely.
          // Neither can be confused with a normal completion: the release runs this component's own
          // `pointerup` before the primitive releases its capture, so a completed press has already closed its
          // own gesture by the time either of these could arrive.
          onPointerCancel={abandonInteraction}
          onLostPointerCapture={abandonInteraction}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          disabled={disabled}
          dir={sliderDir}
          aria-disabled={undefined}
          className={cn(
            "relative flex w-full touch-none select-none items-center",
            // 8px of rail, 44px of pointer target - see the pointer-target note above.
            "before:absolute before:-inset-y-[18px] before:inset-x-0 before:content-['']",
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer active:cursor-grabbing"
          )}>
          <SliderPrimitive.Track
            data-slot="slider-track"
            className="bg-input-bg border-input-border rounded-input relative h-2 w-full grow overflow-hidden border">
            {/* Forced colours replace every author colour with one from the user's own palette, which
                flattens the fill and the track it sits in to the same surface. Naming a system colour
                inside the query is what survives that substitution, so how much of the track is filled
                stays visible to a respondent who browses that way. */}
            <SliderPrimitive.Range
              data-slot="slider-range"
              className="bg-brand absolute h-full forced-colors:bg-[CanvasText]"
            />
          </SliderPrimitive.Track>

          {/* The handle carries `role="slider"`, the live value and the focus, so the accessible name, the
              states and the descriptions all belong here rather than on the root. Its `aria-value*` set is
              supplied here rather than left to the primitive, which would publish the offset it is driven
              with instead of the number the respondent is choosing.

              `aria-required` is valid here precisely because this node has a role that defines it, and it is
              the only place required-ness can be published as a state rather than as prose. It is omitted
              rather than set to "false" for an optional control, so the attribute's presence alone carries
              the meaning.

              `aria-valuetext` overrides the numeric announcement while the control is unanswered. Without it
              the parked handle reports the lower bound, so a screen-reader user could not tell an untouched
              control from one deliberately answered with that bound - the very distinction the unfilled
              handle makes visually. Once answered it is dropped, restoring the numeric value.

              While the control is unanswered the handle publishes the minimum as its current value, because
              the slider role requires one - the unfilled handle is the visual signal that nothing has been
              chosen yet.

              `asChild` renders the element below in its place, which is what lets the node be replaced once
              when the primitive fails to resolve its handle - see the note above. The primitive merges its
              own props, styles and ref onto it. */}
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            aria-label={accessibleName || undefined}
            aria-required={required || undefined}
            aria-valuetext={hasValue ? undefined : unansweredLabel}
            aria-invalid={hasError || undefined}
            aria-disabled={disabled || undefined}
            aria-describedby={describedBy}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={displayedValue}
            className={cn(
              "border-brand block h-5 w-5 rounded-full border-2",
              // 20px of handle, 44px of pointer target - see the pointer-target note above.
              "before:absolute before:-inset-3 before:content-['']",
              "transition-[background-color,box-shadow]",
              // Fill is what tells an untouched control apart from one answered with the minimum. Under
              // forced colours a fill alone cannot: both of these resolve to the same surface colour, and a
              // slider answered with its own minimum has neither a visible fill on the track nor a handle
              // anywhere but the start, so the two states would be indistinguishable. The answered handle
              // therefore names a system colour, which survives the substitution, and the untouched one is
              // additionally outlined differently - a difference in shape rather than in colour, which is
              // the one cue no colour scheme can take away.
              hasValue ? "bg-brand forced-colors:bg-[CanvasText]" : "bg-input-bg forced-colors:border-dashed",
              // The ring colour is declared unconditionally so it can never fall back to Tailwind's default
              // blue: gating the colour while leaving the 2px width ungated is what painted an unbranded ring
              // on devices that report a hover they do not have.
              "ring-brand-20",
              // Full opacity, with an offset ring of the input surface behind it. At half opacity over the
              // brand-filled handle the focus ring measured below the 3:1 contrast WCAG asks of a focus
              // indicator; the offset is what separates it from the handle it surrounds.
              "focus-visible:ring-ring focus-visible:ring-[3px] focus-visible:ring-offset-2",
              "focus-visible:ring-offset-input-bg",
              // Suppresses the browser's indicator in normal colours and supplies one under forced colours,
              // where a ring cannot paint - see the forced-colours note above.
              "focus-visible:outline-hidden",
              disabled
                ? "cursor-not-allowed"
                : "cursor-grab hover:ring-2 active:cursor-grabbing active:ring-[5px]"
            )}
            asChild>
            <span key={thumbGeneration} ref={thumbRef} />
          </SliderPrimitive.Thumb>
        </SliderPrimitive.Root>

        {/* Endpoint labels, laid out exactly as the OpinionScale label row is so the two controls align.
            Each label is independently optional, and the justification names the endpoint the labels present
            actually describe: `justify-between` drives two labels to opposite ends, but a LONE label falls
            back to main-start whichever endpoint it belongs to - so an upper label authored without a lower
            one was drawn under the MINIMUM, indistinguishable from a lower label and stating the opposite of
            what the author wrote. `justify-end` puts it back on the maximum.

            Expressed as flex justification rather than as a logical margin on the label, because the two
            resolve against different elements: justification resolves against this row's own direction, which
            is the direction the track and the fill are laid out in, while `margin-inline-start` would resolve
            against the LABEL's direction - and the label carries `dir`, including `dir="auto"`, whose value is
            derived from the label's text. A right-to-left label inside a left-to-right row would then be
            pushed to the opposite end of the one the fill grows towards. */}
        {(lowerLabel ?? upperLabel) ? (
          <div className={cn("mt-4 flex gap-8 px-1.5", lowerLabel ? "justify-between" : "justify-end")}>
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
