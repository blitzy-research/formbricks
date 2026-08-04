// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Slider } from "../slider";

/**
 * The control delegates its interaction, snapping and accessibility contract to the Radix slider
 * primitive, so these specs assert the contract handed to that primitive and the behaviour this component
 * adds on top of it: which interactions record an answer, when they record it, and how the presentation
 * follows.
 *
 * Layout-dependent behaviour is exercised by stubbing the geometry the primitive measures, because
 * happy-dom renders no layout of its own. Anything that only a real browser can prove - actual dragging,
 * right-to-left inversion of the painted track, and focus rings - is verified there instead; what these
 * specs pin is that the primitive is handed the direction, bounds and grid it needs to produce them.
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
  // Typed, so the recorded arguments are numbers rather than `any` when they are read back.
  onChange: vi.fn<(value: number) => void>(),
};

/** The primitive puts `role="slider"` on its thumb, which is the element that carries the value. */
const getThumb = (): HTMLElement => screen.getByRole("slider");

/**
 * Whether `value` is exactly a point of the grid `min + n * step`.
 *
 * Deliberately independent of the component: the arithmetic below is the one the shared `stepMultipleOf`
 * response rule performs, which is the rule that decides whether a submitted answer is valid. Every operand
 * is restated as an exact decimal - taken, as the rule takes it, from the shortest string that round-trips
 * back to the same double - and the remainder is computed over BigInts, so neither a decimal step nor a
 * magnitude past the 53-bit mark can make the answer approximate. No tolerance is allowed here at all: the
 * rule forgives a couple of units in the last place, and asserting the stricter property is what proves the
 * control is not living inside that allowance.
 */
const isOnGrid = (value: number, min: number, step: number): boolean => {
  const toExactDecimal = (input: number): { digits: bigint; scale: number } => {
    const {
      sign = "",
      whole = "0",
      fraction = "",
      exponent = "0",
    } = /^(?<sign>-?)(?<whole>\d+)(?:\.(?<fraction>\d+))?(?:e(?<exponent>[+-]?\d+))?$/i.exec(String(input))
      ?.groups ?? {};
    let digits = BigInt(whole + fraction);
    let scale = fraction.length - Number(exponent);
    if (scale < 0) {
      digits *= 10n ** BigInt(-scale);
      scale = 0;
    }
    return { digits: sign === "-" ? -digits : digits, scale };
  };

  const parts = [value, min, step].map(toExactDecimal);
  const scale = Math.max(...parts.map((part) => part.scale));
  const [scaledValue, scaledMin, scaledStep] = parts.map(
    (part) => part.digits * 10n ** BigInt(scale - part.scale)
  );

  return scaledStep > 0n && (scaledValue - scaledMin) % scaledStep === 0n;
};

/** Locates one of the composition slots, failing loudly rather than asserting a missing element away. */
const getSlot = (container: HTMLElement, slot: string): HTMLElement => {
  const element = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  if (!element) {
    throw new Error(`no element with data-slot="${slot}" was rendered`);
  }
  return element;
};

/** Presses and releases a key on the thumb; the primitive listens for it on the root above. */
const pressKey = (key: string): void => {
  const thumb = getThumb();
  fireEvent.keyDown(thumb, { key });
  fireEvent.keyUp(thumb, { key });
};

/** Presses and releases a pointer on the thumb, which the primitive treats as a focus, not a slide. */
const pressThumb = (button = 0): void => {
  const thumb = getThumb();
  fireEvent.pointerDown(thumb, { button, pointerId: 1 });
  fireEvent.pointerUp(thumb, { button, pointerId: 1 });
};

/**
 * Presses and releases a pointer on the root.
 *
 * No geometry is stubbed, so the primitive measures a zero-width track and resolves the press to the
 * lower bound - the same value an unanswered thumb is already parked on, which is exactly the case the
 * primitive reports nothing for.
 */
const pressRoot = (container: HTMLElement, button = 0): void => {
  const root = getSlot(container, "slider");
  fireEvent.pointerDown(root, { button, pointerId: 1 });
  fireEvent.pointerUp(root, { button, pointerId: 1 });
};

/**
 * The pointer-capture methods this environment provides, captured once so `restoreGeometry` can put back
 * exactly what was there - including the absence of a method, which `undefined` records faithfully.
 */
const POINTER_CAPTURE_METHODS = ["setPointerCapture", "hasPointerCapture", "releasePointerCapture"] as const;
const originalPointerCapture: Record<string, unknown> = {};

