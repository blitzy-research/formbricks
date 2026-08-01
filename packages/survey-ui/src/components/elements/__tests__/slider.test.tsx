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

// Independent grid check, deliberately written the way the shared response validator decides grid
// membership rather than by reusing the component's own arithmetic: value, origin and step are scaled to
// integers by their shared decimal scale and compared with integer remainders, because `%` is unusable on
// decimals - `(0.9 - 0) % 0.3` evaluates to 0.29999999999999993.
const isOnGrid = (value: number, min: number, step: number): boolean => {
  const decimals = Math.max(
    ...[value, min, step].map((operand) => (String(operand).split(".")[1] ?? "").length)
  );
  const scale = 10 ** decimals;
  return (Math.round(value * scale) - Math.round(min * scale)) % Math.round(step * scale) === 0;
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

// ===========================================================================
// Slider component tests
// ===========================================================================

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
  // Grid alignment
  //
  // The primitive rounds a movement to the nearest step and then clamps the
  // result into [min, max], so a span that is not a whole number of steps lets
  // that clamp land between grid points: 0 to 100 by 40 reports 100 while the
  // grid is 0, 40 and 80. The shared response validator rejects such a value
  // because (100 - 0) / 40 is not an integer, so the control must reposition
  // every emitted value onto the grid before it reaches the response.
  // -------------------------------------------------------------------------

  test("emits the last grid point rather than the maximum on End when the span is not divisible", () => {
    render(<Slider {...defaultProps} step={40} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(80);
    expect(defaultProps.onChange).not.toHaveBeenCalledWith(100);
  });

  test("emits the last grid point rather than the maximum on a page-key jump", () => {
    render(<Slider {...defaultProps} step={40} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "PageUp" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(80);
    expect(defaultProps.onChange).not.toHaveBeenCalledWith(100);
  });

  test("holds an arrow key at the last grid point instead of stepping past it", () => {
    render(<Slider {...defaultProps} step={40} value={80} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    // The clamped value maps back onto the grid point already held, so the response is left alone
    expect(defaultProps.onChange).not.toHaveBeenCalledWith(100);
    for (const [emitted] of defaultProps.onChange.mock.calls) {
      expect(emitted).toBe(80);
    }
  });

  test("emits the last grid point when a pointer press lands at the maximum", () => {
    const { container } = render(<Slider {...defaultProps} step={40} />);
    const root = getSliderRoot(container);
    // The environment reports a zero-sized rect, so the primitive's pointer arithmetic needs a real one
    // before a press at the far right can resolve to the maximum
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      width: 100,
      height: 8,
      left: 0,
      top: 0,
      right: 100,
      bottom: 8,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.pointerDown(root, { pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(root, { pointerId: 1, clientX: 100 });
    expect(defaultProps.onChange).toHaveBeenCalledWith(80);
    expect(defaultProps.onChange).not.toHaveBeenCalledWith(100);
  });

  test("measures grid alignment from the minimum rather than from zero", () => {
    // Grid 10, 25, 40 — the span of 40 is not a whole number of 15s, so End resolves to 40, not to 50
    render(<Slider {...defaultProps} min={10} max={50} step={15} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(40);
    expect(defaultProps.onChange).not.toHaveBeenCalledWith(50);
  });

  test("still reaches the maximum when the span is a whole number of steps", () => {
    render(<Slider {...defaultProps} min={10} max={50} step={10} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(50);
  });

  test("emits a clean decimal grid point rather than a floating-point artefact", () => {
    render(<Slider {...defaultProps} min={0} max={1} step={0.1} value={0.2} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    // 0.2 + 0.1 evaluates to 0.30000000000000004 in binary floating point
    expect(defaultProps.onChange).toHaveBeenCalledWith(0.3);
  });

  test("reaches a decimal maximum the step divides only within floating-point tolerance", () => {
    // 0.3 / 0.1 evaluates to 2.9999999999999996, which must not cost the respondent the top of the range
    render(<Slider {...defaultProps} min={0} max={0.3} step={0.1} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(0.3);
  });

  test.each([
    ["a span that is not divisible by the step", 0, 100, 40],
    ["a step that leaves a remainder below a whole step", 0, 100, 30],
    ["a grid anchored above zero", 10, 50, 15],
    ["a decimal grid", 0, 1, 0.3],
    ["a grid crossing zero", -10, 10, 7],
  ])("only ever emits an in-range, on-grid value for %s", (_label, min, max, step) => {
    render(<Slider {...defaultProps} min={min} max={max} step={step} />);
    const thumb = screen.getByRole("slider");
    for (const key of ["End", "PageUp", "ArrowRight", "ArrowUp", "Home", "ArrowLeft", "PageDown"]) {
      fireEvent.keyDown(thumb, { key });
      fireEvent.keyUp(thumb, { key });
    }
    expect(defaultProps.onChange).toHaveBeenCalled();
    const emitted = defaultProps.onChange.mock.calls.map((call) => Number(call[0]));
    for (const value of emitted) {
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(max);
      expect(isOnGrid(value, min, step)).toBe(true);
    }
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
  // Interaction completion
  //
  // Live movement reports through onChange, which fires continuously while a
  // drag or a held key runs. onValueCommit reports the finished interaction
  // once, which is what lets a consumer measure interaction time without
  // counting the same stretch of it repeatedly.
  // -------------------------------------------------------------------------

  test("reports a finished key interaction once, with the value it settled on", () => {
    const onValueCommit = vi.fn();
    render(<Slider {...defaultProps} value={50} onValueCommit={onValueCommit} />);
    const thumb = screen.getByRole("slider");
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    fireEvent.keyUp(thumb, { key: "ArrowRight" });
    expect(onValueCommit).toHaveBeenCalledTimes(1);
    expect(onValueCommit).toHaveBeenCalledWith(55);
  });

  test("reports one completion however many changes the interaction produced", () => {
    const onValueCommit = vi.fn();
    render(<Slider {...defaultProps} value={50} onValueCommit={onValueCommit} />);
    const thumb = screen.getByRole("slider");
    // A held key repeats its keydown without an intervening keyup
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    fireEvent.keyUp(thumb, { key: "ArrowRight" });
    expect(defaultProps.onChange.mock.calls.length).toBeGreaterThan(1);
    expect(onValueCommit).toHaveBeenCalledTimes(1);
  });

  test("reports a finished pointer interaction once", () => {
    const onValueCommit = vi.fn();
    const { container } = render(<Slider {...defaultProps} onValueCommit={onValueCommit} />);
    const root = getSliderRoot(container);
    fireEvent.pointerDown(root, { pointerId: 1 });
    fireEvent.pointerUp(root, { pointerId: 1 });
    // The recovered parked minimum is a completed interaction too
    expect(onValueCommit).toHaveBeenCalledTimes(1);
    expect(onValueCommit).toHaveBeenCalledWith(0);
  });

  test("reports the repositioned grid point rather than the value the primitive clamped", () => {
    const onValueCommit = vi.fn();
    render(<Slider {...defaultProps} step={40} onValueCommit={onValueCommit} />);
    const thumb = screen.getByRole("slider");
    fireEvent.keyDown(thumb, { key: "End" });
    fireEvent.keyUp(thumb, { key: "End" });
    expect(onValueCommit).toHaveBeenCalledTimes(1);
    expect(onValueCommit).toHaveBeenCalledWith(80);
  });

  test("reports nothing for an interaction that produced no value", () => {
    const onValueCommit = vi.fn();
    const { container } = render(<Slider {...defaultProps} value={0} onValueCommit={onValueCommit} />);
    const root = getSliderRoot(container);
    fireEvent.pointerDown(root, { pointerId: 1 });
    fireEvent.pointerUp(root, { pointerId: 1 });
    expect(defaultProps.onChange).not.toHaveBeenCalled();
    expect(onValueCommit).not.toHaveBeenCalled();
  });

  test("reports nothing for a key the control does not act on", () => {
    const onValueCommit = vi.fn();
    render(<Slider {...defaultProps} value={50} onValueCommit={onValueCommit} />);
    const thumb = screen.getByRole("slider");
    fireEvent.keyDown(thumb, { key: "Tab" });
    fireEvent.keyUp(thumb, { key: "Tab" });
    expect(onValueCommit).not.toHaveBeenCalled();
  });

  test("reports nothing while disabled", () => {
    const onValueCommit = vi.fn();
    const { container } = render(<Slider {...defaultProps} onValueCommit={onValueCommit} disabled />);
    const root = getSliderRoot(container);
    const thumb = screen.getByRole("slider");
    fireEvent.pointerDown(root, { pointerId: 1 });
    fireEvent.pointerUp(root, { pointerId: 1 });
    fireEvent.keyDown(thumb, { key: "End" });
    fireEvent.keyUp(thumb, { key: "End" });
    expect(onValueCommit).not.toHaveBeenCalled();
  });

  test("starts a new completion for each interaction", () => {
    const onValueCommit = vi.fn();
    render(<Slider {...defaultProps} value={50} onValueCommit={onValueCommit} />);
    const thumb = screen.getByRole("slider");
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    fireEvent.keyUp(thumb, { key: "ArrowRight" });
    fireEvent.keyDown(thumb, { key: "ArrowLeft" });
    fireEvent.keyUp(thumb, { key: "ArrowLeft" });
    expect(onValueCommit).toHaveBeenCalledTimes(2);
    expect(onValueCommit).toHaveBeenNthCalledWith(1, 55);
    expect(onValueCommit).toHaveBeenNthCalledWith(2, 45);
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
    // The label appears twice: the marker ElementHeader renders visually with the default requiredLabel
    // "Required", and the description the role-bearing control points at
    const markers = screen.getAllByText("Required");
    expect(markers).toHaveLength(2);
    expect(markers.some((marker) => !marker.classList.contains("sr-only"))).toBe(true);
  });

  test("shows a custom required label when provided", () => {
    render(<Slider {...defaultProps} required requiredLabel="Obligatorio" />);
    const markers = screen.getAllByText("Obligatorio");
    expect(markers).toHaveLength(2);
    expect(markers.some((marker) => !marker.classList.contains("sr-only"))).toBe(true);
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
    // Required-ness reaches the control as a description instead, so it is still communicated
    // programmatically rather than only visually
    expect(thumb).toHaveAttribute("aria-describedby", "test-slider-input-required");
  });

  test("describes the required state on the role-bearing control", () => {
    render(<Slider {...defaultProps} required />);
    const description = document.getElementById("test-slider-input-required");
    expect(description).not.toBeNull();
    expect(description).toHaveTextContent("Required");
    // The description exists for assistive technology only: the header already shows the marker
    expect(description).toHaveClass("sr-only");
  });

  test("describes a custom required label", () => {
    render(<Slider {...defaultProps} required requiredLabel="Obligatorio" />);
    expect(document.getElementById("test-slider-input-required")).toHaveTextContent("Obligatorio");
  });

  test("renders no required description when the element is optional", () => {
    render(<Slider {...defaultProps} />);
    expect(document.getElementById("test-slider-input-required")).toBeNull();
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

  test("combines the required and error descriptions in reading order", () => {
    render(<Slider {...defaultProps} required errorMessage="Please pick a value" />);
    expect(screen.getByRole("slider")).toHaveAttribute(
      "aria-describedby",
      "test-slider-input-required test-slider-input-error"
    );
  });

  test("reports a valid control and describes nothing when there is no error", () => {
    render(<Slider {...defaultProps} />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-invalid", "false");
    expect(thumb).not.toHaveAttribute("aria-describedby");
    expect(document.getElementById("test-slider-input-error")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Unanswered announcement
  //
  // The primitive parks the thumb at the minimum while the response value is
  // undefined, so `aria-valuenow` alone reads exactly like a slider genuinely
  // answered with the minimum. `aria-valuetext` is what keeps the two states
  // distinguishable for a screen-reader user, and it is localized by the caller.
  // -------------------------------------------------------------------------

  test("announces an unanswered control instead of the minimum it parks on", () => {
    render(<Slider {...defaultProps} />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuenow", "0");
    expect(thumb).toHaveAttribute("aria-valuetext", "No value selected");
  });

  test("announces the caller's unanswered label", () => {
    render(<Slider {...defaultProps} unansweredLabel="Kein Wert ausgewählt" />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "Kein Wert ausgewählt");
  });

  test("announces a value answered with the minimum as an answer", () => {
    render(<Slider {...defaultProps} value={0} />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuenow", "0");
    expect(thumb).not.toHaveAttribute("aria-valuetext");
  });

  test("announces a value answered anywhere else as an answer", () => {
    render(<Slider {...defaultProps} value={50} />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuenow", "50");
    expect(thumb).not.toHaveAttribute("aria-valuetext");
  });

  test("announces required and unanswered together", () => {
    render(<Slider {...defaultProps} required />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuetext", "No value selected");
    expect(thumb).toHaveAttribute("aria-describedby", "test-slider-input-required");
  });

  test("announces required and answered-at-minimum as an answer that is still required", () => {
    render(<Slider {...defaultProps} required value={0} />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuenow", "0");
    expect(thumb).not.toHaveAttribute("aria-valuetext");
    expect(thumb).toHaveAttribute("aria-describedby", "test-slider-input-required");
  });

  test.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["NaN", Number.NaN],
  ])("announces a %s value as unanswered", (_label, value) => {
    render(<Slider {...defaultProps} value={value} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "No value selected");
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
