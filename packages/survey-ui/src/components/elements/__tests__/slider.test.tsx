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

// Decimal places an operand needs, read from the shortest decimal string that round-trips back to it, the
// way the shared response validator reads its own operands. Exponential form is read rather than ignored,
// because that is how a fine step prints: `String(1e-7)` is `"1e-7"`, which needs seven places and not none.
const operandScale = (operand: number): number => {
  const notation = /^-?\d+(?:\.(?<fraction>\d+))?(?:e(?<exponent>[+-]\d+))?$/i.exec(String(operand));
  const fraction = notation?.groups?.fraction ?? "";
  const exponent = notation?.groups?.exponent ?? "0";
  return Math.max(0, fraction.length - Number(exponent));
};

// Independent grid check, deliberately written the way the shared response validator decides grid
// membership rather than by reusing the component's own arithmetic: value, origin and step are scaled to
// integers by their shared decimal scale and compared with integer remainders, because `%` is unusable on
// decimals - `(0.9 - 0) % 0.3` evaluates to 0.29999999999999993.
const isOnGrid = (value: number, min: number, step: number): boolean => {
  const decimals = Math.max(...[value, min, step].map(operandScale));
  const scale = 10 ** decimals;
  return (Math.round(value * scale) - Math.round(min * scale)) % Math.round(step * scale) === 0;
};

