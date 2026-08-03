// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Slider } from "../slider";

/**
 * The control delegates its interaction and accessibility contract to a native `<input type="range">`, so
 * these specs assert the contract handed to the platform - the bounds, the grid, the value, the state and
 * the presentation driven from them - rather than re-testing the platform itself.
 *
 * Drag, track-press geometry, key semantics (arrows, Page Up/Down, Home/End), grid snapping and right-to-left
 * inversion are deliberately NOT asserted here: this suite runs under happy-dom, which renders no layout and
 * implements none of those behaviours, so an assertion about them would pass or fail for reasons unrelated to
 * this component. They are verified against a real browser instead, and what makes that sufficient is exactly
 * what these specs pin: the browser is handed `min`, `max` and `step`, and HTML defines a range input's
 * allowed values as `min + n * step` - the same grid, anchored at the same origin, that the shared
 * `stepMultipleOf` response rule enforces.
 */

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

/** The platform control: `input[type="range"]` carries the implicit `slider` role. */
const getControl = (): HTMLInputElement => screen.getByRole<HTMLInputElement>("slider");

/** Locates one of the presentation slots, failing loudly rather than asserting a missing element away. */
const getSlot = (container: HTMLElement, slot: string): HTMLElement => {
  const element = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  if (!element) {
    throw new Error(`no element with data-slot="${slot}" was rendered`);
  }
  return element;
};

/** Drives the platform control the way a browser does: it resolves a value, then reports it. */
const selectValue = (value: number): void => {
  fireEvent.change(getControl(), { target: { value: String(value) } });
};

/**
 * Presses and releases a key on the platform control.
 *
 * Both halves are dispatched because the value a key resolves to is the default action of the press, so the
 * release is the first point at which the control's own value can be read back.
 */
const pressKey = (key: string): void => {
  const control = getControl();
  fireEvent.keyDown(control, { key });
  fireEvent.keyUp(control, { key });
};

/** Presses and releases a pointer on the platform control, the way a press on the track arrives. */
const pressPointer = (button = 0): void => {
  const control = getControl();
  fireEvent.pointerDown(control, { button });
  fireEvent.pointerUp(control, { button });
};

// ===========================================================================
// Slider component tests
// ===========================================================================

