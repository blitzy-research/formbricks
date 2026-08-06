// @vitest-environment happy-dom
/* eslint-disable import/no-extraneous-dependencies -- Test-only imports. `@testing-library/react` and
   `@testing-library/jest-dom` are declared once by `apps/web` and reach every workspace project through
   pnpm's hoisted layout (`.npmrc`: `node-linker=hoisted`, `shamefully-hoist=true`), which is how the
   colocated specs beside this one already resolve them. Declaring them here as well would add dependencies
   to a published package for the sake of its tests; the rule stays fully enforced for production sources. */
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Slider } from "../slider";

/**
 * The control delegates dragging, snapping, the key contract and the `slider` role to the Radix slider
 * primitive, so these specs assert what this component adds on top of it: the numbers it hands the
 * primitive, the numbers it reports back, which interactions record an answer, and the presentation of the
 * answered, error, disabled and right-to-left states.
 *
 * Interaction is exercised through the keyboard rather than the pointer, because happy-dom renders no layout
 * for a pointer position to be measured against. Pointer dragging and the painted right-to-left inversion
 * are therefore beyond this suite's reach; what it does assert is that the primitive is handed the
 * direction, bounds and grid those behaviours are produced from.
 */

// ---------------------------------------------------------------------------
// Shared default props — `onChange` is cleared before every test
// ---------------------------------------------------------------------------

const defaultProps = {
  elementId: "test-slider",
  headline: "How satisfied are you?",
  inputId: "test-slider-input",
  min: 0,
  max: 100,
  step: 5,
  // Typed, so the recorded arguments read back as numbers.
  onChange: vi.fn<(value: number) => void>(),
};

/** The primitive puts `role="slider"` on its handle, which is the element that carries the value. */
const getThumb = (): HTMLElement => screen.getByRole("slider");

/** The node carrying one of the component's four slot attributes. */
const getSlot = (container: HTMLElement, slot: string): HTMLElement => {
  const node = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  if (!node) throw new Error(`No node found for slot "${slot}"`);
  return node;
};

/** Presses a key on the handle, which is where focus sits and from where the primitive handles it. */
const pressKey = (key: string): void => {
  const thumb = getThumb();
  fireEvent.keyDown(thumb, { key });
  fireEvent.keyUp(thumb, { key });
};

