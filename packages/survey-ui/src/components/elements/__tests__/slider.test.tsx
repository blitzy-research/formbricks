// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Slider } from "../slider";

// ---------------------------------------------------------------------------
// Shared default props — `onChange` is cleared before every test.
// The 0 / 100 / 5 configuration is the one the element's acceptance criteria
// are written against, so the selectable grid is 0, 5, 10 … 100.
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

// ===========================================================================
// Slider component tests
//
// Documented deviation from AGENTS.md §Testing Guidelines, which asks that
// `.tsx` components be left to Playwright: this directory's own convention
// wins, because both of the most recent element additions ship a colocated
// component spec here, `vite.config.mts` deliberately collects `.tsx` specs
// and aliases React to a single copy so they run, and no Playwright spec
// covers these components. No end-to-end spec is added, matching both prior
// element additions.
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
    // A single-value control always renders exactly one thumb
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
  // Disabled state tests
  // -------------------------------------------------------------------------

  test("does not call onChange when disabled", () => {
    render(<Slider {...defaultProps} value={50} disabled={true} />);
    // The change handler short-circuits on `disabled`, so no key press can
    // move the response value
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  test("marks the control disabled for assistive technology", () => {
    const { container } = render(<Slider {...defaultProps} disabled={true} />);
    const root = container.querySelector('[data-slot="slider"]');
    expect(root).toHaveAttribute("aria-disabled", "true");
  });

  test("is not disabled by default", () => {
    const { container } = render(<Slider {...defaultProps} />);
    const root = container.querySelector('[data-slot="slider"]');
    expect(root).toHaveAttribute("aria-disabled", "false");
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
    // Without lowerLabel or upperLabel the whole label row is omitted
    expect(screen.queryByText("Not at all")).toBeNull();
    expect(screen.queryByText("Very much")).toBeNull();
  });

  test("renders only lower label when upper is not provided", () => {
    render(<Slider {...defaultProps} lowerLabel="Not at all" />);
    expect(screen.getByText("Not at all")).toBeInTheDocument();
    expect(screen.queryByText("Very much")).toBeNull();
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
    render(<Slider {...defaultProps} required={true} />);
    // ElementHeader renders the default requiredLabel "Required" when required is true
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  test("shows a custom required label when provided", () => {
    render(<Slider {...defaultProps} required={true} requiredLabel="Obligatorio" />);
    expect(screen.getByText("Obligatorio")).toBeInTheDocument();
  });

  test("does not show the required indicator by default", () => {
    render(<Slider {...defaultProps} />);
    expect(screen.queryByText("Required")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Accessibility wiring — these attributes sit on the primitive's root
  // rather than on the thumb, so they are located through its data-slot hook
  // -------------------------------------------------------------------------

  test("exposes the headline as the accessible name of the control", () => {
    const { container } = render(<Slider {...defaultProps} />);
    const root = container.querySelector('[data-slot="slider"]');
    expect(root).toHaveAttribute("aria-label", "How satisfied are you?");
  });

  test("communicates required-ness on the control", () => {
    const { container } = render(<Slider {...defaultProps} required={true} />);
    const root = container.querySelector('[data-slot="slider"]');
    expect(root).toHaveAttribute("aria-required", "true");
  });

  test("binds the control id so the header label resolves to it", () => {
    const { container } = render(<Slider {...defaultProps} />);
    const root = container.querySelector('[data-slot="slider"]');
    expect(root).toHaveAttribute("id", "test-slider-input");
  });
});