describe("Slider", () => {
  beforeEach(() => {
    defaultProps.onChange.mockClear();
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  describe("rendering", () => {
    test("renders a single slider control", () => {
      render(<Slider {...defaultProps} />);

      expect(screen.getAllByRole("slider")).toHaveLength(1);
    });

    test("renders the headline", () => {
      render(<Slider {...defaultProps} />);

      expect(screen.getByText("How satisfied are you?")).toBeInTheDocument();
    });

    test("renders the description when provided", () => {
      render(<Slider {...defaultProps} description="Pick any value on the scale" />);

      expect(screen.getByText("Pick any value on the scale")).toBeInTheDocument();
    });

    test("does not render a description when none is provided", () => {
      render(<Slider {...defaultProps} />);

      expect(screen.queryByText("Pick any value on the scale")).not.toBeInTheDocument();
    });

    test("renders the track, range and thumb composition", () => {
      const { container } = render(<Slider {...defaultProps} value={50} />);

      expect(getSlot(container, "slider")).toBeInTheDocument();
      expect(getSlot(container, "slider-track")).toBeInTheDocument();
      expect(getSlot(container, "slider-range")).toBeInTheDocument();
      expect(getSlot(container, "slider-thumb")).toBeInTheDocument();
    });

    test("applies the element id to the wrapper", () => {
      const { container } = render(<Slider {...defaultProps} />);

      expect(container.querySelector("#test-slider")).toBeInTheDocument();
    });

    test("hides the presentation layer from assistive technology", () => {
      // The role, the value and the focus all live on the input; announcing the decoration as well would
      // report the same control twice.
      const { container } = render(<Slider {...defaultProps} value={50} />);

      expect(getSlot(container, "slider")).toHaveAttribute("aria-hidden", "true");
    });
  });

  // -------------------------------------------------------------------------
  // The contract handed to the platform control
  // -------------------------------------------------------------------------

  describe("platform contract", () => {
    test("renders a native range input carrying the control id", () => {
      render(<Slider {...defaultProps} />);
      const control = getControl();

      expect(control.tagName).toBe("INPUT");
      expect(control).toHaveAttribute("type", "range");
      expect(control).toHaveAttribute("id", "test-slider-input");
    });

    test("hands the configured bounds and step to the platform", () => {
      render(<Slider {...defaultProps} value={50} />);
      const control = getControl();

      expect(control).toHaveAttribute("min", "0");
      expect(control).toHaveAttribute("max", "100");
      expect(control).toHaveAttribute("step", "5");
    });

    test("hands a range that does not start at zero to the platform unchanged", () => {
      // The grid is anchored at `min`, so the origin the platform snaps to is the origin the server's grid
      // rule measures from: 10, 15, 20 ... and never 12.
      render(<Slider {...defaultProps} min={10} max={50} step={5} value={15} />);
      const control = getControl();

      expect(control).toHaveAttribute("min", "10");
      expect(control).toHaveAttribute("max", "50");
      expect(control).toHaveAttribute("step", "5");
    });

    test("hands a decimal step to the platform without rounding it", () => {
      render(<Slider {...defaultProps} min={0} max={1} step={0.1} value={0.3} />);

      expect(getControl()).toHaveAttribute("step", "0.1");
    });

    test("hands a step far finer than a whole number to the platform verbatim", () => {
      render(<Slider {...defaultProps} min={0} max={0.001} step={0.0001} value={0.0005} />);

      expect(getControl()).toHaveAttribute("step", "0.0001");
    });

    test("hands a step written in scientific notation to the platform verbatim", () => {
      // A step whose shortest form carries an exponent rather than a decimal point still describes a grid,
      // and HTML's floating-point grammar accepts that form, so it is passed through as authored. Deriving a
      // decimal count from the printed step instead - counting the digits after a "." that is not there -
      // collapses this grid to whole numbers, leaving every value in it unreachable.
      render(<Slider {...defaultProps} min={0} max={0.001} step={1e-7} value={3e-7} />);
      const control = getControl();

      expect(control).toHaveAttribute("step", "1e-7");
      expect(control).toHaveAttribute("min", "0");
      expect(control).toHaveAttribute("max", "0.001");
    });

    test("holds an offset grid at its own minimum rather than a coarser neighbour", () => {
      // The grid 0.005, 0.015, 0.025 ... is anchored at a value finer than its own step. Rounding the
      // origin to the step's precision would move the first selectable point to 0.015 and put the
      // configured minimum out of reach, so the value is handed over exactly as configured.
      render(<Slider {...defaultProps} min={0.005} max={0.105} step={0.01} value={0.005} />);
      const control = getControl();

      expect(control).toHaveAttribute("min", "0.005");
      expect(control).toHaveAttribute("max", "0.105");
      expect(control).toHaveAttribute("step", "0.01");
      expect(control).toHaveValue("0.005");
    });

    test("omits the step attribute when the configuration describes no grid", () => {
      // A non-positive step would make the attribute invalid and silently mean 1; omitting it reaches that
      // same default without asserting a grid the configuration never defined.
      render(<Slider {...defaultProps} step={0} />);

      expect(getControl()).not.toHaveAttribute("step");
    });

    test("reflects the selected value on the control", () => {
      render(<Slider {...defaultProps} value={35} />);

      expect(getControl()).toHaveValue("35");
    });
  });

  // -------------------------------------------------------------------------
  // Value reporting
  // -------------------------------------------------------------------------

  describe("value reporting", () => {
    test("reports the value the platform resolved", () => {
      render(<Slider {...defaultProps} />);

      selectValue(45);

      expect(defaultProps.onChange).toHaveBeenCalledWith(45);
    });

    test("reports a number, not a string", () => {
      render(<Slider {...defaultProps} />);

      selectValue(45);

      expect(typeof defaultProps.onChange.mock.calls[0][0]).toBe("number");
    });

    test("reports the minimum as an ordinary value", () => {
      // A slider whose minimum is 0 must be able to answer 0: the runtime keeps `undefined` for unanswered,
      // so nothing here may treat the lowest value as "no answer". Started from 50 because the control is
      // already parked at the minimum, and a platform control reports only an actual change.
      render(<Slider {...defaultProps} value={50} />);

      selectValue(0);

      expect(defaultProps.onChange).toHaveBeenCalledWith(0);
    });

    test("reports a decimal value without rounding it", () => {
      render(<Slider {...defaultProps} min={0} max={1} step={0.1} />);

      selectValue(0.3);

      expect(defaultProps.onChange).toHaveBeenCalledWith(0.3);
    });

    test("reports a value from a grid finer than a whole number of decimal places", () => {
      // The component applies no precision policy of its own, so a value the platform resolves on a
      // 1e-7 grid is reported as-is. Rounding it here would emit a value the server's grid rule rejects.
      render(<Slider {...defaultProps} min={0} max={0.001} step={1e-7} />);

      selectValue(3e-7);

      expect(defaultProps.onChange).toHaveBeenCalledWith(3e-7);
    });

    test("reports the first point of an offset decimal grid, not a rounded one", () => {
      // Grid 0.005, 0.015, 0.025 ... Answering the second point must report 0.015 exactly: a value nudged
      // to the step's own precision - 0.01 or 0.02 - is off this grid and would be rejected on submission.
      render(<Slider {...defaultProps} min={0.005} max={0.105} step={0.01} value={0.005} />);

      selectValue(0.015);

      expect(defaultProps.onChange).toHaveBeenCalledWith(0.015);
    });

    test("reports a negative value on a range spanning zero", () => {
      render(<Slider {...defaultProps} min={-50} max={50} step={5} />);

      selectValue(-25);

      expect(defaultProps.onChange).toHaveBeenCalledWith(-25);
    });

    test("emits nothing on mount", () => {
      render(<Slider {...defaultProps} />);

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("emits nothing on mount when already answered", () => {
      render(<Slider {...defaultProps} value={50} />);

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("never reports a value that is not a finite number", () => {
      // A range input cannot hold an empty or unparsable value - the platform sanitises one into its own
      // default - so this asserts the invariant that survives that sanitisation rather than a rejection the
      // platform never asks for.
      render(<Slider {...defaultProps} value={50} />);

      fireEvent.change(getControl(), { target: { value: "" } });

      for (const [reported] of defaultProps.onChange.mock.calls) {
        expect(Number.isFinite(reported)).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Unanswered state
  // -------------------------------------------------------------------------

  describe("unanswered state", () => {
    test("parks the control at the minimum while unanswered", () => {
      render(<Slider {...defaultProps} />);

      expect(getControl()).toHaveValue("0");
    });

    test("parks the control at a non-zero minimum while unanswered", () => {
      render(<Slider {...defaultProps} min={10} max={50} />);

      expect(getControl()).toHaveValue("10");
    });

    test("distinguishes an unanswered thumb from one answered with the minimum", () => {
      // The parked position is identical, so the fill is the only thing that can carry the difference.
      const unanswered = render(<Slider {...defaultProps} />);
      expect(getSlot(unanswered.container, "slider-thumb")).toHaveClass("bg-input-bg");
      unanswered.unmount();

      const answered = render(<Slider {...defaultProps} value={0} />);
      expect(getSlot(answered.container, "slider-thumb")).toHaveClass("bg-brand");
    });

    test("treats a non-finite value as unanswered", () => {
      const { container } = render(<Slider {...defaultProps} value={Number.NaN} />);

      expect(getSlot(container, "slider-thumb")).toHaveClass("bg-input-bg");
    });
  });

  // -------------------------------------------------------------------------
  // Selecting the value the thumb is parked at
  // -------------------------------------------------------------------------

  /**
   * An unanswered control's own value already sits at `min`, so an interaction asking for the minimum changes
   * nothing and HTML - which fires `input` only on an actual change - reports nothing. These specs pin the
   * recovery: once such an interaction finishes, the control reports the value it is holding. That is what
   * makes the minimum selectable at all, and what makes a required slider completable.
   */
  describe("selecting the parked value", () => {
    test.each(["Home", "ArrowLeft", "ArrowDown", "PageDown"])(
      "reports the minimum when a pristine control is asked for it with %s",
      (key) => {
        render(<Slider {...defaultProps} />);

        pressKey(key);

        expect(defaultProps.onChange).toHaveBeenCalledWith(0);
      }
    );

    test("reports a minimum that is not zero, which is not a special case", () => {
      render(<Slider {...defaultProps} min={10} max={50} step={5} />);

      pressKey("Home");

      expect(defaultProps.onChange).toHaveBeenCalledWith(10);
    });

    test("reports a negative minimum", () => {
      render(<Slider {...defaultProps} min={-50} max={-10} step={5} />);

      pressKey("ArrowLeft");

      expect(defaultProps.onChange).toHaveBeenCalledWith(-50);
    });

    test("reports the minimum when a press lands on the control", () => {
      render(<Slider {...defaultProps} />);

      pressPointer();

      expect(defaultProps.onChange).toHaveBeenCalledWith(0);
    });

    test("reports the minimum while the required error is showing", () => {
      // The respondent's way out of a rejected required slider is to select the minimum already in front of
      // them, so this is the interaction that has to work for the error to be resolvable at all.
      render(<Slider {...defaultProps} required errorMessage="Please fill out this field" />);

      pressKey("Home");

      expect(defaultProps.onChange).toHaveBeenCalledWith(0);
    });

    test("reports the minimum once, not once per event", () => {
      render(<Slider {...defaultProps} />);

      pressKey("Home");

      expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    });

    test("reports a number, not a string", () => {
      render(<Slider {...defaultProps} />);

      pressKey("Home");

      expect(typeof defaultProps.onChange.mock.calls[0][0]).toBe("number");
    });

    test.each(["Enter", " ", "Tab", "Escape"])(
      "reports nothing for %s, which the control does not act on",
      (key) => {
        // `Enter` submits the surrounding form. Treating it as a selection would answer an untouched required
        // slider with its minimum and defeat the required check the response contract depends on.
        render(<Slider {...defaultProps} />);

        pressKey(key);

        expect(defaultProps.onChange).not.toHaveBeenCalled();
      }
    );

    test("reports nothing for a release whose press began elsewhere", () => {
      render(<Slider {...defaultProps} />);

      fireEvent.pointerUp(getControl(), { button: 0 });

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("reports nothing for a press with a button the control ignores", () => {
      render(<Slider {...defaultProps} />);

      pressPointer(2);

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("reports nothing after a press is cancelled", () => {
      render(<Slider {...defaultProps} />);
      const control = getControl();

      fireEvent.pointerDown(control, { button: 0 });
      fireEvent.pointerCancel(control);
      fireEvent.pointerUp(control, { button: 0 });

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("reports nothing when the control already holds the minimum", () => {
      // Nothing to recover, and a second report would recharge time to completion for an answer already given.
      render(<Slider {...defaultProps} value={0} />);

      pressKey("Home");
      pressPointer();

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("reports nothing when the control already holds some other value", () => {
      render(<Slider {...defaultProps} value={50} />);

      pressKey("ArrowLeft");
      pressPointer();

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("reports nothing while disabled", () => {
      render(<Slider {...defaultProps} disabled />);

      pressKey("Home");
      pressPointer();

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("does not report twice when the platform moved the value itself", () => {
      // An interaction that did change the value is reported by the platform, and the recovery must not
      // duplicate it: the answer arrives once, the control becomes answered, and the release adds nothing.
      const { rerender } = render(<Slider {...defaultProps} />);

      selectValue(25);
      rerender(<Slider {...defaultProps} value={25} />);
      pressKey("ArrowRight");

      expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
      expect(defaultProps.onChange).toHaveBeenCalledWith(25);
    });

    test("leaves the maximum to the platform, which was never parked on it", () => {
      const { rerender } = render(<Slider {...defaultProps} />);

      selectValue(100);
      rerender(<Slider {...defaultProps} value={100} />);
      pressKey("End");

      expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
      expect(defaultProps.onChange).toHaveBeenCalledWith(100);
    });
  });

  // -------------------------------------------------------------------------
  // Readout
  // -------------------------------------------------------------------------

  describe("readout", () => {
    test("renders the readout for the selected value by default", () => {
      render(<Slider {...defaultProps} value={65} />);

      expect(screen.getByText("65")).toBeInTheDocument();
    });

    test("binds the readout to the control that produced the value", () => {
      const { container } = render(<Slider {...defaultProps} value={65} />);
      const readout = container.querySelector("output");

      expect(readout).toHaveAttribute("for", "test-slider-input");
    });

    test("does not render the readout when showValue is false", () => {
      render(<Slider {...defaultProps} value={65} showValue={false} />);

      expect(screen.queryByText("65")).not.toBeInTheDocument();
    });

    test("does not render the readout while unanswered", () => {
      const { container } = render(<Slider {...defaultProps} />);

      expect(container.querySelector("output")).not.toBeInTheDocument();
    });

    test("renders a readout for the minimum, which is a real answer", () => {
      render(<Slider {...defaultProps} value={0} />);

      expect(screen.getByText("0")).toBeInTheDocument();
    });

    test("shows a decimal answer at its own precision", () => {
      render(<Slider {...defaultProps} min={0} max={1} step={0.1} value={0.3} />);

      expect(screen.getByText("0.3")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Presentation driven from the value
  // -------------------------------------------------------------------------

  describe("presentation", () => {
    test.each([
      [0, "calc(0% - 0px)", "100%"],
      [50, "calc(50% - 10px)", "50%"],
      [100, "calc(100% - 20px)", "0%"],
    ])("positions the thumb and the fill for the value %s", (value, thumbInset, rangeInsetEnd) => {
      // The thumb travels `trackWidth - thumbWidth`, so a share of the width is offset by the same share of
      // the thumb: that is what keeps the visible thumb under the platform's own thumb at both ends.
      const { container } = render(<Slider {...defaultProps} value={value} />);

      expect(getSlot(container, "slider-thumb").style.insetInlineStart).toBe(thumbInset);
      expect(getSlot(container, "slider-range").style.insetInlineEnd).toBe(rangeInsetEnd);
    });

    test("measures the position from the minimum rather than from zero", () => {
      const { container } = render(<Slider {...defaultProps} min={10} max={50} step={5} value={30} />);

      expect(getSlot(container, "slider-thumb").style.insetInlineStart).toBe("calc(50% - 10px)");
    });

    test("parks the thumb at the start of the track while unanswered", () => {
      const { container } = render(<Slider {...defaultProps} />);

      expect(getSlot(container, "slider-thumb").style.insetInlineStart).toBe("calc(0% - 0px)");
      expect(getSlot(container, "slider-range").style.insetInlineEnd).toBe("100%");
    });

    test("positions a value stored above the maximum at the end of the track", () => {
      // The presentation is driven from the prop, not read back from the input, so a value left over from an
      // earlier submission is drawn where it belongs instead of being silently hidden.
      const { container } = render(<Slider {...defaultProps} value={105} />);

      expect(getSlot(container, "slider-thumb").style.insetInlineStart).toBe("calc(100% - 20px)");
    });

    test("positions a value stored below the minimum at the start of the track", () => {
      const { container } = render(<Slider {...defaultProps} value={-5} />);

      expect(getSlot(container, "slider-thumb").style.insetInlineStart).toBe("calc(0% - 0px)");
    });

    test("shows a value clamped into range in the readout", () => {
      render(<Slider {...defaultProps} value={105} />);

      expect(screen.getByText("100")).toBeInTheDocument();
    });

    test("resolves the position of a range whose span is not measurable", () => {
      // An inverted or collapsed range is a configuration the element schema rejects, but the control must
      // still render rather than divide by zero and write `NaN%` into the markup.
      const { container } = render(<Slider {...defaultProps} min={10} max={10} value={10} />);

      expect(getSlot(container, "slider-thumb").style.insetInlineStart).toBe("calc(0% - 0px)");
      expect(container.innerHTML).not.toContain("NaN");
    });

    test("styles the track and the fill from design tokens alone", () => {
      const { container } = render(<Slider {...defaultProps} value={50} />);

      expect(getSlot(container, "slider-track")).toHaveClass(
        "bg-input-bg",
        "border-input-border",
        "rounded-input"
      );
      expect(getSlot(container, "slider-range")).toHaveClass("bg-brand");
      expect(getSlot(container, "slider-thumb")).toHaveClass("border-brand");
    });

    test("keeps the handle a sibling of the control, which its focus affordance depends on", () => {
      // `peer-*` variants compile to sibling selectors, so a handle nested any deeper than a sibling of
      // the control silently loses its focus and hover rings - and because the control itself is
      // transparent, that leaves a keyboard respondent with no focus indicator whatsoever.
      const { container } = render(<Slider {...defaultProps} />);

      expect(getSlot(container, "slider-thumb").parentElement).toBe(getControl().parentElement);
    });

    test("gives the handle the focus and hover affordances the transparent control cannot show", () => {
      const { container } = render(<Slider {...defaultProps} />);

      expect(getSlot(container, "slider-thumb")).toHaveClass(
        "peer-focus-visible:ring-ring/50",
        "peer-focus-visible:ring-[3px]",
        "peer-hover:ring-brand-20",
        "peer-hover:ring-2"
      );
    });
  });

  // -------------------------------------------------------------------------
  // Disabled state
  // -------------------------------------------------------------------------

  describe("disabled state", () => {
    test("disables the platform control", () => {
      render(<Slider {...defaultProps} disabled />);

      expect(getControl()).toBeDisabled();
    });

    test("is enabled by default", () => {
      render(<Slider {...defaultProps} />);

      expect(getControl()).toBeEnabled();
    });

    test("does not report a value while disabled", () => {
      render(<Slider {...defaultProps} disabled />);

      selectValue(50);

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("dims the presentation while disabled", () => {
      const { container } = render(<Slider {...defaultProps} disabled />);

      // The handle is dimmed on its own account, because it sits alongside the layer rather than inside it.
      expect(getSlot(container, "slider")).toHaveClass("opacity-50");
      expect(getSlot(container, "slider-thumb")).toHaveClass("opacity-50");
    });

    test("withholds the hover affordance while disabled", () => {
      const { container } = render(<Slider {...defaultProps} disabled />);

      expect(getSlot(container, "slider-thumb")).not.toHaveClass("peer-hover:ring-2");
    });

    test("withdraws the pointer affordance while disabled", () => {
      render(<Slider {...defaultProps} disabled />);

      expect(getControl()).toHaveClass("cursor-not-allowed");
    });

    test("advertises the pointer affordance while enabled", () => {
      render(<Slider {...defaultProps} />);

      expect(getControl()).toHaveClass("cursor-pointer");
    });
  });

  // -------------------------------------------------------------------------
  // Endpoint labels
  // -------------------------------------------------------------------------

  describe("endpoint labels", () => {
    test("renders lower and upper labels", () => {
      render(<Slider {...defaultProps} lowerLabel="Not at all" upperLabel="Extremely" />);

      expect(screen.getByText("Not at all")).toBeInTheDocument();
      expect(screen.getByText("Extremely")).toBeInTheDocument();
    });

    test("renders no label row when neither label is provided", () => {
      render(<Slider {...defaultProps} />);

      expect(screen.queryByText("Not at all")).not.toBeInTheDocument();
    });

    test("renders only the lower label when the upper one is absent", () => {
      render(<Slider {...defaultProps} lowerLabel="Not at all" />);

      expect(screen.getByText("Not at all")).toBeInTheDocument();
      expect(screen.queryByText("Extremely")).not.toBeInTheDocument();
    });

    test("renders only the upper label when the lower one is absent", () => {
      render(<Slider {...defaultProps} upperLabel="Extremely" />);

      expect(screen.getByText("Extremely")).toBeInTheDocument();
      expect(screen.queryByText("Not at all")).not.toBeInTheDocument();
    });

    test("anchors an upper-only label to the end of the row", () => {
      // `justify-between` cannot place a lone child at the end, so the label pushes itself there with a
      // logical margin that follows the writing direction.
      render(<Slider {...defaultProps} upperLabel="Extremely" />);

      expect(screen.getByText("Extremely")).toHaveClass("ms-auto");
    });

    test("keeps the lower label at the start of the row", () => {
      render(<Slider {...defaultProps} lowerLabel="Not at all" />);

      expect(screen.getByText("Not at all")).not.toHaveClass("ms-auto");
    });
  });

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  describe("error state", () => {
    test("renders the error message when provided", () => {
      render(<Slider {...defaultProps} errorMessage="Please select a value" />);

      expect(screen.getByText("Please select a value")).toBeInTheDocument();
    });

    test("renders no error when there is no message", () => {
      render(<Slider {...defaultProps} />);

      expect(screen.queryByText("Please select a value")).not.toBeInTheDocument();
    });

    test("marks the control invalid and points it at the message", () => {
      render(<Slider {...defaultProps} errorMessage="Please select a value" />);
      const control = getControl();

      expect(control).toHaveAttribute("aria-invalid", "true");
      expect(control).toHaveAttribute("aria-describedby", "test-slider-input-error");
      expect(document.getElementById("test-slider-input-error")).toHaveTextContent("Please select a value");
    });

    test("reports a valid control and describes nothing when there is no error", () => {
      render(<Slider {...defaultProps} />);
      const control = getControl();

      expect(control).not.toHaveAttribute("aria-invalid");
      expect(control).not.toHaveAttribute("aria-describedby");
    });
  });

  // -------------------------------------------------------------------------
  // Required state
  // -------------------------------------------------------------------------

  describe("required state", () => {
    test("shows the required indicator when required", () => {
      // Two copies by design: the header's visible marker, and the screen-reader-only description the
      // control points at - the header's marker sits outside the label, so it is not announced with the
      // control on its own.
      render(<Slider {...defaultProps} required />);

      expect(screen.getAllByText("Required")).toHaveLength(2);
    });

    test("shows a custom required label", () => {
      render(<Slider {...defaultProps} required requiredLabel="Mandatory" />);

      expect(screen.getAllByText("Mandatory")).toHaveLength(2);
    });

    test("shows no required indicator by default", () => {
      render(<Slider {...defaultProps} />);

      expect(screen.queryByText("Required")).not.toBeInTheDocument();
    });

    test("describes the required state on the control", () => {
      // The header's marker sits outside the label, so it is not announced with the control; this
      // description is what carries required-ness to assistive technology.
      render(<Slider {...defaultProps} required />);

      expect(getControl()).toHaveAttribute("aria-describedby", "test-slider-input-required");
      expect(document.getElementById("test-slider-input-required")).toHaveTextContent("Required");
    });

    test("describes a custom required label", () => {
      render(<Slider {...defaultProps} required requiredLabel="Mandatory" />);

      expect(document.getElementById("test-slider-input-required")).toHaveTextContent("Mandatory");
    });

    test("renders no required description when the element is optional", () => {
      render(<Slider {...defaultProps} />);

      expect(document.getElementById("test-slider-input-required")).not.toBeInTheDocument();
    });

    test("combines the required and error descriptions in reading order", () => {
      render(<Slider {...defaultProps} required errorMessage="Please select a value" />);

      expect(getControl()).toHaveAttribute(
        "aria-describedby",
        "test-slider-input-required test-slider-input-error"
      );
    });

    test("omits aria-required, which ARIA does not define for the slider role", () => {
      render(<Slider {...defaultProps} required />);

      expect(getControl()).not.toHaveAttribute("aria-required");
    });
  });

  // -------------------------------------------------------------------------
  // Accessibility
  // -------------------------------------------------------------------------

  describe("accessibility", () => {
    test("names the control with the headline through a real label association", () => {
      render(<Slider {...defaultProps} />);

      expect(screen.getByRole("slider", { name: "How satisfied are you?" })).toBeInTheDocument();
    });

    test("associates the label with the control id", () => {
      const { container } = render(<Slider {...defaultProps} />);
      const label = container.querySelector('label[for="test-slider-input"]');

      expect(label).toHaveTextContent("How satisfied are you?");
    });

    test("keeps the control in the tab order", () => {
      render(<Slider {...defaultProps} />);

      expect(getControl()).not.toHaveAttribute("tabindex");
    });
  });

  // -------------------------------------------------------------------------
  // Text direction
  // -------------------------------------------------------------------------

  describe("text direction", () => {
    test("applies RTL direction to the wrapper", () => {
      const { container } = render(<Slider {...defaultProps} dir="rtl" />);

      expect(container.querySelector("#test-slider")).toHaveAttribute("dir", "rtl");
    });

    test("passes RTL direction through to the platform control, which inverts the track", () => {
      render(<Slider {...defaultProps} dir="rtl" />);

      expect(getControl()).toHaveAttribute("dir", "rtl");
    });

    test("lets the control inherit direction when dir is auto", () => {
      // The platform accepts only ltr or rtl, so `auto` is mapped to inheritance rather than passed on.
      render(<Slider {...defaultProps} dir="auto" />);

      expect(getControl()).not.toHaveAttribute("dir");
    });

    test("defaults to inherited direction", () => {
      const { container } = render(<Slider {...defaultProps} />);

      expect(container.querySelector("#test-slider")).toHaveAttribute("dir", "auto");
      expect(getControl()).not.toHaveAttribute("dir");
    });
  });

  // -------------------------------------------------------------------------
  // Defensive rendering
  // -------------------------------------------------------------------------

  describe("defensive rendering", () => {
    test.each([
      ["a non-finite minimum", { min: Number.NEGATIVE_INFINITY, max: 100, step: 5, value: 50 }],
      ["a non-finite maximum", { min: 0, max: Number.POSITIVE_INFINITY, step: 5, value: 50 }],
      ["an inverted range", { min: 100, max: 0, step: 5, value: 50 }],
      ["a collapsed range", { min: 5, max: 5, step: 5, value: 5 }],
      ["a non-finite step", { min: 0, max: 100, step: Number.POSITIVE_INFINITY, value: 50 }],
      ["a NaN value", { min: 0, max: 100, step: 5, value: Number.NaN }],
    ] as [string, { min: number; max: number; step: number; value: number }][])(
      "renders without writing NaN into the markup for %s",
      (_label, props) => {
        const { container } = render(<Slider {...defaultProps} {...props} />);

        expect(container.innerHTML).not.toContain("NaN");
        expect(screen.getAllByRole("slider")).toHaveLength(1);
      }
    );

    test("stays operable after a degraded configuration renders", () => {
      // A non-finite bound makes the attribute invalid, so the platform falls back to its own default upper
      // bound and the control keeps working - reporting an ordinary finite number rather than NaN.
      render(<Slider {...defaultProps} max={Number.POSITIVE_INFINITY} />);

      selectValue(50);

      expect(defaultProps.onChange).toHaveBeenCalledWith(50);
      expect(Number.isFinite(defaultProps.onChange.mock.calls[0][0])).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Media
  // -------------------------------------------------------------------------

  describe("media", () => {
    test("renders an image above the headline", () => {
      render(<Slider {...defaultProps} imageUrl="https://example.com/image.png" />);

      expect(screen.getByRole("img")).toHaveAttribute("src", "https://example.com/image.png");
    });

    test("renders no media by default", () => {
      render(<Slider {...defaultProps} />);

      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });
  });
});
