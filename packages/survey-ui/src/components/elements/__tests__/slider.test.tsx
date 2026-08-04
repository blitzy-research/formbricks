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

    expect(getThumb()).toHaveAttribute("aria-required", "false");
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
});