// Locates the slider root - the element a track press lands on and the rect every pointer position is
// measured against. It carries no role of its own, so it is reached through its data-slot hook, and a
// missing root fails loudly instead of being asserted away.
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
  // Value selection tests — the keyboard is exercised first because it needs no
  // layout measurement, and this environment reports a zero-sized rect for every
  // element; the pointer path is covered further down against a stubbed rect
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
  // A span that is not a whole number of steps has its last grid point below
  // `max`: 0 to 100 by 40 gives 0, 40 and 80. The shared response validator
  // rejects 100 for that configuration because (100 - 0) / 40 is not an integer,
  // so no interaction may resolve to `max` by clamping — every value the control
  // reports is counted in whole steps from `min` and capped at the last grid
  // point, which is what these tests pin.
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
    // The environment reports a zero-sized rect, so the pointer arithmetic needs a real one before a press
    // at the far right can resolve to the maximum
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
  // Fine and offset grids
  //
  // Deciding how precisely to state a movement from `String(step)` alone would
  // destroy exactly the two configurations the element schema admits and these
  // tests describe. A step that prints in exponential form — `String(1e-7)` is
  // `"1e-7"` — would read as no decimal places at all, so every movement would
  // be rounded to a whole number and the whole range would collapse onto its
  // integer bounds. And a grid whose origin is finer than its step, 0.005 by
  // 0.01, would have that origin rounded to the step's coarser scale, so the
  // configured minimum itself would be unselectable. The control therefore
  // moves in whole step positions, where the arithmetic is exact integer work,
  // reads the scale the origin and the step actually need — exponent included —
  // and resolves each position back to the value it stands for.
  // -------------------------------------------------------------------------

  test("reaches the first step of a grid finer than a whole number", () => {
    render(<Slider {...defaultProps} min={0} max={0.001} step={1e-7} />);
    const thumb = screen.getByRole("slider");
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    fireEvent.keyUp(thumb, { key: "ArrowRight" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(1e-7);
  });

  test("reaches the maximum of a grid finer than a whole number", () => {
    render(<Slider {...defaultProps} min={0} max={0.001} step={1e-7} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(0.001);
  });

  test("steps a grid finer than a whole number without collapsing onto its bounds", () => {
    render(<Slider {...defaultProps} min={0} max={0.001} step={1e-7} value={0.0005} />);
    const thumb = screen.getByRole("slider");
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(0.0005001);
    fireEvent.keyDown(thumb, { key: "ArrowLeft" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(0.0004999);
  });

  test("announces a fine grid as values rather than as step coordinates", () => {
    const { container } = render(<Slider {...defaultProps} min={0} max={0.001} step={1e-7} value={0.0005} />);
    const thumb = screen.getByRole("slider");
    // The coordinate behind this answer is step 5000 of 10000, which must never surface
    expect(thumb).toHaveAttribute("aria-valuemin", "0");
    expect(thumb).toHaveAttribute("aria-valuemax", "0.001");
    expect(thumb).toHaveAttribute("aria-valuenow", "0.0005");
    expect(container.querySelector("output")).toHaveTextContent("0.0005");
  });

  test("selects the configured minimum of a grid whose origin is finer than its step", () => {
    render(<Slider {...defaultProps} min={0.005} max={0.105} step={0.01} value={0.105} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(0.005);
    expect(defaultProps.onChange).not.toHaveBeenCalledWith(0.015);
  });

  test("commits the parked minimum of a grid whose origin is finer than its step", () => {
    render(<Slider {...defaultProps} min={0.005} max={0.105} step={0.01} />);
    const thumb = screen.getByRole("slider");
    fireEvent.keyDown(thumb, { key: "Home" });
    fireEvent.keyUp(thumb, { key: "Home" });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(0.005);
  });

  test("steps a grid whose origin is finer than its step from the origin", () => {
    render(<Slider {...defaultProps} min={0.005} max={0.105} step={0.01} value={0.005} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(defaultProps.onChange).toHaveBeenCalledWith(0.015);
  });

  test.each([
    ["a grid finer than a whole number", 0, 0.001, 1e-7],
    ["a grid whose origin is finer than its step", 0.005, 0.105, 0.01],
  ])("only ever emits an in-range, on-grid value for %s", (_label, min, max, step) => {
    render(<Slider {...defaultProps} min={min} max={max} step={step} />);
    const thumb = screen.getByRole("slider");
    for (const key of ["End", "PageDown", "ArrowRight", "PageUp", "Home", "ArrowLeft", "ArrowUp"]) {
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
  // An unanswered control parks its thumb at `min` without holding a value, so an
  // interaction resolving to `min` has to report it — treating it as "no change"
  // would leave the minimum, the value a range starting at 0 needs most, entirely
  // unselectable. Once a value IS held, a repeat of that same value is suppressed,
  // which is the distinction the closing tests of this section pin. Every value
  // asserted here is computed from the interaction itself: nothing is inferred
  // from an interaction having produced no value, because an inference like that
  // cannot tell a deliberate selection of the minimum from a key press that was
  // never handled at all.
  // -------------------------------------------------------------------------

  test("selects the minimum on a first pointer press", () => {
    const { container } = render(<Slider {...defaultProps} />);
    const root = getSliderRoot(container);
    fireEvent.pointerDown(root, { pointerId: 1 });
    fireEvent.pointerUp(root, { pointerId: 1 });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(0);
  });

  test("selects the minimum on a first press of the thumb itself", () => {
    render(<Slider {...defaultProps} />);
    const thumb = screen.getByRole("slider");
    fireEvent.pointerDown(thumb, { pointerId: 1 });
    fireEvent.pointerUp(thumb, { pointerId: 1 });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(0);
  });

  test("selects the minimum on a first touch press", () => {
    const { container } = render(<Slider {...defaultProps} />);
    const root = getSliderRoot(container);
    fireEvent.pointerDown(root, { pointerId: 1, pointerType: "touch" });
    fireEvent.pointerUp(root, { pointerId: 1, pointerType: "touch" });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(0);
  });

  test("selects a non-zero minimum on a first pointer press", () => {
    const { container } = render(<Slider {...defaultProps} min={10} max={50} />);
    const root = getSliderRoot(container);
    fireEvent.pointerDown(root, { pointerId: 1 });
    fireEvent.pointerUp(root, { pointerId: 1 });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(10);
  });

  test("selects the minimum on Home", () => {
    render(<Slider {...defaultProps} />);
    const thumb = screen.getByRole("slider");
    fireEvent.keyDown(thumb, { key: "Home" });
    fireEvent.keyUp(thumb, { key: "Home" });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(0);
  });

  test("selects the minimum on a backward arrow key", () => {
    render(<Slider {...defaultProps} />);
    const thumb = screen.getByRole("slider");
    fireEvent.keyDown(thumb, { key: "ArrowLeft" });
    fireEvent.keyUp(thumb, { key: "ArrowLeft" });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(0);
  });

  test("selects the minimum on PageDown", () => {
    render(<Slider {...defaultProps} />);
    const thumb = screen.getByRole("slider");
    fireEvent.keyDown(thumb, { key: "PageDown" });
    fireEvent.keyUp(thumb, { key: "PageDown" });
    expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).toHaveBeenCalledWith(0);
  });

  test("selects the minimum on the backward arrow key in RTL", () => {
    // The control inverts the horizontal arrows itself under RTL, so ArrowRight is
    // the backward key here and a backward step from the park clamps to the minimum
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
    // Reporting the minimum unprompted belongs to the unanswered state only: once a
    // value is held, an interaction resolving to that same value reports nothing and
    // commits nothing, so no redundant response is written
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
    // Selecting the minimum from the unanswered state is a completed interaction too
    expect(onValueCommit).toHaveBeenCalledTimes(1);
    expect(onValueCommit).toHaveBeenCalledWith(0);
  });

  test("reports the last grid point rather than the configured maximum", () => {
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

  test("selects nothing when disabled", () => {
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
    // root is a role-less span
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
  // Accessibility wiring — the root is a role-less span and role="slider" sits on
  // the thumb, per the WAI-ARIA slider pattern, so the control's identity, name
  // and state are asserted on the role-bearing element
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
    // The root is a span, so the header renders its headline and description as
    // plain text instead of as labels bound to an element no label can address;
    // the control carries its own accessible name instead
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
  // The thumb is parked at the minimum while the response value is undefined,
  // so `aria-valuenow` alone reads exactly like a slider genuinely
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
  // consumer of the component library — and because the thumb offset and the
  // aria-value* attributes are derived arithmetically, so a single
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

  // -------------------------------------------------------------------------
  // Computed values, thumb geometry and direction
  //
  // Three failure modes survive every assertion above: reporting a value the
  // control never computed, reporting one the thumb does not actually move to,
  // and moving the thumb the wrong way in a right-to-left survey. Each of the
  // three is a wrong number in a response rather than a visual blemish, so each
  // gets its own group. Pointer arithmetic needs a real rect, which this
  // environment does not provide, so the geometry is stubbed per test.
  // -------------------------------------------------------------------------

  /** Pins the root's rect - reported as zero-sized here - so a pressed position maps to a known value. */
  const stubRootRect = (container: HTMLElement, width = 200, left = 0): Element => {
    const root = getSliderRoot(container);
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      width,
      height: 8,
      left,
      top: 0,
      right: left + width,
      bottom: 8,
      x: left,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    return root;
  };

  describe("computed values", () => {
    test("steps up from the park rather than reporting the park itself", () => {
      // The regression this group exists for: a forward key press from the unanswered
      // state must report the first grid point above the minimum. Reporting the
      // minimum would mean the value came from the thumb's parked position instead of
      // from the key that was pressed.
      render(<Slider {...defaultProps} />);
      fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
      expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
      expect(defaultProps.onChange).toHaveBeenCalledWith(5);
      expect(defaultProps.onChange).not.toHaveBeenCalledWith(0);
    });

    test("steps up from a non-zero minimum by one increment", () => {
      render(<Slider {...defaultProps} min={10} max={50} />);
      fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
      expect(defaultProps.onChange).toHaveBeenCalledWith(15);
    });

    test("resolves a press to the value under the pointer, not to the minimum", () => {
      const { container } = render(<Slider {...defaultProps} />);
      const root = stubRootRect(container);
      fireEvent.pointerDown(root, { pointerId: 1, clientX: 100 });
      expect(defaultProps.onChange).toHaveBeenCalledWith(50);
    });

    test.each([
      [0, 0],
      [50, 25],
      [100, 50],
      [150, 75],
      [200, 100],
    ])("resolves a press at %ipx across a 200px track to %i", (clientX, expected) => {
      const { container } = render(<Slider {...defaultProps} />);
      const root = stubRootRect(container);
      fireEvent.pointerDown(root, { pointerId: 1, clientX });
      expect(defaultProps.onChange).toHaveBeenCalledWith(expected);
    });

    test("snaps a press between grid points onto the nearest one", () => {
      // 94px of 200px is 47, which no step-5 grid point occupies
      const { container } = render(<Slider {...defaultProps} />);
      const root = stubRootRect(container);
      fireEvent.pointerDown(root, { pointerId: 1, clientX: 94 });
      expect(defaultProps.onChange).toHaveBeenCalledWith(45);
    });

    test("clamps a press beyond the track to the nearest end", () => {
      const { container } = render(<Slider {...defaultProps} />);
      const root = stubRootRect(container);
      fireEvent.pointerDown(root, { pointerId: 1, clientX: -80 });
      expect(defaultProps.onChange).toHaveBeenLastCalledWith(0);
      fireEvent.pointerMove(root, { pointerId: 1, clientX: 900 });
      expect(defaultProps.onChange).toHaveBeenLastCalledWith(100);
    });

    test("reports every value a drag crosses and commits only the last", () => {
      const onValueCommit = vi.fn();
      const { container } = render(<Slider {...defaultProps} onValueCommit={onValueCommit} />);
      const root = stubRootRect(container);
      fireEvent.pointerDown(root, { pointerId: 1, clientX: 0 });
      fireEvent.pointerMove(root, { pointerId: 1, clientX: 100 });
      fireEvent.pointerMove(root, { pointerId: 1, clientX: 200 });
      fireEvent.pointerUp(root, { pointerId: 1, clientX: 200 });
      expect(defaultProps.onChange.mock.calls.map((call) => Number(call[0]))).toEqual([0, 50, 100]);
      expect(onValueCommit).toHaveBeenCalledTimes(1);
      expect(onValueCommit).toHaveBeenCalledWith(100);
    });

    test("ignores a pointer move that never began on the control", () => {
      const { container } = render(<Slider {...defaultProps} />);
      const root = stubRootRect(container);
      fireEvent.pointerMove(root, { pointerId: 1, clientX: 100 });
      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("ignores a pointer that is not the one the interaction began with", () => {
      const { container } = render(<Slider {...defaultProps} />);
      const root = stubRootRect(container);
      fireEvent.pointerDown(root, { pointerId: 1, clientX: 0 });
      defaultProps.onChange.mockClear();
      fireEvent.pointerMove(root, { pointerId: 2, clientX: 200 });
      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("resolves a press to the grid origin when the track has no measurable width", () => {
      const { container } = render(<Slider {...defaultProps} min={10} max={50} />);
      const root = stubRootRect(container, 0);
      fireEvent.pointerDown(root, { pointerId: 1, clientX: 25 });
      expect(defaultProps.onChange).toHaveBeenCalledWith(10);
    });
  });

  describe("thumb geometry", () => {
    test("parks the thumb at the start of the track while unanswered", () => {
      const { container } = render(<Slider {...defaultProps} />);
      const thumb = screen.getByRole("slider");
      expect(thumb.getAttribute("style")).toContain("0%");
      expect(container.querySelector('[data-slot="slider-range"]')?.getAttribute("style")).toContain(
        "inset-inline-end: 100%"
      );
    });

    test("places the thumb halfway along the track for the middle value", () => {
      const { container } = render(<Slider {...defaultProps} value={50} />);
      // The thumb is pulled back by half its own width at the midpoint so it stays
      // inside the track it points at
      expect(screen.getByRole("slider").getAttribute("style")).toBe("inset-inline-start: calc(50% - 10px);");
      expect(container.querySelector('[data-slot="slider-range"]')?.getAttribute("style")).toContain(
        "inset-inline-end: 50%"
      );
    });

    test("places the thumb at the end of the track for the maximum", () => {
      const { container } = render(<Slider {...defaultProps} value={100} />);
      expect(screen.getByRole("slider").getAttribute("style")).toBe("inset-inline-start: calc(100% - 20px);");
      expect(container.querySelector('[data-slot="slider-range"]')?.getAttribute("style")).toContain(
        "inset-inline-end: 0%"
      );
    });

    test("positions the thumb from the value rather than from the range it sits in", () => {
      // A 10..50 range answered with 20 is a quarter of the way along, not a fifth
      render(<Slider {...defaultProps} min={10} max={50} value={20} />);
      expect(screen.getByRole("slider").getAttribute("style")).toBe("inset-inline-start: calc(25% - 5px);");
    });

    test("positions with logical properties so the track mirrors under RTL", () => {
      // `inset-inline-start` resolves to the leading edge in both directions, which is
      // why no direction-specific arithmetic appears anywhere in the component
      const { container } = render(<Slider {...defaultProps} value={50} />);
      const thumbStyle = screen.getByRole("slider").getAttribute("style") ?? "";
      const rangeStyle = container.querySelector('[data-slot="slider-range"]')?.getAttribute("style") ?? "";
      expect(thumbStyle).toContain("inset-inline-start");
      expect(thumbStyle).not.toMatch(/(?:^|[\s;])(?:left|right):/);
      expect(rangeStyle).not.toMatch(/(?:^|[\s;])(?:left|right):/);
    });
  });

  describe("direction handling", () => {
    test("moves forward on ArrowLeft and backward on ArrowRight under RTL", () => {
      render(<Slider {...defaultProps} dir="rtl" value={50} />);
      const thumb = screen.getByRole("slider");
      fireEvent.keyDown(thumb, { key: "ArrowLeft" });
      expect(defaultProps.onChange).toHaveBeenLastCalledWith(55);
      fireEvent.keyDown(thumb, { key: "ArrowRight" });
      expect(defaultProps.onChange).toHaveBeenLastCalledWith(45);
    });

    test("keeps the vertical arrows meaning more and less under RTL", () => {
      render(<Slider {...defaultProps} dir="rtl" value={50} />);
      const thumb = screen.getByRole("slider");
      fireEvent.keyDown(thumb, { key: "ArrowUp" });
      expect(defaultProps.onChange).toHaveBeenLastCalledWith(55);
      fireEvent.keyDown(thumb, { key: "ArrowDown" });
      expect(defaultProps.onChange).toHaveBeenLastCalledWith(45);
    });

    test("keeps the page keys meaning more and less under RTL", () => {
      render(<Slider {...defaultProps} dir="rtl" value={50} />);
      const thumb = screen.getByRole("slider");
      fireEvent.keyDown(thumb, { key: "PageUp" });
      expect(defaultProps.onChange).toHaveBeenLastCalledWith(100);
      fireEvent.keyDown(thumb, { key: "PageDown" });
      expect(defaultProps.onChange).toHaveBeenLastCalledWith(0);
    });

    test("keeps Home and End addressing the grid ends under RTL", () => {
      render(<Slider {...defaultProps} dir="rtl" value={50} />);
      const thumb = screen.getByRole("slider");
      fireEvent.keyDown(thumb, { key: "End" });
      expect(defaultProps.onChange).toHaveBeenLastCalledWith(100);
      fireEvent.keyDown(thumb, { key: "Home" });
      expect(defaultProps.onChange).toHaveBeenLastCalledWith(0);
    });

    test("measures a press from the right edge under RTL", () => {
      const { container } = render(<Slider {...defaultProps} dir="rtl" />);
      const root = stubRootRect(container);
      fireEvent.pointerDown(root, { pointerId: 1, clientX: 50 });
      expect(defaultProps.onChange).toHaveBeenCalledWith(75);
    });

    test("measures a press from the left edge under LTR", () => {
      const { container } = render(<Slider {...defaultProps} dir="ltr" />);
      const root = stubRootRect(container);
      fireEvent.pointerDown(root, { pointerId: 1, clientX: 50 });
      expect(defaultProps.onChange).toHaveBeenCalledWith(25);
    });

    test("offsets a press by the track's own position on screen", () => {
      const { container } = render(<Slider {...defaultProps} />);
      const root = stubRootRect(container, 200, 400);
      fireEvent.pointerDown(root, { pointerId: 1, clientX: 500 });
      expect(defaultProps.onChange).toHaveBeenCalledWith(50);
    });

    test("resolves an automatic direction from the document it is rendered in", () => {
      // `dir="auto"` leaves the attribute off the root and reads the computed direction
      // instead, which this document reports as left-to-right
      const { container } = render(<Slider {...defaultProps} dir="auto" value={50} />);
      expect(getSliderRoot(container).hasAttribute("dir")).toBe(false);
      fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
      expect(defaultProps.onChange).toHaveBeenLastCalledWith(55);
    });
  });
});