/** Gives the primitive a measurable track and a working pointer-capture implementation. */
const stubGeometry = (container: HTMLElement, width = 100): void => {
  const root = getSlot(container, "slider");
  root.getBoundingClientRect = () =>
    ({
      width,
      height: 8,
      left: 0,
      top: 0,
      right: width,
      bottom: 8,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

  // Patched on the prototype because the primitive captures on whichever node the press landed on, which
  // this helper does not know. Recorded first so `restoreGeometry` leaves the environment as it found it -
  // a prototype these specs mutated permanently would make every later suite in the same file depend on
  // whether this one had run.
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  for (const method of POINTER_CAPTURE_METHODS) {
    if (!(method in originalPointerCapture)) {
      originalPointerCapture[method] = proto[method];
    }
  }

  proto.setPointerCapture = function setPointerCapture(this: Record<string, unknown>): void {
    this.__captured = true;
  };
  proto.hasPointerCapture = function hasPointerCapture(this: Record<string, unknown>): boolean {
    return Boolean(this.__captured);
  };
  proto.releasePointerCapture = function releasePointerCapture(this: Record<string, unknown>): void {
    this.__captured = false;
  };
};

/** Undoes `stubGeometry`'s prototype patches. A no-op when no spec in the run stubbed anything. */
const restoreGeometry = (): void => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  for (const method of POINTER_CAPTURE_METHODS) {
    if (!(method in originalPointerCapture)) continue;

    const original = originalPointerCapture[method];
    if (original === undefined) {
      Reflect.deleteProperty(proto, method);
    } else {
      proto[method] = original;
    }
    Reflect.deleteProperty(originalPointerCapture, method);
  }
};

/**
 * Drags across the track, reporting every intermediate position the way a pointer does.
 *
 * Positions are given in pixels along a 100px track, so they read as percentages of the configured range.
 * The button defaults to the primary one, which is the only press that expresses a selection.
 */
const drag = (container: HTMLElement, positions: number[], button = 0): void => {
  stubGeometry(container);
  const root = getSlot(container, "slider");
  const [first, ...rest] = positions;

  fireEvent.pointerDown(root, { button, pointerId: 1, clientX: first });
  for (const position of rest) {
    fireEvent.pointerMove(root, { pointerId: 1, clientX: position });
  }
  fireEvent.pointerUp(root, { button, pointerId: 1, clientX: positions[positions.length - 1] });
};

describe("Slider", () => {
  beforeEach(() => {
    defaultProps.onChange = vi.fn<(value: number) => void>();
  });

  afterEach(() => {
    restoreGeometry();
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

      // The visible copy specifically: the control also carries a hidden one, which is what names the
      // handle for assistive technology and is asserted in the accessibility group below.
      expect(
        screen.getByText("How satisfied are you?", { selector: '[data-variant="headline"]' })
      ).toBeInTheDocument();
    });

    test("renders the description when provided", () => {
      render(<Slider {...defaultProps} description="Pick a number" />);

      expect(
        screen.getByText("Pick a number", { selector: '[data-variant="description"]' })
      ).toBeInTheDocument();
    });

    test("does not render a description when none is provided", () => {
      render(<Slider {...defaultProps} />);

      expect(screen.queryByText("Pick a number")).not.toBeInTheDocument();
    });

    test("renders the track, range and thumb composition", () => {
      const { container } = render(<Slider {...defaultProps} />);

      expect(getSlot(container, "slider")).toBeInTheDocument();
      expect(getSlot(container, "slider-track")).toBeInTheDocument();
      expect(getSlot(container, "slider-range")).toBeInTheDocument();
      expect(getSlot(container, "slider-thumb")).toBeInTheDocument();
    });

    test("nests the fill inside the track and keeps the thumb its sibling", () => {
      const { container } = render(<Slider {...defaultProps} />);

      const track = getSlot(container, "slider-track");
      expect(getSlot(container, "slider-range").parentElement).toBe(track);
      expect(getSlot(container, "slider-thumb").closest(`[data-slot="slider-track"]`)).toBeNull();
    });

    test("applies the element id to the wrapper", () => {
      const { container } = render(<Slider {...defaultProps} />);

      expect(container.querySelector("#test-slider")).toBeInTheDocument();
    });

    test("renders the thumb as the element that carries the slider role", () => {
      const { container } = render(<Slider {...defaultProps} />);

      expect(getSlot(container, "slider-thumb")).toBe(getThumb());
    });
  });

  // -------------------------------------------------------------------------
  // Primitive contract
  // -------------------------------------------------------------------------

  describe("primitive contract", () => {
    test("carries the control id on the composition root", () => {
      const { container } = render(<Slider {...defaultProps} />);

      expect(getSlot(container, "slider")).toHaveAttribute("id", "test-slider-input");
    });

    test("publishes the configured bounds on the thumb", () => {
      render(<Slider {...defaultProps} />);

      expect(getThumb()).toHaveAttribute("aria-valuemin", "0");
      expect(getThumb()).toHaveAttribute("aria-valuemax", "100");
    });

    test("publishes bounds that do not start at zero", () => {
      render(<Slider {...defaultProps} min={10} max={50} />);

      expect(getThumb()).toHaveAttribute("aria-valuemin", "10");
      expect(getThumb()).toHaveAttribute("aria-valuemax", "50");
    });

    test("publishes the selected value on the thumb", () => {
      render(<Slider {...defaultProps} value={35} />);

      expect(getThumb()).toHaveAttribute("aria-valuenow", "35");
    });

    test("resolves the thumb rather than leaving it hidden", () => {
      // The primitive hides a thumb it cannot match to a value. A hidden thumb means the value never
      // reached it, which is the shape of a renderer-ordering defect rather than a styling choice.
      render(<Slider {...defaultProps} value={35} />);

      expect(getThumb().getAttribute("style") ?? "").not.toContain("display: none");
    });

    test("advertises the horizontal orientation", () => {
      const { container } = render(<Slider {...defaultProps} />);

      expect(getSlot(container, "slider")).toHaveAttribute("data-orientation", "horizontal");
      expect(getThumb()).toHaveAttribute("aria-orientation", "horizontal");
    });

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

    test("snaps to a decimal grid without floating-point drift", () => {
      render(<Slider {...defaultProps} min={0} max={1} step={0.1} />);

      pressKey("ArrowRight");

      expect(defaultProps.onChange).toHaveBeenCalledWith(0.1);
    });

    test("snaps to a grid finer than a whole number of decimal places", () => {
      render(<Slider {...defaultProps} min={0} max={0.01} step={0.0007} />);

      pressKey("ArrowRight");

      expect(defaultProps.onChange).toHaveBeenCalledWith(0.0007);
    });

    test("snaps to an offset decimal grid from its own origin", () => {
      // The primitive rounds to the step's own precision, which would land on 0.2 - a point that is not on
      // the 0.05 + n * 0.1 grid the shared response rule enforces, and would be rejected on submission.
      render(<Slider {...defaultProps} min={0.05} max={1} step={0.1} />);

      pressKey("ArrowRight");

      expect(defaultProps.onChange).toHaveBeenCalledWith(0.15);
    });

    test("advances one step at a time on a grid whose origin is finer than its step", () => {
      render(<Slider {...defaultProps} min={10.5} max={20.5} step={1} value={10.5} />);

      pressKey("ArrowRight");
      expect(defaultProps.onChange).toHaveBeenLastCalledWith(11.5);
      expect(getThumb()).toHaveAttribute("aria-valuenow", "11.5");

      pressKey("ArrowRight");
      expect(defaultProps.onChange).toHaveBeenLastCalledWith(12.5);
    });

    test("steps back onto the same offset grid", () => {
      render(<Slider {...defaultProps} min={10.5} max={20.5} step={1} value={12.5} />);

      pressKey("ArrowLeft");

      expect(defaultProps.onChange).toHaveBeenCalledWith(11.5);
    });

    test("holds the upper end of an offset grid inside the configured range", () => {
      // 10.5 + n * 1 never reaches 20, so the highest selectable point is 19.5 rather than the bound.
      render(<Slider {...defaultProps} min={10.5} max={20} step={1} value={18.5} />);

      pressKey("End");

      expect(defaultProps.onChange).toHaveBeenCalledWith(19.5);
    });

    test("leaves a value the primitive already placed on the grid exactly as reported", () => {
      // Three tenths from zero: the primitive already cleans this to 0.3, and re-deriving it would put the
      // binary-fraction noise back.
      render(<Slider {...defaultProps} min={0} max={1} step={0.1} value={0.2} />);

      pressKey("ArrowRight");

      expect(defaultProps.onChange).toHaveBeenCalledWith(0.3);
    });

    test("jumps by ten steps on a page key", () => {
      render(<Slider {...defaultProps} />);

      pressKey("PageUp");

      expect(defaultProps.onChange).toHaveBeenCalledWith(50);
    });

    test("snaps to the upper bound on End", () => {
      render(<Slider {...defaultProps} />);

      pressKey("End");

      expect(defaultProps.onChange).toHaveBeenCalledWith(100);
    });

    test("falls back to a unit grid when the configuration describes none", () => {
      // A zero step would make the primitive divide by zero while snapping. The element schema rejects it,
      // so this only keeps a draft an author is still typing operable.
      render(<Slider {...defaultProps} step={0} />);

      pressKey("ArrowRight");

      expect(defaultProps.onChange).toHaveBeenCalledWith(1);
    });

    test("keeps a value below the lower bound out of the published value", () => {
      render(<Slider {...defaultProps} value={-20} />);

      expect(getThumb()).toHaveAttribute("aria-valuenow", "0");
    });

    test("keeps a value above the upper bound out of the published value", () => {
      render(<Slider {...defaultProps} value={140} />);

      expect(getThumb()).toHaveAttribute("aria-valuenow", "100");
    });

    test("reads the value out in the element's own numbers, not as a position on a scale", () => {
      render(<Slider {...defaultProps} min={10} max={50} step={5} value={30} />);

      expect(getThumb()).toHaveAttribute("aria-valuetext", "30");
    });
  });

  // -------------------------------------------------------------------------
  // The grid, at magnitudes and precisions where approximation breaks down
  //
  // Every value here has to be a point of `min + n * step`, because that is the set the shared response rule
  // accepts. A control that reports anything else persists an answer the respondent did not choose - and one
  // the server then rejects.
  // -------------------------------------------------------------------------

  describe("the grid holds at every magnitude the schema admits", () => {
    test("selects the maximum of a range far too wide for a relative tolerance", () => {
      // A billion steps. Counting them by division needs a tolerance for binary-fraction noise, and any
      // tolerance proportional to the count is a whole step by the time it reaches this end of the range:
      // End resolved to 999,999,999 - a valid, on-grid, silently wrong answer.
      render(<Slider {...defaultProps} min={0} max={1_000_000_000} step={1} />);

      pressKey("End");

      expect(defaultProps.onChange).toHaveBeenCalledWith(1_000_000_000);
    });

    test("steps by one at the top of a range a billion steps wide", () => {
      render(<Slider {...defaultProps} min={0} max={1_000_000_000} step={1} value={999_999_999} />);

      pressKey("ArrowRight");

      expect(defaultProps.onChange).toHaveBeenCalledWith(1_000_000_000);
    });

    test("selects a grid point on a step too fine for the primitive to round to", () => {
      // `1e-7` prints without a decimal point, so reading its precision from its printed form gives zero
      // places - which would round every position on this grid to a whole number.
      render(<Slider {...defaultProps} min={0} max={1} step={1e-7} />);

      pressKey("ArrowRight");

      expect(defaultProps.onChange).toHaveBeenCalledWith(1e-7);
    });

    test("reaches the maximum of a grid a step too fine to round would collapse", () => {
      render(<Slider {...defaultProps} min={0} max={1} step={1e-7} />);

      pressKey("End");

      expect(defaultProps.onChange).toHaveBeenCalledWith(1);
    });

    test("keeps a fine grid anchored on a large origin", () => {
      render(<Slider {...defaultProps} min={1_000_000} max={1_000_001} step={1e-7} />);

      pressKey("ArrowRight");

      expect(defaultProps.onChange).toHaveBeenCalledWith(1_000_000.0000001);
    });

    test("stays inside the double range at magnitudes where one more step would leave it", () => {
      // The reconstruction of the second point of this grid is not a finite number, so the grid has exactly
      // one point and the control reports that rather than an Infinity.
      render(<Slider {...defaultProps} min={1.7e308} max={1.79e308} step={1e307} />);

      pressKey("End");

      expect(defaultProps.onChange).toHaveBeenCalledWith(1.7e308);
      expect(Number.isFinite(defaultProps.onChange.mock.calls[0][0])).toBe(true);
    });

    test.each([
      ["a whole grid", { min: 0, max: 100, step: 5 }],
      ["a decimal grid", { min: 0, max: 1, step: 0.1 }],
      ["an origin finer than the step", { min: 10.5, max: 20.5, step: 1 }],
      ["a grid whose last point overshoots the maximum", { min: 0, max: 10, step: 3 }],
      ["a grid spanning zero", { min: -50, max: 50, step: 0.5 }],
      ["a step finer than the primitive can round", { min: 0, max: 1, step: 1e-7 }],
      ["a fine grid on a large origin", { min: 1_000_000, max: 1_000_001, step: 1e-7 }],
      ["a range a billion steps wide", { min: 0, max: 1_000_000_000, step: 1 }],
    ] as [string, { min: number; max: number; step: number }][])(
      "reports only points of %s",
      (_label, config) => {
        const { container, unmount } = render(<Slider {...defaultProps} {...config} />);
        stubGeometry(container);

        // Every key that moves the handle, from both ends of the range, so the assertion covers the
        // positions an interaction can actually resolve to rather than one sample.
        for (const key of ["End", "Home", "ArrowRight", "PageUp", "ArrowLeft", "PageDown"]) {
          pressKey(key);
        }
        unmount();

        expect(defaultProps.onChange.mock.calls.length).toBeGreaterThan(0);
        for (const [reported] of defaultProps.onChange.mock.calls) {
          expect(Number.isFinite(reported)).toBe(true);
          expect(reported).toBeGreaterThanOrEqual(config.min);
          expect(reported).toBeLessThanOrEqual(config.max);
          expect(isOnGrid(reported, config.min, config.step)).toBe(true);
        }
      }
    );
  });

  // -------------------------------------------------------------------------
  // Recording an answer
  // -------------------------------------------------------------------------

  describe("recording an answer", () => {
    test("emits nothing on mount", () => {
      render(<Slider {...defaultProps} />);

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("emits nothing on mount when already answered", () => {
      render(<Slider {...defaultProps} value={40} />);

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("emits nothing when re-rendered with a new value", () => {
      const { rerender } = render(<Slider {...defaultProps} value={40} />);

      rerender(<Slider {...defaultProps} value={60} />);

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("reports a number, not a string", () => {
      render(<Slider {...defaultProps} />);

      pressKey("ArrowRight");

      expect(typeof defaultProps.onChange.mock.calls[0][0]).toBe("number");
    });

    test("reports exactly once per key press", () => {
      render(<Slider {...defaultProps} />);

      pressKey("ArrowRight");

      expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    });

    test("reports once per key press across a run of them", () => {
      render(<Slider {...defaultProps} value={50} />);

      pressKey("ArrowRight");
      pressKey("ArrowRight");

      expect(defaultProps.onChange.mock.calls.map((call) => call[0])).toEqual([55, 60]);
    });

    test("reports a negative value on a range spanning zero", () => {
      render(<Slider {...defaultProps} min={-50} max={50} step={10} />);

      pressKey("ArrowRight");

      expect(defaultProps.onChange).toHaveBeenCalledWith(-40);
    });

    test("never reports a value that is not a finite number", () => {
      render(<Slider {...defaultProps} />);

      pressKey("ArrowRight");
      pressKey("End");

      for (const [reported] of defaultProps.onChange.mock.calls) {
        expect(Number.isFinite(reported)).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // One answer per interaction
  //
  // A drag reports a position for every movement. Only the settled value is recorded, because each
  // recorded value clones the renderer's response and timing records.
  // -------------------------------------------------------------------------

  describe("one answer per interaction", () => {
    test("records a drag once, with the value it settled on", () => {
      const { container } = render(<Slider {...defaultProps} />);

      drag(container, [10, 30, 55, 80]);

      expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
      expect(defaultProps.onChange).toHaveBeenCalledWith(80);
    });

    test("does not record anything while the pointer is still down", () => {
      const { container } = render(<Slider {...defaultProps} />);
      stubGeometry(container);
      const root = getSlot(container, "slider");

      fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: 20 });
      fireEvent.pointerMove(root, { pointerId: 1, clientX: 45 });
      fireEvent.pointerMove(root, { pointerId: 1, clientX: 70 });

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("follows the pointer visually while the answer waits", () => {
      const { container } = render(<Slider {...defaultProps} />);
      stubGeometry(container);
      const root = getSlot(container, "slider");

      fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: 20 });
      expect(getThumb()).toHaveAttribute("aria-valuenow", "20");

      fireEvent.pointerMove(root, { pointerId: 1, clientX: 65 });
      expect(getThumb()).toHaveAttribute("aria-valuenow", "65");
      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("tracks the readout while the answer waits", () => {
      const { container } = render(<Slider {...defaultProps} />);
      stubGeometry(container);
      const root = getSlot(container, "slider");

      fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: 20 });
      expect(container.querySelector("output")).toHaveTextContent("20");

      fireEvent.pointerMove(root, { pointerId: 1, clientX: 65 });
      expect(container.querySelector("output")).toHaveTextContent("65");
    });

    test("records each of two consecutive drags once", () => {
      const { container } = render(<Slider {...defaultProps} />);

      drag(container, [10, 40]);
      drag(container, [40, 75]);

      expect(defaultProps.onChange.mock.calls.map((call) => call[0])).toEqual([40, 75]);
    });

    test("records nothing for a drag that ends where it began", () => {
      const { container } = render(<Slider {...defaultProps} value={40} />);

      drag(container, [40, 70, 40]);

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Abandoned interactions
  //
  // A drag that is cancelled rather than released - the browser taking the pointer away, a gesture the
  // system claims - expresses no selection at all. What the respondent sees must go back to the answer that
  // is actually recorded, or the handle and the readout claim an answer that was never sent.
  // -------------------------------------------------------------------------

  describe("a cancelled interaction", () => {
    /** Drags without releasing, then lets the pointer be taken away. */
    const dragAndCancel = (container: HTMLElement, positions: number[]): void => {
      stubGeometry(container);
      const root = getSlot(container, "slider");
      const [first, ...rest] = positions;

      fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: first });
      for (const position of rest) {
        fireEvent.pointerMove(root, { pointerId: 1, clientX: position });
      }
      fireEvent.pointerCancel(root, { pointerId: 1 });
    };

    test("records nothing", () => {
      const { container } = render(<Slider {...defaultProps} value={40} />);

      dragAndCancel(container, [40, 75]);

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("returns the handle to the recorded answer", () => {
      const { container } = render(<Slider {...defaultProps} value={40} />);

      dragAndCancel(container, [40, 75]);

      expect(getThumb()).toHaveAttribute("aria-valuenow", "40");
    });

    test("returns the readout to the recorded answer", () => {
      const { container } = render(<Slider {...defaultProps} value={40} />);

      dragAndCancel(container, [40, 75]);

      expect(container.querySelector("output")).toHaveTextContent("40");
    });

    test("returns an untouched control to showing no answer at all", () => {
      const { container } = render(<Slider {...defaultProps} />);

      dragAndCancel(container, [30, 75]);

      expect(container.querySelector("output")).not.toBeInTheDocument();
      expect(getThumb().className).toContain("bg-input-bg");
      expect(getThumb()).toHaveAttribute("aria-valuenow", "0");
    });

    test("leaves the control usable afterwards", () => {
      const { container } = render(<Slider {...defaultProps} value={40} />);

      dragAndCancel(container, [40, 75]);
      pressKey("ArrowRight");

      expect(defaultProps.onChange).toHaveBeenCalledWith(45);
    });
  });

  // -------------------------------------------------------------------------
  // Presses the control does not act on
  //
  // Only a primary press is a selection. The primitive itself acts on every press it sees, so a secondary
  // one has to be refused before it reaches the primitive rather than merely left unrecorded.
  // -------------------------------------------------------------------------

  describe("non-primary presses", () => {
    test.each([
      ["secondary", 2],
      ["middle", 1],
    ] as [string, number][])("records nothing for a %s press on the track", (_label, button) => {
      const { container } = render(<Slider {...defaultProps} />);

      drag(container, [70], button);

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test.each([
      ["secondary", 2],
      ["middle", 1],
    ] as [string, number][])("does not move the handle for a %s press on the track", (_label, button) => {
      const { container } = render(<Slider {...defaultProps} value={20} />);

      drag(container, [70], button);

      expect(getThumb()).toHaveAttribute("aria-valuenow", "20");
    });

    test("still answers a primary press after a secondary one was refused", () => {
      const { container } = render(<Slider {...defaultProps} />);

      drag(container, [70], 2);
      drag(container, [70], 0);

      expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
      expect(defaultProps.onChange).toHaveBeenCalledWith(70);
    });
  });

  // -------------------------------------------------------------------------
  // Correcting a stored value the presentation cannot show
  //
  // A value outside the range, or off the grid, has no position on the track, so the handle is drawn at the
  // nearest point it does have. The respondent has to be able to accept that position - otherwise the
  // question shows an invalid answer that no interaction can replace.
  // -------------------------------------------------------------------------

  describe("recovering from a value the control cannot show", () => {
    test("records the bound the handle was held at when that end of the track is pressed", () => {
      const { container } = render(<Slider {...defaultProps} value={140} />);

      // A press at the far end of the track, where the handle is already being held. The primitive reports
      // nothing for it, because the tick it resolves to is the tick it already holds.
      drag(container, [100]);

      expect(defaultProps.onChange).toHaveBeenCalledWith(100);
    });

    test("records the bound the handle was held at when the handle itself is pressed", () => {
      render(<Slider {...defaultProps} value={140} />);

      pressThumb();

      expect(defaultProps.onChange).toHaveBeenCalledWith(100);
    });

    test("records the bound the handle was held at when a key resolves to it", () => {
      render(<Slider {...defaultProps} value={-20} />);

      pressKey("Home");

      expect(defaultProps.onChange).toHaveBeenCalledWith(0);
    });

    test("records the nearest grid point for a stored value that sits between two", () => {
      render(<Slider {...defaultProps} value={7} />);

      pressThumb();

      expect(defaultProps.onChange).toHaveBeenCalledWith(5);
    });

    test("records nothing when the stored value is the one being shown", () => {
      render(<Slider {...defaultProps} value={45} />);

      pressThumb();
      pressKey("Home");
      pressKey("ArrowRight");

      // Home moves to 0 and the arrow back to 5; the press on the value already held records nothing.
      expect(defaultProps.onChange.mock.calls.map((call) => call[0])).toEqual([0, 5]);
    });
  });

  // -------------------------------------------------------------------------
  // Unanswered state
  // -------------------------------------------------------------------------

  describe("unanswered state", () => {
    test("parks the thumb at the lower bound while unanswered", () => {
      render(<Slider {...defaultProps} />);

      expect(getThumb()).toHaveAttribute("aria-valuenow", "0");
    });

    test("parks the thumb at a non-zero lower bound while unanswered", () => {
      render(<Slider {...defaultProps} min={10} max={50} />);

      expect(getThumb()).toHaveAttribute("aria-valuenow", "10");
    });

    test("distinguishes an unanswered thumb from one answered with the lower bound", () => {
      const { rerender } = render(<Slider {...defaultProps} />);
      expect(getThumb().className).toContain("bg-input-bg");

      rerender(<Slider {...defaultProps} value={0} />);

      expect(getThumb().className).toContain("bg-brand");
      expect(getThumb().className).not.toContain("bg-input-bg");
    });

    test.each([
      ["undefined", undefined],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
    ] as [string, number | undefined][])("treats %s as unanswered", (_label, value) => {
      const { container } = render(<Slider {...defaultProps} value={value} />);

      expect(container.querySelector("output")).not.toBeInTheDocument();
      expect(getThumb().className).toContain("bg-input-bg");
    });
  });

  // -------------------------------------------------------------------------
  // Selecting the parked value
  //
  // The primitive reports nothing when an interaction resolves to the value already held, so every
  // interaction asking for the lower bound of an unanswered slider would otherwise go unrecorded.
  // -------------------------------------------------------------------------

  describe("selecting the parked value", () => {
    test.each(["Home", "ArrowLeft", "ArrowDown", "PageDown"])(
      "records the lower bound when %s resolves to it",
      (key) => {
        render(<Slider {...defaultProps} />);

        pressKey(key);

        expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
        expect(defaultProps.onChange).toHaveBeenCalledWith(0);
      }
    );

    test("records a lower bound that is not zero, which is not a special case", () => {
      render(<Slider {...defaultProps} min={10} max={50} />);

      pressKey("Home");

      expect(defaultProps.onChange).toHaveBeenCalledWith(10);
    });

    test("records a negative lower bound", () => {
      render(<Slider {...defaultProps} min={-40} max={40} step={10} />);

      pressKey("Home");

      expect(defaultProps.onChange).toHaveBeenCalledWith(-40);
    });

    test("records the lower bound when a press lands on the parked thumb", () => {
      render(<Slider {...defaultProps} />);

      pressThumb();

      expect(defaultProps.onChange).toHaveBeenCalledWith(0);
    });

    test("records the lower bound when a press lands on the track", () => {
      const { container } = render(<Slider {...defaultProps} />);

      pressRoot(container);

      expect(defaultProps.onChange).toHaveBeenCalledWith(0);
    });

    test("records the lower bound while the required error is showing", () => {
      render(<Slider {...defaultProps} required errorMessage="Please select a value" />);

      pressThumb();

      expect(defaultProps.onChange).toHaveBeenCalledWith(0);
    });

    test("records the lower bound once, not once per event", () => {
      render(<Slider {...defaultProps} />);

      pressThumb();
      pressKey("Home");
      pressThumb();

      expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
    });

    test("records a number, not a string", () => {
      render(<Slider {...defaultProps} />);

      pressThumb();

      expect(typeof defaultProps.onChange.mock.calls[0][0]).toBe("number");
    });

    test("records nothing for a release whose press began elsewhere", () => {
      const { container } = render(<Slider {...defaultProps} />);

      fireEvent.pointerUp(getSlot(container, "slider"), { button: 0, pointerId: 1 });

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("records nothing for a press with a button the control ignores", () => {
      render(<Slider {...defaultProps} />);

      pressThumb(2);

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("records nothing after a press is cancelled", () => {
      const { container } = render(<Slider {...defaultProps} />);
      const root = getSlot(container, "slider");

      fireEvent.pointerDown(root, { button: 0, pointerId: 1 });
      fireEvent.pointerCancel(root, { pointerId: 1 });
      fireEvent.pointerUp(root, { button: 0, pointerId: 1 });

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("records nothing for a press on the thumb of an answered control", () => {
      render(<Slider {...defaultProps} value={40} />);

      pressThumb();

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("records nothing for a press on the thumb of a control answered with the lower bound", () => {
      render(<Slider {...defaultProps} value={0} />);

      pressThumb();

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("records nothing for a key that cannot move the thumb", () => {
      // `Enter` submits the surrounding form, so treating it as a selection would silently answer an
      // untouched required slider with its lower bound.
      render(<Slider {...defaultProps} />);

      pressKey("Enter");
      pressKey(" ");
      pressKey("Tab");

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("records nothing while disabled", () => {
      const { container } = render(<Slider {...defaultProps} disabled />);

      pressThumb();
      pressKey("Home");
      pressRoot(container);

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("does not record twice when the interaction moved the value itself", () => {
      const { container } = render(<Slider {...defaultProps} />);

      drag(container, [10, 60]);

      expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
      expect(defaultProps.onChange).toHaveBeenCalledWith(60);
    });
  });

  // -------------------------------------------------------------------------
  // Readout
  // -------------------------------------------------------------------------

  describe("readout", () => {
    test("renders the readout for the selected value by default", () => {
      const { container } = render(<Slider {...defaultProps} value={35} />);

      expect(container.querySelector("output")).toHaveTextContent("35");
    });

    test("binds the readout to the control that produced the value", () => {
      const { container } = render(<Slider {...defaultProps} value={35} />);

      expect(container.querySelector("output")).toHaveAttribute("for", "test-slider-input");
    });

    test("does not render the readout when showValue is false", () => {
      const { container } = render(<Slider {...defaultProps} value={35} showValue={false} />);

      expect(container.querySelector("output")).not.toBeInTheDocument();
    });

    test("does not render the readout while unanswered", () => {
      const { container } = render(<Slider {...defaultProps} />);

      expect(container.querySelector("output")).not.toBeInTheDocument();
    });

    test("renders a readout for the lower bound, which is a real answer", () => {
      const { container } = render(<Slider {...defaultProps} value={0} />);

      expect(container.querySelector("output")).toHaveTextContent("0");
    });

    test("shows a decimal answer at its own precision", () => {
      const { container } = render(<Slider {...defaultProps} min={0} max={1} step={0.1} value={0.3} />);

      expect(container.querySelector("output")).toHaveTextContent("0.3");
    });

    test("shows an answer above the maximum as the value it actually is", () => {
      // The handle can only be drawn inside the track, but the readout is the answer on record: showing the
      // clamped position instead would hide the very number the respondent has to correct while the shared
      // evaluator reports it as out of range.
      const { container } = render(<Slider {...defaultProps} value={140} errorMessage="Too high" />);

      expect(container.querySelector("output")).toHaveTextContent("140");
      expect(getThumb()).toHaveAttribute("aria-valuenow", "100");
      expect(screen.getByText("Too high")).toBeInTheDocument();
    });

    test("shows an answer below the minimum as the value it actually is", () => {
      const { container } = render(<Slider {...defaultProps} min={10} max={100} value={5} />);

      expect(container.querySelector("output")).toHaveTextContent("5");
      expect(getThumb()).toHaveAttribute("aria-valuenow", "10");
    });

    test("keeps the readout in the answered state when the value readout is suppressed", () => {
      // Suppressing the readout must not change what counts as answered: the thumb still fills.
      render(<Slider {...defaultProps} value={35} showValue={false} />);

      expect(getThumb().className).toContain("bg-brand");
    });
  });

  // -------------------------------------------------------------------------
  // Presentation
  // -------------------------------------------------------------------------

  describe("presentation", () => {
    test("fills the track up to the selected value", () => {
      const { container } = render(<Slider {...defaultProps} value={25} />);

      expect(getSlot(container, "slider-range").getAttribute("style") ?? "").toContain("right: 75%");
    });

    test("measures the fill from the lower bound rather than from zero", () => {
      const { container } = render(<Slider {...defaultProps} min={10} max={50} value={20} />);

      // A quarter of the way along 10..50.
      expect(getSlot(container, "slider-range").getAttribute("style") ?? "").toContain("right: 75%");
    });

    test("leaves the track unfilled while unanswered", () => {
      const { container } = render(<Slider {...defaultProps} />);

      expect(getSlot(container, "slider-range").getAttribute("style") ?? "").toContain("right: 100%");
    });

    test("positions the thumb at the selected value", () => {
      const { container } = render(<Slider {...defaultProps} value={25} />);

      expect(getSlot(container, "slider-thumb").parentElement?.getAttribute("style") ?? "").toContain("25%");
    });

    test("styles the track and the fill from design tokens alone", () => {
      const { container } = render(<Slider {...defaultProps} value={50} />);

      const track = getSlot(container, "slider-track");
      expect(track.className).toContain("bg-input-bg");
      expect(track.className).toContain("border-input-border");
      expect(track.className).toContain("rounded-input");
      expect(getSlot(container, "slider-range").className).toContain("bg-brand");
    });

    test("styles the thumb from design tokens alone", () => {
      render(<Slider {...defaultProps} value={50} />);

      expect(getThumb().className).toContain("border-brand");
      expect(getThumb().className).toContain("bg-brand");
    });

    test("gives the thumb the focus and hover affordances a respondent needs", () => {
      render(<Slider {...defaultProps} />);

      expect(getThumb().className).toContain("focus-visible:ring-ring/50");
      expect(getThumb().className).toContain("hover:ring-brand-20");
    });

    test("keeps the thumb's DOM node stable once the primitive has resolved it", () => {
      // The compat repair replaces the thumb node when the primitive fails to publish a value. A renderer
      // that resolves it on the first pass must not pay for that, so the node must survive a re-render.
      const { rerender } = render(<Slider {...defaultProps} value={20} />);
      const before = getThumb();

      rerender(<Slider {...defaultProps} value={40} />);

      expect(getThumb()).toBe(before);
      expect(getThumb()).toHaveAttribute("aria-valuenow", "40");
    });
  });

  // -------------------------------------------------------------------------
  // Disabled state
  // -------------------------------------------------------------------------

  describe("disabled state", () => {
    test("marks the composition disabled", () => {
      const { container } = render(<Slider {...defaultProps} disabled />);

      expect(getSlot(container, "slider")).toHaveAttribute("data-disabled");
      expect(getSlot(container, "slider")).toHaveAttribute("aria-disabled", "true");
    });

    test("is enabled by default", () => {
      const { container } = render(<Slider {...defaultProps} />);

      expect(getSlot(container, "slider")).not.toHaveAttribute("data-disabled");
      expect(getSlot(container, "slider")).toHaveAttribute("aria-disabled", "false");
    });

    test("takes the thumb out of the tab order while disabled", () => {
      render(<Slider {...defaultProps} disabled />);

      expect(getThumb()).not.toHaveAttribute("tabindex");
    });

    test("records nothing from a drag while disabled", () => {
      const { container } = render(<Slider {...defaultProps} disabled />);

      drag(container, [10, 60]);

      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    test("dims the composition while disabled", () => {
      const { container } = render(<Slider {...defaultProps} disabled />);

      expect(getSlot(container, "slider").className).toContain("opacity-50");
    });

    test("withdraws the pointer affordance while disabled", () => {
      const { container } = render(<Slider {...defaultProps} disabled />);

      expect(getSlot(container, "slider").className).toContain("cursor-not-allowed");
      expect(getThumb().className).not.toContain("hover:ring-brand-20");
    });

    test("advertises the pointer affordance while enabled", () => {
      const { container } = render(<Slider {...defaultProps} />);

      expect(getSlot(container, "slider").className).toContain("cursor-pointer");
      expect(getSlot(container, "slider").className).not.toContain("opacity-50");
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
      const { container } = render(<Slider {...defaultProps} />);

      expect(container.querySelector(".justify-between")).not.toBeInTheDocument();
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
      render(<Slider {...defaultProps} upperLabel="Extremely" />);

      expect(screen.getByText("Extremely").className).toContain("ms-auto");
    });

    test("keeps the lower label at the start of the row", () => {
      render(<Slider {...defaultProps} lowerLabel="Not at all" />);

      expect(screen.getByText("Not at all").className).not.toContain("ms-auto");
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

    test("marks the thumb invalid and points it at the message", () => {
      render(<Slider {...defaultProps} errorMessage="Please select a value" />);

      expect(getThumb()).toHaveAttribute("aria-invalid", "true");
      expect(getThumb()).toHaveAttribute("aria-describedby", "test-slider-input-error");
      expect(document.getElementById("test-slider-input-error")).toHaveTextContent("Please select a value");
    });

    test("reports a valid thumb and describes nothing when there is no error", () => {
      render(<Slider {...defaultProps} />);

      expect(getThumb()).not.toHaveAttribute("aria-invalid");
      expect(getThumb()).not.toHaveAttribute("aria-describedby");
    });
  });

  // -------------------------------------------------------------------------
  // Required state
  // -------------------------------------------------------------------------

  describe("required state", () => {
    test("shows the required indicator when required", () => {
      // Two copies by design: the header's visible marker, and the screen-reader-only description the
      // thumb points at - the header's marker sits outside the label, so it is not announced on its own.
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

    test("describes the required state on the thumb", () => {
      render(<Slider {...defaultProps} required />);

      expect(getThumb()).toHaveAttribute("aria-describedby", "test-slider-input-required");
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

      expect(getThumb()).toHaveAttribute(
        "aria-describedby",
        "test-slider-input-required test-slider-input-error"
      );
    });

    test("claims no required state on a node that cannot express one", () => {
      // ARIA defines no required state for the `slider` role, so it belongs on neither the handle that
      // carries that role nor the composition root, which carries no role at all: on either it would be an
      // attribute nothing reads. The description above is what actually announces it.
      const { container } = render(<Slider {...defaultProps} required />);

      expect(getSlot(container, "slider")).not.toHaveAttribute("aria-required");
      expect(getThumb()).not.toHaveAttribute("aria-required");
      expect(getThumb()).toHaveAccessibleDescription("Required");
    });
  });

  // -------------------------------------------------------------------------
  // Accessibility
  // -------------------------------------------------------------------------

  describe("accessibility", () => {
    test("names the thumb with the headline", () => {
      render(<Slider {...defaultProps} />);

      expect(getThumb()).toHaveAccessibleName("How satisfied are you?");
    });

    test("names the thumb with the words of a headline written in a rich editor, not its markup", () => {
      render(<Slider {...defaultProps} headline="<p>How <strong>satisfied</strong> are you?</p>" />);

      expect(getThumb()).toHaveAccessibleName("How satisfied are you?");
    });

    test("describes the thumb with the description", () => {
      render(<Slider {...defaultProps} description="Pick a number" />);

      expect(getThumb()).toHaveAccessibleDescription("Pick a number");
    });

    test("describes the thumb with the description, the required state and the error in reading order", () => {
      render(
        <Slider {...defaultProps} description="Pick a number" required errorMessage="Please select a value" />
      );

      expect(getThumb()).toHaveAccessibleDescription("Pick a number Required Please select a value");
    });

    test("keeps the name and description sources out of the reading order", () => {
      // They repeat the header, which is already read; a node referenced by id still supplies its text.
      const { container } = render(<Slider {...defaultProps} description="Pick a number" />);

      expect(container.querySelector("#test-slider-input-label")).toHaveAttribute("aria-hidden", "true");
      expect(container.querySelector("#test-slider-input-description")).toHaveAttribute(
        "aria-hidden",
        "true"
      );
    });

    test("does not label the composition root, which a label cannot be associated with", () => {
      // `role="slider"` is on the thumb, and the root is a `span`: a `label[for]` pointing at it resolves to
      // nothing. The id stays, because the value readout's `for` may reference any element.
      const { container } = render(<Slider {...defaultProps} />);

      expect(container.querySelector('label[for="test-slider-input"]')).not.toBeInTheDocument();
      expect(getSlot(container, "slider")).toHaveAttribute("id", "test-slider-input");
    });

    test("keeps the thumb in the tab order", () => {
      render(<Slider {...defaultProps} />);

      expect(getThumb()).toHaveAttribute("tabindex", "0");
    });

    test("focuses the thumb rather than a wrapper", () => {
      render(<Slider {...defaultProps} />);

      getThumb().focus();

      expect(document.activeElement).toBe(getThumb());
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

    test("hands RTL direction to the primitive, which inverts the track", () => {
      const { container } = render(<Slider {...defaultProps} dir="rtl" value={25} />);

      expect(getSlot(container, "slider")).toHaveAttribute("dir", "rtl");
      // The fill grows from the right in RTL, so the same value anchors to the opposite edge.
      expect(getSlot(container, "slider-range").getAttribute("style") ?? "").toContain("right: 0%");
    });

    test("lets the primitive resolve the direction when dir is auto", () => {
      // "auto" is not a direction the primitive understands, so it is withheld and the primitive resolves
      // left-to-right for itself rather than being handed a value it cannot read.
      const { container } = render(<Slider {...defaultProps} dir="auto" />);

      expect(getSlot(container, "slider")).toHaveAttribute("dir", "ltr");
    });

    test("defaults to the auto direction contract", () => {
      const { container } = render(<Slider {...defaultProps} />);

      expect(container.querySelector("#test-slider")).toHaveAttribute("dir", "auto");
    });
  });

  // -------------------------------------------------------------------------
  // Defensive rendering
  // -------------------------------------------------------------------------

  describe("defensive rendering", () => {
    test.each([
      ["an inverted range", { min: 100, max: 0, step: 5, value: 50 }],
      ["a collapsed range", { min: 5, max: 5, step: 5, value: 5 }],
      ["a non-finite step", { min: 0, max: 100, step: Number.POSITIVE_INFINITY, value: 50 }],
      ["a negative step", { min: 0, max: 100, step: -5, value: 50 }],
      ["a NaN value", { min: 0, max: 100, step: 5, value: Number.NaN }],
    ] as [string, { min: number; max: number; step: number; value: number }][])(
      "renders a single usable control for %s",
      (_label, props) => {
        render(<Slider {...defaultProps} {...props} />);

        expect(screen.getAllByRole("slider")).toHaveLength(1);
        expect(getThumb().getAttribute("style") ?? "").not.toContain("display: none");
      }
    );

    test("stays operable after a degraded configuration renders", () => {
      render(<Slider {...defaultProps} step={-5} />);

      pressKey("ArrowRight");

      expect(defaultProps.onChange).toHaveBeenCalledTimes(1);
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
