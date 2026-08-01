// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Slider } from "../slider";

// ---------------------------------------------------------------------------
// Shared default props — `onChange` is cleared before every test.
// ---------------------------------------------------------------------------

const defaultProps = {
  elementId: "test-slider",
  headline: "How satisfied are you?",
  inputId: "test-slider-input",
  min: 0,
  max: 100,
  step: 5,
  onChange: vi.fn(),
};

// Locates the primitive's root - the element a track press lands on. It carries no role of its own, so it
// is reached through its data-slot hook, and a missing root fails loudly instead of being asserted away.
const getSliderRoot = (container: HTMLElement): Element => {
  const root = container.querySelector('[data-slot="slider"]');
  if (!root) {
    throw new Error('no element with data-slot="slider" was rendered');
  }
  return root;
};

describe("Slider", () => {
  beforeEach(() => {
    defaultProps.onChange.mockClear();
  });

  // -------------------------------------------------------------------------
  // Rendering tests
  // -------------------------------------------------------------------------

  test("renders a single slider control with the headline", () => {
    render(<Slider {...defaultProps} />);
    expect(screen.getByText("How satisfied are you?")).toBeInTheDocument();
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  test("renders headline text", () => {
    render(<Slider {...defaultProps} headline="Rate your experience" />);
    expect(screen.getByText("Rate your experience")).toBeInTheDocument();
  });

  test("renders description when provided", () => {
    render(<Slider {...defaultProps} description="Slide to choose a value" />);
    expect(screen.getByText("Slide to choose a value")).toBeInTheDocument();
  });

  test("does not render description when not provided", () => {
    render(<Slider {...defaultProps} />);
    expect(screen.queryByText("Slide to choose a value")).toBeNull();
  });

  test("renders the track, range and thumb composition", () => {
    const { container } = render(<Slider {...defaultProps} />);
    expect(container.querySelector('[data-slot="slider-track"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="slider-range"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-slot="slider-thumb"]')).toHaveLength(1);
  });

  test("applies the element id to the wrapper", () => {
    const { container } = render(<Slider {...defaultProps} />);
    const rootDiv = container.firstChild as HTMLElement;
    expect(rootDiv).toHaveAttribute("id", "test-slider");
  });

  // -------------------------------------------------------------------------
  // Range reflection tests — the thumb is the element carrying role="slider"
  // and the ARIA value attributes, whose values are always strings
  // -------------------------------------------------------------------------

  test("reflects the configured minimum and maximum on the thumb", () => {
    render(<Slider {...defaultProps} />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuemin", "0");
    expect(thumb).toHaveAttribute("aria-valuemax", "100");
  });

  test("reflects the selected value as aria-valuenow", () => {
    render(<Slider {...defaultProps} value={50} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "50");
  });

  test("reflects a range that does not start at zero", () => {
    render(<Slider {...defaultProps} min={10} max={50} value={15} />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuemin", "10");
    expect(thumb).toHaveAttribute("aria-valuemax", "50");
    expect(thumb).toHaveAttribute("aria-valuenow", "15");
  });

  test("clamps a value above the maximum", () => {
    render(<Slider {...defaultProps} value={150} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "100");
  });

  test("clamps a value below the minimum", () => {
    render(<Slider {...defaultProps} value={-20} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "0");
  });

  // -------------------------------------------------------------------------
  // Unanswered state tests — the response value must stay undefined until the
  // respondent acts, because downstream required-field validation counts a
  // numeric 0 as a real answer
  // -------------------------------------------------------------------------

  test("parks the thumb at the minimum and emits nothing while unanswered", () => {
    render(<Slider {...defaultProps} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "0");
    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  test("parks the thumb at a non-zero minimum while unanswered", () => {
    render(<Slider {...defaultProps} min={10} max={50} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "10");
    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  test("distinguishes an unanswered thumb from one answered with the minimum", () => {
    const { unmount } = render(<Slider {...defaultProps} />);
    // The unanswered thumb takes the input background, so a slider whose min
    // is 0 never looks identical to one genuinely answered with 0
    const unansweredThumb = screen.getByRole("slider");
    expect(unansweredThumb).toHaveClass("bg-input-bg");
    expect(unansweredThumb).not.toHaveClass("bg-brand");
    unmount();
    render(<Slider {...defaultProps} value={0} />);
    expect(screen.getByRole("slider")).toHaveClass("bg-brand");
  });

  // -------------------------------------------------------------------------
  // Selected-value readout tests — a native <output> bound to the control,
  // rendered only when showValue is on and a value is present
  // -------------------------------------------------------------------------

  test("renders the readout for the selected value by default", () => {
    const { container } = render(<Slider {...defaultProps} value={50} />);
    expect(container.querySelector("output")).not.toBeNull();
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  test("binds the readout to the slider control", () => {
    const { container } = render(<Slider {...defaultProps} value={50} />);
    const readout = container.querySelector("output");
    expect(readout).toHaveAttribute("for", "test-slider-input");
    // The target has to be the element that owns the value, which is the one
    // carrying role="slider"
    expect(document.getElementById("test-slider-input")).toBe(screen.getByRole("slider"));
  });

  test("does not render the readout when showValue is false", () => {
    const { container } = render(<Slider {...defaultProps} value={50} showValue={false} />);
    expect(container.querySelector("output")).toBeNull();
    expect(screen.queryByText("50")).toBeNull();
  });

  test("does not render the readout while unanswered", () => {
    const { container } = render(<Slider {...defaultProps} />);
    expect(container.querySelector("output")).toBeNull();
  });

  test("shows the clamped value in the readout", () => {
    const { container } = render(<Slider {...defaultProps} value={150} />);
    const readout = container.querySelector("output");
    expect(readout).toHaveTextContent("100");
  });

  test("shows the value clamped up to the minimum in the readout", () => {
    const { container } = render(<Slider {...defaultProps} value={-20} />);
    const readout = container.querySelector("output");
    // Anchored so the assertion cannot be satisfied by a "0" inside another number
    expect(readout).toHaveTextContent(/^0$/);
  });

  // -------------------------------------------------------------------------
  // Value selection tests — the primitive owns the keyboard contract, so the
  // wrapper is exercised through it rather than through a pointer drag, whose
  // layout measurements are unavailable in this environment
  // -------------------------------------------------------------------------

  test("calls onChange with the next on-grid value on ArrowRight", () => {
    render(<Slider {...defaultProps} value={50} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(55);
  });

  test("calls onChange with the previous on-grid value on ArrowLeft", () => {
    render(<Slider {...defaultProps} value={50} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowLeft" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(45);
  });

  test("calls onChange with the minimum on Home", () => {
    render(<Slider {...defaultProps} value={50} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(0);
  });

  test("calls onChange with the maximum on End", () => {
    render(<Slider {...defaultProps} value={50} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(100);
  });

  test("emits the first on-grid step when moved from the unanswered state", () => {
    render(<Slider {...defaultProps} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(5);
  });

  test("moves by a custom step", () => {
    render(<Slider {...defaultProps} step={10} value={50} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(60);
  });

  // -------------------------------------------------------------------------
  // Selecting the minimum from the unanswered state
  //
  // An unanswered control parks its thumb at `min`, and the primitive reports a
  // change only when the next value differs from the one it holds, so every
  // interaction that resolves to `min` is suppressed. These tests cover the
  // recovery that makes the minimum — the value a range starting at 0 needs
  // most — directly selectable, and prove it never emits twice.
  // -------------------------------------------------------------------------

  test("commits the parked minimum on a first pointer press", () => {
    const { container } = render(<Slider {...defaultProps} />);
    const root = getSliderRoot(container);
    fireEvent.pointerDown(root, { pointerId: 1 });
    fireEvent.pointerUp(root, { pointerId: 1 });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(0);
  });

  test("commits the parked minimum on a first press of the thumb itself", () => {
    render(<Slider {...defaultProps} />);
    const thumb = screen.getByRole("slider");
    fireEvent.pointerDown(thumb, { pointerId: 1 });
    fireEvent.pointerUp(thumb, { pointerId: 1 });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(0);
  });

  test("commits the parked minimum on a first touch press", () => {
    const { container } = render(<Slider {...defaultProps} />);
    const root = getSliderRoot(container);
    fireEvent.pointerDown(root, { pointerId: 1, pointerType: "touch" });
    fireEvent.pointerUp(root, { pointerId: 1, pointerType: "touch" });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(0);
  });

  test("commits a non-zero minimum on a first pointer press", () => {
    const { container } = render(<Slider {...defaultProps} min={10} max={50} />);
    const root = getSliderRoot(container);
    fireEvent.pointerDown(root, { pointerId: 1 });
    fireEvent.pointerUp(root, { pointerId: 1 });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(10);
  });

  test("commits the parked minimum on Home", () => {
    render(<Slider {...defaultProps} />);
    const thumb = screen.getByRole("slider");
    fireEvent.keyDown(thumb, { key: "Home" });
    fireEvent.keyUp(thumb, { key: "Home" });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(0);
  });

  test("commits the parked minimum on a backward arrow key", () => {
    render(<Slider {...defaultProps} />);
    const thumb = screen.getByRole("slider");
    fireEvent.keyDown(thumb, { key: "ArrowLeft" });
    fireEvent.keyUp(thumb, { key: "ArrowLeft" });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(0);
  });

  test("commits the parked minimum on PageDown", () => {
    render(<Slider {...defaultProps} />);
    const thumb = screen.getByRole("slider");
    fireEvent.keyDown(thumb, { key: "PageDown" });
    fireEvent.keyUp(thumb, { key: "PageDown" });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(0);
  });

  test("commits the parked minimum on the backward arrow key in RTL", () => {
    // The primitive decides which arrow moves backward, so the recovery is
    // driven by what it reported rather than by the key itself
    render(<Slider {...defaultProps} dir="rtl" />);
    const thumb = screen.getByRole("slider");
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    fireEvent.keyUp(thumb, { key: "ArrowRight" });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(0);
  });

  test("does not emit twice when the interaction already reported a value", () => {
    render(<Slider {...defaultProps} />);
    const thumb = screen.getByRole("slider");
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    fireEvent.keyUp(thumb, { key: "ArrowRight" });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(5);
  });

  test("does not re-emit a control already answered with the minimum", () => {
    // The recovery exists only for the unanswered state: once the value is
    // present the primitive is authoritative, so a press that resolves to the
    // value it already holds reports nothing and nothing is committed either
    const { container } = render(<Slider {...defaultProps} value={0} />);
    const root = getSliderRoot(container);
    const thumb = screen.getByRole("slider");
    fireEvent.pointerDown(root, { pointerId: 1 });
    fireEvent.pointerUp(root, { pointerId: 1 });
    fireEvent.keyDown(thumb, { key: "ArrowLeft" });
    fireEvent.keyUp(thumb, { key: "ArrowLeft" });
    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  test("does not commit the minimum for a key the control does not act on", () => {
    render(<Slider {...defaultProps} />);
    const thumb = screen.getByRole("slider");
    fireEvent.keyDown(thumb, { key: "Tab" });
    fireEvent.keyUp(thumb, { key: "Tab" });
    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Disabled state tests
  // -------------------------------------------------------------------------

  test("does not call onChange when disabled", () => {
    render(<Slider {...defaultProps} value={50} disabled />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  test("advertises the drag affordance while enabled", () => {
    const { container } = render(<Slider {...defaultProps} />);
    const root = getSliderRoot(container);
    const thumb = screen.getByRole("slider");
    // A press on the track jumps the value, so the control is pointer-interactive
    expect(root).toHaveClass("cursor-pointer");
    // The thumb is draggable, and the halo widens from hover to drag
    expect(thumb).toHaveClass("cursor-grab");
    expect(thumb).toHaveClass("active:cursor-grabbing");
    expect(thumb).toHaveClass("hover:ring-2");
    expect(thumb).toHaveClass("hover:ring-brand-20");
    expect(thumb).toHaveClass("active:ring-4");
  });

  test("withdraws the drag affordance while disabled", () => {
    const { container } = render(<Slider {...defaultProps} disabled />);
    const root = getSliderRoot(container);
    const thumb = screen.getByRole("slider");
    expect(root).toHaveClass("cursor-not-allowed");
    expect(root).toHaveClass("opacity-50");
    expect(root).not.toHaveClass("cursor-pointer");
    expect(thumb).toHaveClass("cursor-not-allowed");
    expect(thumb).not.toHaveClass("cursor-grab");
    expect(thumb).not.toHaveClass("hover:ring-2");
    // The dimming lives on the root, so the thumb is never dimmed twice
    expect(thumb).not.toHaveClass("opacity-50");
  });

  test("keeps the answered and unanswered thumb fills through the affordances", () => {
    const { unmount } = render(<Slider {...defaultProps} />);
    expect(screen.getByRole("slider")).toHaveClass("bg-input-bg");
    unmount();
    render(<Slider {...defaultProps} value={50} />);
    expect(screen.getByRole("slider")).toHaveClass("bg-brand");
  });

  test("does not commit the parked minimum when disabled", () => {
    const { container } = render(<Slider {...defaultProps} disabled />);
    const root = getSliderRoot(container);
    const thumb = screen.getByRole("slider");
    fireEvent.pointerDown(root, { pointerId: 1 });
    fireEvent.pointerUp(root, { pointerId: 1 });
    fireEvent.keyDown(thumb, { key: "Home" });
    fireEvent.keyUp(thumb, { key: "Home" });
    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  test("marks the control disabled for assistive technology", () => {
    const { container } = render(<Slider {...defaultProps} disabled />);
    const root = container.querySelector('[data-slot="slider"]');
    expect(root).toHaveAttribute("aria-disabled", "true");
    // The state has to reach the element that carries role="slider", because the
    // primitive's root is a role-less span
    expect(screen.getByRole("slider")).toHaveAttribute("aria-disabled", "true");
  });

  test("is not disabled by default", () => {
    const { container } = render(<Slider {...defaultProps} />);
    const root = container.querySelector('[data-slot="slider"]');
    expect(root).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-disabled", "false");
  });

  // -------------------------------------------------------------------------
  // Label tests
  // -------------------------------------------------------------------------

  test("renders lower and upper labels", () => {
    render(<Slider {...defaultProps} lowerLabel="Not at all" upperLabel="Very much" />);
    expect(screen.getByText("Not at all")).toBeInTheDocument();
    expect(screen.getByText("Very much")).toBeInTheDocument();
  });

  test("does not render labels section when neither label is provided", () => {
    render(<Slider {...defaultProps} />);
    expect(screen.queryByText("Not at all")).toBeNull();
    expect(screen.queryByText("Very much")).toBeNull();
  });

  test("renders only lower label when upper is not provided", () => {
    render(<Slider {...defaultProps} lowerLabel="Not at all" />);
    expect(screen.getByText("Not at all")).toBeInTheDocument();
    expect(screen.queryByText("Very much")).toBeNull();
  });

  test("renders only upper label when lower is not provided", () => {
    render(<Slider {...defaultProps} upperLabel="Very much" />);
    expect(screen.getByText("Very much")).toBeInTheDocument();
    expect(screen.queryByText("Not at all")).toBeNull();
  });

  test("anchors an upper-only label to the end of the row", () => {
    render(<Slider {...defaultProps} upperLabel="Very much" />);
    // Without a sibling to separate it from, `justify-between` would leave the upper label at the start,
    // so it pushes itself into the end slot with logical properties that survive a direction flip
    const upper = screen.getByText("Very much");
    expect(upper).toHaveClass("ms-auto");
    expect(upper).toHaveClass("text-end");
  });

  test("keeps the lower label at the start of the row", () => {
    render(<Slider {...defaultProps} lowerLabel="Not at all" upperLabel="Very much" />);
    const lower = screen.getByText("Not at all");
    expect(lower).not.toHaveClass("ms-auto");
    expect(lower).not.toHaveClass("text-end");
  });

  // -------------------------------------------------------------------------
  // Error message tests
  // -------------------------------------------------------------------------

  test("renders error message when provided", () => {
    render(<Slider {...defaultProps} errorMessage="Please pick a value" />);
    expect(screen.getByText("Please pick a value")).toBeInTheDocument();
  });

  test("does not render error when no error message", () => {
    render(<Slider {...defaultProps} />);
    expect(screen.queryByText("Please pick a value")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // RTL support
  // -------------------------------------------------------------------------

  test("applies RTL direction when dir is rtl", () => {
    const { container } = render(<Slider {...defaultProps} dir="rtl" />);
    const rootDiv = container.firstChild as HTMLElement;
    expect(rootDiv).toHaveAttribute("dir", "rtl");
  });

  test("passes RTL direction through to the slider control", () => {
    const { container } = render(<Slider {...defaultProps} dir="rtl" />);
    const root = container.querySelector('[data-slot="slider"]');
    expect(root).toHaveAttribute("dir", "rtl");
  });

  // -------------------------------------------------------------------------
  // Required indicator
  // -------------------------------------------------------------------------

  test("shows required indicator when required is true", () => {
    render(<Slider {...defaultProps} required />);
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  test("shows a custom required label when provided", () => {
    render(<Slider {...defaultProps} required requiredLabel="Obligatorio" />);
    expect(screen.getByText("Obligatorio")).toBeInTheDocument();
  });

  test("does not show the required indicator by default", () => {
    render(<Slider {...defaultProps} />);
    expect(screen.queryByText("Required")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Accessibility wiring — the primitive renders its root as a role-less span
  // and puts role="slider" on the thumb, so the control's identity, name and
  // state are asserted on the role-bearing element
  // -------------------------------------------------------------------------

  test("exposes the headline as the accessible name of the control", () => {
    render(<Slider {...defaultProps} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-label", "How satisfied are you?");
  });

  test("puts the control id on the role-bearing element", () => {
    render(<Slider {...defaultProps} />);
    expect(screen.getByRole("slider")).toHaveAttribute("id", "test-slider-input");
  });

  test("does not label the control with an element that cannot be labelled", () => {
    const { container } = render(<Slider {...defaultProps} description="Slide to choose a value" />);
    // The primitive's root is a span, so the header renders its headline and
    // description as plain text instead of as labels bound to an element no
    // label can address; the control carries its own accessible name instead
    expect(container.querySelector("label")).toBeNull();
    expect(screen.getByText("How satisfied are you?")).toBeInTheDocument();
    expect(screen.getByText("Slide to choose a value")).toBeInTheDocument();
    expect(screen.getByRole("slider")).toHaveAttribute("aria-label", "How satisfied are you?");
  });

  test("omits aria-required, which ARIA does not define for the slider role", () => {
    render(<Slider {...defaultProps} required />);
    const thumb = screen.getByRole("slider");
    expect(thumb).not.toHaveAttribute("aria-required");
    // Required-ness is carried by the marker the header renders instead
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  test("marks the control invalid and points it at the error message", () => {
    render(<Slider {...defaultProps} errorMessage="Please pick a value" />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-invalid", "true");
    expect(thumb).toHaveAttribute("aria-describedby", "test-slider-input-error");
    const description = document.getElementById("test-slider-input-error");
    expect(description).not.toBeNull();
    expect(description).toHaveTextContent("Please pick a value");
  });

  test("reports a valid control and describes nothing when there is no error", () => {
    render(<Slider {...defaultProps} />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-invalid", "false");
    expect(thumb).not.toHaveAttribute("aria-describedby");
    expect(document.getElementById("test-slider-input-error")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Non-finite input regression tests
  //
  // The element schema rejects a non-finite bound, step or answer, so none of
  // these shapes can reach a respondent through a saved survey. They are
  // covered here because this component is also rendered from props it cannot
  // vouch for — an editor preview of a half-configured element, or any direct
  // consumer of the component library — and because the primitive derives the
  // thumb offset and the aria-value* attributes arithmetically, so a single
  // non-finite input would otherwise propagate into the DOM and leave an
  // inoperable control rather than a degraded one.
  // -------------------------------------------------------------------------

  test.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["NaN", Number.NaN],
  ])("treats a %s value as unanswered rather than as an answer", (_label, value) => {
    render(<Slider {...defaultProps} value={value} />);
    const thumb = screen.getByRole("slider");
    // Parked at the minimum and left unfilled, exactly as with no value at all
    expect(thumb).toHaveAttribute("aria-valuenow", "0");
    expect(thumb).toHaveClass("bg-input-bg");
    expect(thumb).not.toHaveClass("bg-brand");
  });

  test.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["NaN", Number.NaN],
  ])("suppresses the readout for a %s value", (_label, value) => {
    const { container } = render(<Slider {...defaultProps} value={value} />);
    expect(container.querySelector("output")).toBeNull();
  });

  test("degrades a non-finite minimum to a finite lower bound", () => {
    render(<Slider {...defaultProps} min={Number.NaN} value={50} />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuemin", "0");
    expect(thumb).toHaveAttribute("aria-valuemax", "100");
    expect(thumb).toHaveAttribute("aria-valuenow", "50");
  });

  test("degrades a non-finite maximum to a finite upper bound above the minimum", () => {
    render(<Slider {...defaultProps} max={Number.POSITIVE_INFINITY} />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuemin", "0");
    expect(thumb).toHaveAttribute("aria-valuemax", "1");
  });

  test("degrades an inverted range to an ordered one", () => {
    render(<Slider {...defaultProps} min={100} max={0} />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuemin", "100");
    expect(thumb).toHaveAttribute("aria-valuemax", "101");
  });

  test.each([
    ["NaN", Number.NaN],
    ["zero", 0],
    ["negative", -5],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("degrades a %s step to a usable increment", (_label, step) => {
    render(<Slider {...defaultProps} step={step} value={50} />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuemin", "0");
    expect(thumb).toHaveAttribute("aria-valuemax", "100");
    expect(thumb).toHaveAttribute("aria-valuenow", "50");
  });

  test("never renders NaN into the markup, whatever the props", () => {
    const { container } = render(
      <Slider
        {...defaultProps}
        min={Number.NaN}
        max={Number.NaN}
        step={Number.NaN}
        value={Number.NaN}
        lowerLabel="Low"
        upperLabel="High"
      />
    );
    expect(container.innerHTML).not.toContain("NaN");
    expect(container.innerHTML).not.toContain("Infinity");
    // and the control is still present and announceable
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  test("keeps the control operable and only ever emits finite numbers", () => {
    render(<Slider {...defaultProps} min={Number.NaN} max={Number.NaN} step={Number.NaN} value={0} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    // Whether or not the pathological configuration produces a change, nothing
    // non-finite may ever reach the response contract
    for (const call of defaultProps.onChange.mock.calls) {
      expect(Number.isFinite(call[0])).toBe(true);
    }
  });

  test("still emits a finite number for a normal configuration", () => {
    render(<Slider {...defaultProps} value={50} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(55);
    expect(Number.isFinite(defaultProps.onChange.mock.calls[0][0])).toBe(true);
  });
});