describe("Slider", () => {
  beforeEach(() => {
    defaultProps.onChange = vi.fn<(value: number) => void>();
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  test("renders a single slider control", () => {
    render(<Slider {...defaultProps} />);

    expect(screen.getAllByRole("slider")).toHaveLength(1);
  });

  test("renders headline text", () => {
    render(<Slider {...defaultProps} />);

    expect(screen.getByText("How satisfied are you?")).toBeInTheDocument();
  });

  test("renders description when provided", () => {
    render(<Slider {...defaultProps} description="Drag to choose a value" />);

    expect(screen.getByText("Drag to choose a value")).toBeInTheDocument();
  });

  test("does not render a description when none is provided", () => {
    render(<Slider {...defaultProps} />);

    expect(screen.queryByText("Drag to choose a value")).not.toBeInTheDocument();
  });

  test("applies the element id to the wrapper", () => {
    const { container } = render(<Slider {...defaultProps} />);

    expect(container.querySelector("#test-slider")).toBeInTheDocument();
  });

  test("renders the track, range and handle composition", () => {
    const { container } = render(<Slider {...defaultProps} />);

    const root = getSlot(container, "slider");
    const track = getSlot(container, "slider-track");
    const range = getSlot(container, "slider-range");
    const thumb = getSlot(container, "slider-thumb");

    // The fill belongs inside the track; the handle is a sibling of the track, not a child of it.
    expect(track).toContainElement(range);
    expect(track).not.toContainElement(thumb);
    expect(root).toContainElement(track);
    expect(root).toContainElement(thumb);
    expect(thumb).toHaveAttribute("role", "slider");
  });

  test("carries the control id on the composition root", () => {
    const { container } = render(<Slider {...defaultProps} />);

    expect(getSlot(container, "slider")).toHaveAttribute("id", "test-slider-input");
  });

  test("resolves the handle rather than leaving it hidden", () => {
    // The primitive hides a handle whose value it cannot resolve. Under `preact/compat` that is exactly what
    // happens on the first pass, which the component recovers from by replacing the node once.
    render(<Slider {...defaultProps} value={50} />);

    expect(getThumb()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Value readout
  // -------------------------------------------------------------------------

  test("shows the selected value once there is one", () => {
    render(<Slider {...defaultProps} value={45} />);

    expect(screen.getByText("45")).toBeInTheDocument();
  });

  test("shows nothing while the control is unanswered", () => {
    render(<Slider {...defaultProps} />);

    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  test("holds the readout's place from the first paint, so the first answer shifts nothing", () => {
    // Rendered and merely hidden rather than added when the first value arrives: a readout that appeared
    // would push the track out from under the handle the respondent is holding. It is also what gets that
    // first value change announced, because the region already exists when the value changes.
    const { container, rerender } = render(<Slider {...defaultProps} />);
    const readout = container.querySelector("output");

    expect(readout).not.toBeNull();
    expect(readout).toHaveClass("invisible");
    expect(readout?.textContent).toBe(" ");

    rerender(<Slider {...defaultProps} value={45} />);

    // The SAME element, now revealed - not a replacement, which is what keeps the box from moving.
    expect(container.querySelector("output")).toBe(readout);
    expect(readout).not.toHaveClass("invisible");
    expect(readout).toHaveTextContent("45");
  });

  test("reserves that place exactly once, with no second box standing in beside it", () => {
    // A hidden box holding the readout's place and a readout that is itself always mounted are two ways to
    // reserve the same line, and rendering both reserves two: the extra one is torn down on the first answer
    // and gives its line back, which is the very shift the reservation exists to prevent. Asserted by class
    // rather than by tag, because a stand-in can be any element at all.
    const { container } = render(<Slider {...defaultProps} />);
    const reserved = Array.from(container.querySelectorAll("*")).filter((node) => {
      const classes = node.classList;
      return classes.contains("mb-2") && classes.contains("block") && classes.contains("text-center");
    });

    expect(reserved).toHaveLength(1);
    expect(reserved[0].tagName).toBe("OUTPUT");
    // Nothing hidden from assistive technology is holding a line either, which is how such a stand-in reads.
    expect(container.querySelectorAll('[aria-hidden="true"].invisible')).toHaveLength(0);
  });

  test("adds and removes nothing at all when the first answer arrives", () => {
    // The reservation only holds if the answered tree has the same nodes as the unanswered one. A node that
    // exists in exactly one of the two states moves everything below it the moment the value changes -
    // measured at 30px for one readout line, landing on the track while the respondent is on it.
    const { container, rerender } = render(<Slider {...defaultProps} />);
    const before = Array.from(container.querySelectorAll("*"));

    rerender(<Slider {...defaultProps} value={45} />);

    const after = Array.from(container.querySelectorAll("*"));
    expect(after).toHaveLength(before.length);
    // Same nodes, not merely the same number of them: identity is what keeps the boxes where they were.
    expect(before.every((node) => node.isConnected)).toBe(true);
    expect(after.every((node) => before.includes(node))).toBe(true);
  });

  test("reserves nothing at all when the readout is suppressed", () => {
    const { container } = render(<Slider {...defaultProps} showValue={false} />);

    expect(container.querySelector("output")).toBeNull();
  });

  test("keeps both readout font tokens, which tailwind-merge would collapse", () => {
    // `font-input-weight` reads as another font family to tailwind-merge, so composing these through `cn`
    // silently drops `font-input`. Asserted as whole class names because one token is a substring of the other.
    const { container } = render(<Slider {...defaultProps} value={45} />);
    const classes = Array.from(container.querySelector("output")?.classList ?? []);

    expect(classes).toContain("font-input");
    expect(classes).toContain("font-input-weight");
  });

  test("names a declared variable for the readout colour", () => {
    // `text-input-text` compiles to `color: var(--fb-input-text-color)` with no fallback, and the theme
    // declares no such variable - it declares `--fb-input-color`. The unresolvable reference made the
    // declaration invalid at computed-value time, so the readout inherited the document's black while every
    // other piece of text in the element painted the theme's own colour. Naming both keeps the intent and
    // resolves it, exactly as the stylesheet's own `--fb-input-placeholder-color` does.
    const { container } = render(<Slider {...defaultProps} value={45} />);
    const classes = Array.from(container.querySelector("output")?.classList ?? []);

    expect(classes).toContain("text-[var(--fb-input-text-color,var(--fb-input-color))]");
    expect(classes).not.toContain("text-input-text");
  });

  test("distinguishes answered from unanswered without relying on colour", () => {
    // Under forced colours `bg-brand` and `bg-input-bg` resolve to the same surface, and a slider answered
    // with its own minimum has no visible fill and its handle at the start - so the two states would be
    // identical. A system colour survives the substitution, and a dashed outline is a non-colour cue.
    const { container: unanswered } = render(<Slider {...defaultProps} />);
    expect(getSlot(unanswered, "slider-thumb")).toHaveClass("forced-colors:border-dashed");

    const { container: answered } = render(<Slider {...defaultProps} value={45} />);
    expect(getSlot(answered, "slider-thumb")).toHaveClass("forced-colors:bg-[CanvasText]");
    expect(getSlot(answered, "slider-range")).toHaveClass("forced-colors:bg-[CanvasText]");
  });

  test("hides the readout when showValue is false", () => {
    render(<Slider {...defaultProps} value={45} showValue={false} />);

    expect(screen.queryByText("45")).not.toBeInTheDocument();
  });

  test("shows a value from outside the range as it is, so the respondent can correct it", () => {
    render(<Slider {...defaultProps} value={140} />);

    expect(screen.getByText("140")).toBeInTheDocument();
    // The handle has no position for it, so it is drawn at the nearer bound.
    expect(getThumb()).toHaveAttribute("aria-valuenow", "100");
  });

  // -------------------------------------------------------------------------
  // The numbers handed to the primitive
  // -------------------------------------------------------------------------

  test("publishes the configured bounds in the element's own numbers", () => {
    render(<Slider {...defaultProps} min={10} max={50} value={15} />);

    const thumb = getThumb();
    expect(thumb).toHaveAttribute("aria-valuemin", "10");
    expect(thumb).toHaveAttribute("aria-valuemax", "50");
    expect(thumb).toHaveAttribute("aria-valuenow", "15");
  });

  test("names the control from the headline", () => {
    render(<Slider {...defaultProps} />);

    expect(getThumb()).toHaveAttribute("aria-label", "How satisfied are you?");
  });

  test("advertises the required state on the widget that carries the slider role", () => {
    const { container } = render(<Slider {...defaultProps} required />);

    // The handle is where the role lives, so it is the only element on which assistive technology reads the
    // state; the primitive's root renders a roleless node that would ignore it.
    expect(getThumb()).toHaveAttribute("aria-required", "true");
    expect(getSlot(container, "slider")).not.toHaveAttribute("aria-required");
  });

  test("leaves the required state off an optional control", () => {
    render(<Slider {...defaultProps} />);

    // Absent rather than `false`: an optional control has no required state to report, and publishing one
    // only to deny it is noise assistive technology reads out for nothing.
    expect(getThumb()).not.toHaveAttribute("aria-required");
  });

  test("announces nothing from the roleless element the primitive puts the interaction on", () => {
    // ARIA admits no state or property on an element without a role, so anything declared there is invalid
    // markup that no assistive technology reads. The primitive also sets `aria-disabled` on that node itself,
    // which is why it is passed explicitly as `undefined` rather than merely left unset.
    const { container } = render(<Slider {...defaultProps} required errorMessage="Pick a value" />);
    const root = getSlot(container, "slider");

    expect(root).not.toHaveAttribute("role");
    expect(root).not.toHaveAttribute("aria-required");
    expect(root).not.toHaveAttribute("aria-label");
    expect(root).not.toHaveAttribute("aria-disabled");
  });

  test("keeps the disabled state on the widget with the role, and the styling hook on the root", () => {
    const { container } = render(<Slider {...defaultProps} disabled />);

    expect(getThumb()).toHaveAttribute("aria-disabled", "true");
    expect(getSlot(container, "slider")).not.toHaveAttribute("aria-disabled");
    // `data-disabled` carries no ARIA meaning and is what the disabled styling hangs off, so it stays.
    expect(getSlot(container, "slider")).toHaveAttribute("data-disabled");
  });

  test("leaves the disabled state off an enabled control", () => {
    const { container } = render(<Slider {...defaultProps} />);

    expect(getThumb()).not.toHaveAttribute("aria-disabled");
    expect(getSlot(container, "slider")).not.toHaveAttribute("aria-disabled");
  });

  test("points the handle at the error message and marks it invalid", () => {
    const { container } = render(<Slider {...defaultProps} errorMessage="Pick a value" />);

    const errorId = `${defaultProps.inputId}-error`;
    expect(getThumb()).toHaveAttribute("aria-describedby", errorId);
    expect(getThumb()).toHaveAttribute("aria-invalid", "true");
    // The reference has to resolve, or it announces nothing at all.
    expect(container.querySelector(`#${errorId}`)).toHaveTextContent("Pick a value");
  });

  test("describes nothing while there is no error", () => {
    render(<Slider {...defaultProps} required />);

    expect(getThumb()).not.toHaveAttribute("aria-describedby");
    expect(getThumb()).not.toHaveAttribute("aria-invalid");
  });

  test("ignores a release from a press that began somewhere else", () => {
    // `pointerup` fires on release over the handle however the press started, so a press begun off the control
    // and merely finished over it must not answer the question with the parked position.
    const { container } = render(<Slider {...defaultProps} />);

    fireEvent.pointerUp(getSlot(container, "slider"));

    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  test("still records the parked minimum for a press that did begin on the control", () => {
    const { container } = render(<Slider {...defaultProps} />);
    const root = getSlot(container, "slider");

    fireEvent.pointerDown(root);
    fireEvent.pointerUp(root);

    expect(defaultProps.onChange).toHaveBeenCalledWith(0);
  });

  test("lets one press complete at most one selection", () => {
    const { container } = render(<Slider {...defaultProps} />);
    const root = getSlot(container, "slider");

    fireEvent.pointerDown(root);
    fireEvent.pointerUp(root);
    fireEvent.pointerUp(root);

    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
  });

  test("says the control is unanswered rather than announcing its parked lower bound", () => {
    // The handle has to be drawn somewhere, so an unanswered control parks it at `min` and the role obliges
    // the primitive to publish `min` as the value. Without this a screen-reader user could not tell an
    // untouched control from one deliberately answered with that bound.
    render(<Slider {...defaultProps} min={10} max={50} unansweredLabel="Nothing chosen" />);

    expect(getThumb()).toHaveAttribute("aria-valuenow", "10");
    expect(getThumb()).toHaveAttribute("aria-valuetext", "Nothing chosen");
  });

  test("drops the unanswered announcement once there is a value", () => {
    render(<Slider {...defaultProps} value={45} unansweredLabel="Nothing chosen" />);

    expect(getThumb()).not.toHaveAttribute("aria-valuetext");
    expect(getThumb()).toHaveAttribute("aria-valuenow", "45");
  });

  test("shows the required indicator exactly once", () => {
    // One copy only - the header's visible marker, which assistive technology reads from the document like any
    // other text. A screen-reader-only second copy announced the word twice and said nothing `aria-required`
    // does not say better.
    render(<Slider {...defaultProps} required />);

    expect(screen.getAllByText("Required")).toHaveLength(1);
  });

  test("answers hover, focus and press with rings that never change the handle's geometry", () => {
    // A ring is drawn outside the box, so none of these can move what is under the respondent's pointer. The
    // colour is unconditional so it can never fall back to Tailwind's default blue, and the focus ring is at
    // full opacity because at half opacity over the brand-filled handle it fell below 3:1 contrast.
    const { container } = render(<Slider {...defaultProps} />);
    const thumb = getSlot(container, "slider-thumb");

    expect(thumb).toHaveClass("ring-brand-20");
    expect(thumb).toHaveClass("hover:ring-2");
    expect(thumb).toHaveClass("focus-visible:ring-ring", "focus-visible:ring-[3px]");
    expect(thumb).toHaveClass("focus-visible:ring-offset-2", "focus-visible:ring-offset-input-bg");
    expect(thumb).not.toHaveClass("focus-visible:ring-ring/50");
    expect(thumb).toHaveClass("active:ring-[5px]", "active:cursor-grabbing");
  });

  test("announces the headline as plain text, never as the markup it is stored as", () => {
    // The headline is authored with a rich-text editor and stored as markup. An accessible name is a plain
    // string read out verbatim, so the markup has to come off first - and a headline carrying a script must
    // not have its source read aloud.
    const richHeadline = '<p><b>How <i>likely</i></b> are you?</p><script>alert("xss")</script>';

    render(<Slider {...defaultProps} headline={richHeadline} />);

    const name = getThumb().getAttribute("aria-label") ?? "";
    expect(name).toBe("How likely are you?");
    for (const forbidden of ["<", ">", "script", "alert", "<p", "<b"]) {
      expect(name).not.toContain(forbidden);
    }
  });

  test("joins a multi-line headline with a space rather than running the words together", () => {
    render(<Slider {...defaultProps} headline="<p>First line</p><p>second line</p>" />);

    expect(getThumb()).toHaveAttribute("aria-label", "First line second line");
  });

  test("publishes no name at all for a headline carrying no readable text", () => {
    render(<Slider {...defaultProps} headline="<p></p>" />);

    expect(getThumb()).not.toHaveAttribute("aria-label");
  });

  // -------------------------------------------------------------------------
  // The grid: every reported value is a point of `min + n * step`
  // -------------------------------------------------------------------------

  test("moves by one step per arrow key", () => {
    render(<Slider {...defaultProps} />);

    pressKey("ArrowRight");

    expect(defaultProps.onChange).toHaveBeenCalledWith(5);
  });

  test("measures the grid from the lower bound rather than from zero", () => {
    render(<Slider {...defaultProps} min={10} max={50} step={5} />);

    pressKey("ArrowRight");

    expect(defaultProps.onChange).toHaveBeenCalledWith(15);
  });

  test("reports a decimal grid point without floating-point drift", () => {
    render(<Slider {...defaultProps} min={0} max={1} step={0.1} value={0.2} />);

    pressKey("ArrowRight");

    expect(defaultProps.onChange).toHaveBeenCalledWith(0.3);
  });

  test("stays on the grid when the origin carries more decimals than the step", () => {
    // The case the offset-space conversion exists for: driven in its own numbers the primitive would round
    // this grid to whole numbers, none of which the shared step-grid rule accepts as an answer.
    render(<Slider {...defaultProps} min={10.5} max={20.5} step={1} />);

    pressKey("ArrowRight");

    expect(defaultProps.onChange).toHaveBeenCalledWith(11.5);
  });

  test("keeps advancing one step at a time on such a grid", () => {
    render(<Slider {...defaultProps} min={10.5} max={20.5} step={1} value={11.5} />);

    pressKey("ArrowRight");

    expect(defaultProps.onChange).toHaveBeenCalledWith(12.5);
  });

  test("jumps by ten steps on a page key", () => {
    render(<Slider {...defaultProps} />);

    pressKey("PageUp");

    expect(defaultProps.onChange).toHaveBeenCalledWith(50);
  });

  test("selects the upper bound on End", () => {
    render(<Slider {...defaultProps} />);

    pressKey("End");

    expect(defaultProps.onChange).toHaveBeenCalledWith(100);
  });

  test("falls back to a unit grid when the configuration describes none", () => {
    // A draft an author is still typing can reach the runtime with a step of zero, which the primitive would
    // otherwise divide by.
    render(<Slider {...defaultProps} step={0} />);

    pressKey("ArrowRight");

    expect(defaultProps.onChange).toHaveBeenCalledWith(1);
  });

  // -------------------------------------------------------------------------
  // Recording an answer
  // -------------------------------------------------------------------------

  test("emits nothing on mount", () => {
    render(<Slider {...defaultProps} />);

    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  test("emits nothing when re-rendered with a new value", () => {
    const { rerender } = render(<Slider {...defaultProps} />);

    rerender(<Slider {...defaultProps} value={25} />);

    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  test("reports a number, not a string", () => {
    render(<Slider {...defaultProps} />);

    pressKey("ArrowRight");

    expect(typeof defaultProps.onChange.mock.calls[0][0]).toBe("number");
  });

  test("records the minimum of an unanswered control, which the primitive itself never reports", () => {
    // The handle is parked at the minimum while unanswered, so the primitive sees no change and stays
    // silent. Without this a required slider could not be answered with its own lowest value.
    render(<Slider {...defaultProps} />);

    pressKey("Home");

    expect(defaultProps.onChange).toHaveBeenCalledWith(0);
  });

  test("records that minimum only once", () => {
    render(<Slider {...defaultProps} />);

    pressKey("Home");

    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
  });

  test("reports an answered control once per key press", () => {
    render(<Slider {...defaultProps} value={50} />);

    pressKey("ArrowLeft");

    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(45);
  });

  test("reports a negative value on a range spanning zero", () => {
    render(<Slider {...defaultProps} min={-50} max={50} step={25} value={0} />);

    pressKey("ArrowLeft");

    expect(defaultProps.onChange).toHaveBeenCalledWith(-25);
  });

  // -------------------------------------------------------------------------
  // The answered and unanswered states
  // -------------------------------------------------------------------------

  test("fills the handle once the control is answered", () => {
    const { container } = render(<Slider {...defaultProps} value={50} />);

    expect(getSlot(container, "slider-thumb")).toHaveClass("bg-brand");
  });

  test("leaves the handle unfilled while the control is unanswered", () => {
    const { container } = render(<Slider {...defaultProps} />);

    const thumb = getSlot(container, "slider-thumb");
    expect(thumb).toHaveClass("bg-input-bg");
    expect(thumb).not.toHaveClass("bg-brand");
  });

  // -------------------------------------------------------------------------
  // Disabled state
  // -------------------------------------------------------------------------

  test("does not call onChange when disabled", () => {
    render(<Slider {...defaultProps} disabled />);

    pressKey("ArrowRight");

    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  test("shows the disabled treatment", () => {
    const { container } = render(<Slider {...defaultProps} disabled />);

    expect(getSlot(container, "slider")).toHaveClass("cursor-not-allowed", "opacity-50");
  });

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  test("renders error message when provided", () => {
    render(<Slider {...defaultProps} errorMessage="Please pick a value" />);

    expect(screen.getByText("Please pick a value")).toBeInTheDocument();
  });

  test("does not render error when no error message", () => {
    render(<Slider {...defaultProps} />);

    expect(screen.queryByText("Please pick a value")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Scale labels
  // -------------------------------------------------------------------------

  test("renders lower and upper labels", () => {
    render(<Slider {...defaultProps} lowerLabel="Not at all" upperLabel="Very much" />);

    expect(screen.getByText("Not at all")).toBeInTheDocument();
    expect(screen.getByText("Very much")).toBeInTheDocument();
  });

  test("renders only the lower label when the upper one is not provided", () => {
    render(<Slider {...defaultProps} lowerLabel="Not at all" />);

    expect(screen.getByText("Not at all")).toBeInTheDocument();
    expect(screen.queryByText("Very much")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Direction and the required indicator
  // -------------------------------------------------------------------------

  test("applies RTL direction when dir is rtl", () => {
    const { container } = render(<Slider {...defaultProps} dir="rtl" />);

    expect(container.querySelector("#test-slider")).toHaveAttribute("dir", "rtl");
    expect(getSlot(container, "slider")).toHaveAttribute("dir", "rtl");
  });

  test("lets the primitive inherit the direction when dir is auto", () => {
    // The primitive understands only "ltr" and "rtl", so "auto" must not reach it as a literal.
    const { container } = render(<Slider {...defaultProps} dir="auto" />);

    expect(getSlot(container, "slider")).not.toHaveAttribute("dir", "auto");
  });

  test("shows required indicator when required is true", () => {
    render(<Slider {...defaultProps} required requiredLabel="Required" />);

    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  test("shows a custom required label", () => {
    render(<Slider {...defaultProps} required requiredLabel="Obligatorisch" />);

    expect(screen.getByText("Obligatorisch")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Labelling: the question's own text, and the control the browser binds it to
  // -------------------------------------------------------------------------

  test("renders no label element, because the only target it could name is not labelable", () => {
    // HTML lets a `for` reference only a labelable control, and the primitive's root is a `span`. Pointing at
    // it resolved to nothing - `label.control` was null and the browser reported the reference as incorrect -
    // so the header renders its text as plain spans instead, with the accessible name on the handle.
    const { container } = render(
      <Slider {...defaultProps} description="Drag the handle to pick a value" required />
    );

    expect(container.querySelectorAll("label")).toHaveLength(0);
    expect(container.querySelectorAll("[for]")).toHaveLength(1);
    // The one remaining `for` is the readout's, where the attribute lists the elements a value was computed
    // from rather than naming a control - valid on any element, and not a label association at all.
    expect(container.querySelector("output")).toHaveAttribute("for", "test-slider-input");
    expect(getThumb()).toHaveAttribute("aria-label", "How satisfied are you?");
  });

  test("focuses the handle when the question's own text is activated", () => {
    // The behaviour a working label would have supplied. The handle is the destination because it is the
    // element that carries the role, the value and the focus.
    render(<Slider {...defaultProps} description="Drag the handle to pick a value" />);

    fireEvent.click(screen.getByText("How satisfied are you?"));
    expect(getThumb()).toHaveFocus();
  });

  test("focuses the handle when the description is activated", () => {
    render(<Slider {...defaultProps} description="Drag the handle to pick a value" />);

    fireEvent.click(screen.getByText("Drag the handle to pick a value"));
    expect(getThumb()).toHaveFocus();
  });

  test("does not move focus into a disabled control", () => {
    render(<Slider {...defaultProps} disabled />);

    fireEvent.click(screen.getByText("How satisfied are you?"));
    expect(getThumb()).not.toHaveFocus();
  });

  test("names the hidden input the primitive contributes to a surrounding form", () => {
    // The primitive mirrors its value into a hidden input whenever it sits inside a form - which it always
    // does in the survey runtime. Unnamed, that input is a form field the browser reports as unidentifiable
    // and no consumer can read; the control's own id is the stable name for it.
    const { container } = render(
      <form>
        <Slider {...defaultProps} value={45} />
      </form>
    );
    const hidden = container.querySelector<HTMLInputElement>('input[style*="display: none"]');

    expect(hidden).not.toBeNull();
    expect(hidden).toHaveAttribute("name", "test-slider-input");
  });

  // -------------------------------------------------------------------------
  // Error announcement, focus visibility and pointer targets
  // -------------------------------------------------------------------------

  test("announces the error as soon as it appears", () => {
    // Submitting leaves focus on the submit button, so without a live region the message is inserted in
    // silence and a respondent using a screen reader is told nothing at all. The container is mounted only
    // while there is a message, so its insertion is the announcement.
    render(<Slider {...defaultProps} required errorMessage="Please pick a value" />);
    const alert = screen.getByRole("alert");

    expect(alert).toHaveAttribute("id", "test-slider-input-error");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveAttribute("aria-atomic", "true");
    expect(alert).toHaveTextContent("Please pick a value");
    // Still reachable on demand from the control itself, for a respondent who arrives at it later.
    expect(getThumb()).toHaveAttribute("aria-describedby", "test-slider-input-error");
  });

  test("declares no live region while there is nothing to announce", () => {
    render(<Slider {...defaultProps} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("keeps a focus indicator in forced colours, where a ring cannot paint", () => {
    // Forced colours suppress box shadows, so the three rings the handle uses disappear; `outline-none` left
    // nothing behind them and a focused handle became indistinguishable from an unfocused one. This utility
    // suppresses the browser's own indicator in normal colours and declares an outline for forced colours to
    // repaint, so exactly one indicator is visible in either rendering.
    const { container } = render(<Slider {...defaultProps} />);
    const thumb = getSlot(container, "slider-thumb");

    expect(thumb).toHaveClass("focus-visible:outline-hidden");
    expect(thumb).not.toHaveClass("outline-none");
  });

  test("extends the pointer target of the handle and the rail beyond what they paint", () => {
    // 20px of handle and 8px of rail are both far under the 44px a fingertip needs. A transparent
    // pseudo-element is hit tested as part of the element that owns it and sits out of flow, so it enlarges
    // the target without moving the layout or painting anything: 20px + 12px on each side, and 8px + 18px
    // above and below, are 44px each.
    const { container } = render(<Slider {...defaultProps} />);

    expect(getSlot(container, "slider-thumb")).toHaveClass(
      "before:absolute",
      "before:-inset-3",
      "before:content-['']"
    );
    expect(getSlot(container, "slider")).toHaveClass(
      "before:absolute",
      "before:inset-x-0",
      "before:-inset-y-[18px]",
      "before:content-['']"
    );
  });
});
