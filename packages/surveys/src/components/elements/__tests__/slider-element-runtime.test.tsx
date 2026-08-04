// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { TResponseData, TResponseTtc } from "@formbricks/types/responses";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import type { TSurveySliderElement } from "@formbricks/types/surveys/elements";
import { SliderElement } from "../slider-element";

// ---------------------------------------------------------------------------
// Production-parity regression coverage for the slider control.
//
// Unlike every sibling runtime suite, this file deliberately does NOT mock `@formbricks/survey-ui`. It
// renders the real presentational control through the runtime wrapper, which means the control - and the
// `@radix-ui/react-slider` primitive underneath it - is loaded under this package's build aliases: `react`
// and `react-dom` resolve to `preact/compat` and `react/jsx-runtime` to `preact/jsx-runtime`
// (packages/surveys/vite.config.mts). That is exactly how the shipped ESM and UMD bundles resolve them.
//
// That distinction is the whole point of the suite, because the alias is not a formality here. The control's
// own specs in `@formbricks/survey-ui` run against real React, so any behaviour that depends on React's hook
// or effect scheduling passes there while failing in the browser. The primitive's own `SliderPrimitive.Thumb`
// does exactly that: it derives which value it owns in a `useMemo` whose data is registered by a PASSIVE
// effect. React flushes that effect before the re-render the thumb's ref callback schedules; Preact defers
// effects past it, so the index resolves to -1 and never recomputes. Rendered under this alias the
// primitive's thumb came out with `style="display: none"`, exposed no `aria-valuenow`, and answered every
// arrow key by reading `values[-1]` - a required 0..100 slider stepped once with the keyboard submitted
// nothing at all. The control keeps the primitive's whole composition, thumb included, and repairs that one
// lookup by replacing the thumb's DOM node once after the collection has been registered, which is what
// makes the memoised index recompute against a populated collection.
//
// Suite 1 below is the regression guard for precisely that failure: it asserts the handle is present,
// visible, focusable and carrying its value UNDER THE ALIAS. Suite 2 is the second half - that an
// interaction resolved by the primitive crosses the alias into the runtime's response data, exactly once.
//
// Every mocked-boundary concern (prop forwarding, time-to-completion arithmetic, localisation) is covered by
// `slider-element.test.tsx`; this suite covers only what a mock cannot see. Drag geometry belongs to layout,
// which jsdom does not implement, so a press is asserted for the report it produces rather than for a
// particular value, and dragging is verified in a real browser.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stub the icon library.
//
// This is one of two concessions the suite makes to the test runner, and it is a runner artifact rather than a
// production one. Vitest externalizes real `node_modules` packages, so `lucide-react` is loaded untransformed
// and its icons are built by REAL React's `forwardRef`, which returns an object. Preact cannot render an
// object-typed component and throws `InvalidCharacterError` on sight. The production build has no such split:
// `lucide-react` is bundled into `packages/surveys/dist`, so rollup resolves its `react` import through the
// same alias as everything else and the icons come out as Preact components.
//
// Only the icons are replaced - `ElementError`'s own markup, classes and direction handling still run for
// real, which is what the error assertion below is about. The three glyphs listed are every icon the
// components on this render path import: the alert in `ElementError` and the two in `ElementMedia`.
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => {
  // Declared inside the factory because `vi.mock` is hoisted above this file's own bindings, and rendered as
  // nothing at all so the stub needs no JSX runtime of its own - the glyph is decorative here.
  const StubIcon = () => null;
  return { AlertCircle: StubIcon, Download: StubIcon, ExternalLink: StubIcon };
});

// The second concession: jsdom implements neither pointer capture - which the primitive uses to keep a drag
// attached to the element the press started on - nor `ResizeObserver`, which the primitive's thumb uses to
// measure itself so it can offset its own position by half its width. Real browsers implement both, so these
// no-ops stand in for them rather than changing anything about how the control behaves: an unmeasured thumb is
// positioned from the value alone, which is all this suite reads.
beforeAll(() => {
  const globalScope = globalThis as unknown as Record<string, unknown>;
  globalScope.ResizeObserver ??= class ResizeObserverStub {
    observe(): void {
      /* jsdom stub */
    }
    unobserve(): void {
      /* jsdom stub */
    }
    disconnect(): void {
      /* jsdom stub */
    }
  };

  const target = Element.prototype as unknown as Record<string, unknown>;
  target.setPointerCapture ??= function setPointerCapture(): void {
    /* jsdom stub */
  };
  target.releasePointerCapture ??= function releasePointerCapture(): void {
    /* jsdom stub */
  };
  target.hasPointerCapture ??= function hasPointerCapture(): boolean {
    return true;
  };
});

afterEach(() => {
  cleanup();
});

/** A realistic element matching the ZSurveySliderElement contract, on the feature's reference 0..100/5 grid. */
function createSliderElement(overrides: Partial<TSurveySliderElement> = {}): TSurveySliderElement {
  return {
    id: "slider-element",
    type: TSurveyElementTypeEnum.Slider,
    headline: { default: "How satisfied are you?" },
    subheader: { default: "Drag the handle to pick a value" },
    required: true,
    range: { min: 0, max: 100 },
    step: 5,
    lowerLabel: { default: "Not satisfied" },
    upperLabel: { default: "Very satisfied" },
    showValue: true,
    imageUrl: undefined,
    videoUrl: undefined,
    ...overrides,
  };
}

interface HarnessProps {
  element?: TSurveySliderElement;
  initialValue?: number;
  dir?: "ltr" | "rtl" | "auto";
  onResponse?: (responseData: TResponseData) => void;
  onTtc?: (ttc: TResponseTtc) => void;
  errorMessage?: string;
  /**
   * Whether the reported response is fed back in as the rendered value, as the survey runtime does.
   *
   * Set to false only by the parked-value suite, to hold the control in the state a release can duplicate
   * from - see the reasoning there.
   */
  commitResponse?: boolean;
}

/**
 * Controlled harness. The response the wrapper reports is fed straight back in as the rendered value, which
 * is how the survey runtime drives the element. Round-tripping the value is what proves the handle actually
 * tracks the selection rather than merely emitting one: an interaction that reports a value but leaves the
 * handle parked - the production defect this suite guards against - fails these assertions.
 */
function SliderHarness({
  element,
  initialValue,
  dir = "auto",
  onResponse,
  onTtc,
  errorMessage,
  commitResponse = true,
}: HarnessProps) {
  const sliderElement = element ?? createSliderElement();
  const [value, setValue] = useState<number | undefined>(initialValue);
  const [ttc, setTtc] = useState<TResponseTtc>({});

  return (
    <SliderElement
      element={sliderElement}
      value={value}
      onChange={(responseData) => {
        onResponse?.(responseData);
        if (commitResponse) {
          setValue(responseData[sliderElement.id] as number);
        }
      }}
      languageCode="default"
      ttc={ttc}
      setTtc={(next) => {
        setTtc(next);
        onTtc?.(next);
      }}
      currentElementId={sliderElement.id}
      dir={dir}
      errorMessage={errorMessage}
    />
  );
}

/** The control: the handle carries `role="slider"` together with the live value set. */
function getControl(): HTMLElement {
  return screen.getByRole("slider");
}

/** Locates one of the composition's slots. */
function getSlot(container: Element, slot: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  if (!element) throw new Error(`no element with data-slot="${slot}" was rendered`);
  return element;
}

/**
 * The inline position the primitive gives the handle.
 *
 * The primitive wraps its thumb in a positioning span and puts the offset along the track there rather than on
 * the handle itself, so this reads the wrapper. The handle's own `style` carries only what the primitive writes
 * onto it directly - notably the `display: none` of a thumb that could not resolve its value, which is the
 * production symptom asserted separately below.
 */
function getThumbPosition(container: Element): string {
  return getSlot(container, "slider-thumb").parentElement?.getAttribute("style") ?? "";
}

/**
 * Gives the primitive a track it can measure, since jsdom lays nothing out.
 *
 * A hundred pixels wide, so a client position reads as a percentage of the configured range. Without this every
 * press resolves to the lower bound, which is the value an unanswered control is already parked on - useful for
 * the parked-value cases, useless for the ones that need a press to MOVE the value.
 */
function stubTrackGeometry(container: Element, width = 100): HTMLElement {
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
  return root;
}

/**
 * Presses at one position on the measured track and releases there, the way a tap does.
 *
 * The primitive resolves the press to a value and reports it as a live position; the release is what it turns
 * into a commit, which is the point at which one answer is recorded.
 */
function pressTrackAt(container: Element, clientX: number): void {
  const root = stubTrackGeometry(container);
  fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX });
  fireEvent.pointerUp(root, { button: 0, pointerId: 1, clientX });
}

/** Drags across the measured track, reporting every position on the way, and releases at the last one. */
function dragTrackAcross(container: Element, positions: number[]): void {
  const root = stubTrackGeometry(container);
  const [first, ...rest] = positions;
  fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: first });
  for (const clientX of rest) {
    fireEvent.pointerMove(root, { pointerId: 1, clientX });
  }
  fireEvent.pointerUp(root, { button: 0, pointerId: 1, clientX: positions[positions.length - 1] });
}

/**
 * Drives the control with a key, the way a respondent using the keyboard does.
 *
 * The press is what the primitive turns into a new value - its own handler sits on the slider root, and the
 * event bubbles there from the focused handle. The release is what recovers a selection the primitive had
 * nothing to report for, so both halves are dispatched.
 */
function pressKey(key: string): void {
  const control = getControl();
  fireEvent.keyDown(control, { key, bubbles: true });
  fireEvent.keyUp(control, { key, bubbles: true });
}

/** Reads the numeric answer out of the most recent response payload. */
function reportedValue(onResponse: ReturnType<typeof vi.fn>): unknown {
  const { calls } = onResponse.mock;
  return (calls[calls.length - 1]?.[0] as TResponseData | undefined)?.["slider-element"];
}

describe("SliderElement under the production preact alias", () => {
  // -----------------------------------------------------------------------
  // Suite 1: the control resolves under the alias
  //
  // This is the suite that would have caught the production defect, and the one that keeps it from
  // returning. Each assertion here names one of the symptoms the primitive's own thumb exhibited under this
  // alias: absent, hidden, valueless, or unfocusable.
  // -----------------------------------------------------------------------

  describe("control resolution", () => {
    test("renders exactly one control and it is the handle inside the slider root", () => {
      const { container } = render(<SliderHarness />);
      const controls = screen.getAllByRole("slider");
      expect(controls).toHaveLength(1);

      expect(controls[0]).toBe(getSlot(container, "slider-thumb"));
      // One level inside the root rather than a direct child, because the primitive wraps its thumb in the
      // span that positions it along the track.
      expect(getSlot(container, "slider").contains(controls[0])).toBe(true);
      expect(controls[0].parentElement?.parentElement).toBe(getSlot(container, "slider"));
    });

    test("renders the handle visible rather than hidden", () => {
      // The exact production symptom: the primitive's own thumb came out with `display: none` because it
      // could not resolve which value it owned.
      const { container } = render(<SliderHarness initialValue={50} />);
      const thumb = getSlot(container, "slider-thumb");

      expect(thumb.getAttribute("style") ?? "").not.toContain("display: none");
      // And it is positioned from the value rather than left at the start of the track.
      expect(getThumbPosition(container)).toContain("left: calc(50%");
    });

    test("publishes the configured bounds and the current value as live ARIA state", () => {
      // The second production symptom: no `aria-valuenow` at all, so assistive technology announced a
      // slider with no value and the respondent had no way to tell where they were.
      render(<SliderHarness initialValue={50} />);
      const control = getControl();

      expect(control.getAttribute("aria-valuemin")).toBe("0");
      expect(control.getAttribute("aria-valuemax")).toBe("100");
      expect(control.getAttribute("aria-valuenow")).toBe("50");
      expect(control.getAttribute("aria-orientation")).toBe("horizontal");
    });

    test("keeps the handle focusable, and focus actually lands on it", () => {
      render(<SliderHarness />);
      const control = getControl();

      expect(control.getAttribute("tabindex")).toBe("0");

      control.focus();
      expect(document.activeElement).toBe(control);
    });

    test("names the control with the question itself", () => {
      // The handle carries `role="slider"`, and ARIA - not a `<label for>` - is what names an element that is
      // not a form control, so the name is asserted through the accessible-name query.
      render(<SliderHarness />);

      expect(screen.getByRole("slider", { name: "How satisfied are you?" })).toBeTruthy();
    });

    test("gives the slider root an id of its own rather than reusing the element's", () => {
      // The element id belongs to the wrapper. Handing the same id to the control would leave two nodes
      // answering to it, and the header's label points at whichever comes first - the wrapper.
      const { container } = render(<SliderHarness />);

      expect(getSlot(container, "slider").id).toBe("slider-element-input");
      expect(container.querySelectorAll('[id="slider-element"]')).toHaveLength(1);
      expect(container.querySelector('label[for="slider-element-input"]')?.textContent).toContain(
        "How satisfied are you?"
      );
    });

    test("parks an unanswered control at the element's own minimum", () => {
      const element = createSliderElement({ range: { min: 10, max: 50 }, step: 5 });
      render(<SliderHarness element={element} />);
      const control = getControl();

      expect(control.getAttribute("aria-valuenow")).toBe("10");
      expect(control.getAttribute("aria-valuemin")).toBe("10");
    });

    test("falls back to the primitive's own grid when the configuration defines none", () => {
      const onResponse = vi.fn();
      const element = createSliderElement({ step: 0 });
      render(<SliderHarness element={element} onResponse={onResponse} />);

      pressKey("ArrowRight");

      expect(reportedValue(onResponse)).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Suite 2: a value crosses the alias
  //
  // The primitive resolves an interaction and reports it through `onValueChange`, which is a callback rather
  // than a DOM event - so unlike a native control there is no event-name to get wrong under the alias. What
  // still has to hold is that the resolution happens at all, that the recovered parked value is reported,
  // and that the two never fire for the same interaction.
  // -----------------------------------------------------------------------

  describe("reporting a value", () => {
    test("a key press resolved by the primitive reaches the runtime handler", () => {
      const onResponse = vi.fn();
      render(<SliderHarness onResponse={onResponse} />);

      pressKey("ArrowRight");

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse).toHaveBeenCalledWith({ "slider-element": 5 });
    });

    test("writes a bare number keyed by the element id", () => {
      const onResponse = vi.fn();
      render(<SliderHarness onResponse={onResponse} />);

      pressKey("End");

      const responseData = onResponse.mock.calls[0][0] as TResponseData;
      expect(Object.keys(responseData)).toEqual(["slider-element"]);
      expect(typeof responseData["slider-element"]).toBe("number");
      expect(responseData["slider-element"]).toBe(100);
    });

    test("reports the minimum a pristine control is already parked on", () => {
      // The interaction the primitive cannot report: asking for the value already held leaves its value array
      // unchanged, and its controlled-state helper compares by identity. Without the recovery below, a
      // required 0..100 slider could not be answered with 0 at all.
      const onResponse = vi.fn();
      render(<SliderHarness onResponse={onResponse} />);

      pressKey("Home");

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(reportedValue(onResponse)).toBe(0);
      expect(typeof reportedValue(onResponse)).toBe("number");
    });

    test("reports the minimum a press lands on, and focuses the handle for what follows", () => {
      // jsdom measures every rectangle as zero-width, so the primitive resolves this press to the minimum -
      // which is the value the control is already parked on, and therefore exactly the case the recovery
      // exists for. What the press must also do is move focus, since the primitive routes focus through a
      // collection this control deliberately does not join.
      const onResponse = vi.fn();
      render(<SliderHarness onResponse={onResponse} />);
      const control = getControl();

      fireEvent.pointerDown(control, { button: 0, pointerId: 1, bubbles: true });
      fireEvent.pointerUp(control, { button: 0, pointerId: 1, bubbles: true });

      expect(document.activeElement).toBe(control);
      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(reportedValue(onResponse)).toBe(0);
    });

    test("reports a value the primitive resolved exactly once", () => {
      // The other half of the recovery: an interaction the primitive DID report must not be reported a second
      // time on release. The suppression is an interaction flag rather than a re-read of the value prop, so it
      // holds regardless of when the surrounding runtime re-renders.
      const onResponse = vi.fn();
      render(<SliderHarness onResponse={onResponse} />);

      pressKey("PageUp");

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(reportedValue(onResponse)).toBe(50);
    });

    test("keeps reporting across successive interactions", () => {
      const onResponse = vi.fn();
      render(<SliderHarness onResponse={onResponse} />);

      pressKey("PageUp");
      pressKey("ArrowRight");
      pressKey("Home");

      const reported = onResponse.mock.calls.map((call) => (call[0] as TResponseData)["slider-element"]);
      expect(reported).toEqual([50, 55, 0]);
    });

    test("reports on the element's own grid when the range does not start at zero", () => {
      const onResponse = vi.fn();
      const element = createSliderElement({ range: { min: 10, max: 50 }, step: 5 });
      render(<SliderHarness element={element} onResponse={onResponse} />);

      pressKey("ArrowRight");

      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 15 });
    });

    test("keeps a slider that was never touched free of any response value", () => {
      const onResponse = vi.fn();
      render(<SliderHarness onResponse={onResponse} />);

      expect(onResponse).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Suite 3: the controlled round trip
  //
  // The runtime stores what the control reports and renders it straight back. Asserting the presentation
  // after the round trip is what proves the answer is actually held: a control that reports values while
  // its handle stays parked - the shape of the production defect - fails here.
  // -----------------------------------------------------------------------

  describe("controlled round trip", () => {
    test("moves the value, the handle and the fill together", () => {
      const { container } = render(<SliderHarness />);

      pressKey("PageUp");

      expect(getControl().getAttribute("aria-valuenow")).toBe("50");
      expect(getThumbPosition(container)).toContain("50%");
      // The fill's insets are the primitive's own, which is what inverts it in a right-to-left survey.
      expect(getSlot(container, "slider-range").style.right).toBe("50%");
    });

    test("positions the handle from the element's own range rather than from zero", () => {
      const element = createSliderElement({ range: { min: 10, max: 50 }, step: 5 });
      const { container } = render(<SliderHarness element={element} />);

      pressKey("PageUp");

      // 10 + 10 * 5 clamps to 50, the end of the range, so the handle sits at the end of the track.
      expect(getControl().getAttribute("aria-valuenow")).toBe("50");
      expect(getThumbPosition(container)).toContain("100%");
    });

    test("withholds the readout until a value exists, then tracks it", () => {
      const { container } = render(<SliderHarness />);
      expect(container.querySelector("output")).toBeNull();

      pressKey("ArrowRight");
      expect(container.querySelector("output")?.textContent).toBe("5");

      pressKey("ArrowRight");
      expect(container.querySelector("output")?.textContent).toBe("10");
    });

    test("honours an element that suppresses the readout", () => {
      const element = createSliderElement({ showValue: false });
      const { container } = render(<SliderHarness element={element} />);

      pressKey("ArrowRight");

      expect(container.querySelector("output")).toBeNull();
      expect(getControl().getAttribute("aria-valuenow")).toBe("5");
    });

    test("fills the handle only once an answer exists", () => {
      // The one state a parked handle cannot express on its own: parked at the minimum with nothing selected
      // looks identical to answered with the minimum, so the fill is what tells them apart.
      const { container } = render(<SliderHarness />);
      expect(getSlot(container, "slider-thumb").className).toContain("bg-input-bg");

      pressKey("Home");

      expect(getSlot(container, "slider-thumb").className).toContain("bg-brand");
    });
  });

  // -----------------------------------------------------------------------
  // Suite 4: direction and localisation
  // -----------------------------------------------------------------------

  describe("direction and localisation", () => {
    test("hands a right-to-left direction to the primitive as well as the wrapper", () => {
      // The primitive inverts the track, the fill and the key mapping from this direction, so it has to reach
      // the slider root and not only the surrounding markup.
      const { container } = render(<SliderHarness dir="rtl" initialValue={25} />);

      expect(getSlot(container, "slider").getAttribute("dir")).toBe("rtl");
      expect(container.querySelector("#slider-element")?.getAttribute("dir")).toBe("rtl");
      expect(getSlot(container, "slider-range").style.right).toBe("0%");
      expect(getSlot(container, "slider-range").style.left).toBe("75%");
    });

    test("lets the primitive resolve direction when none is fixed", () => {
      const { container } = render(<SliderHarness dir="auto" />);

      expect(getSlot(container, "slider").getAttribute("dir")).toBe("ltr");
    });

    test("renders the localized headline, description and endpoint labels", () => {
      render(<SliderHarness />);

      expect(screen.getByText("How satisfied are you?")).toBeTruthy();
      expect(screen.getByText("Drag the handle to pick a value")).toBeTruthy();
      expect(screen.getByText("Not satisfied")).toBeTruthy();
      expect(screen.getByText("Very satisfied")).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Suite 5: required state and validation
  // -----------------------------------------------------------------------

  describe("required state and validation", () => {
    test("describes required-ness to the control, since the slider role has no required state", () => {
      const { container } = render(<SliderHarness />);
      const describedBy = getControl().getAttribute("aria-describedby") ?? "";

      expect(describedBy).toContain("slider-element-input-required");
      expect(container.querySelector("#slider-element-input-required")?.textContent).toBe("common.required");
    });

    test("leaves an optional slider undescribed", () => {
      const element = createSliderElement({ required: false });
      const { container } = render(<SliderHarness element={element} />);

      expect(getControl().getAttribute("aria-describedby")).toBeNull();
      expect(container.querySelector("#slider-element-input-required")).toBeNull();
    });

    test("surfaces a validation message and points the control at it", () => {
      const { container } = render(<SliderHarness errorMessage="Please pick a value" />);

      expect(screen.getByText("Please pick a value")).toBeTruthy();
      expect(getControl().getAttribute("aria-invalid")).toBe("true");
      expect(getControl().getAttribute("aria-describedby") ?? "").toContain("slider-element-input-error");
      expect(container.querySelector("#slider-element-input-error")?.textContent).toContain(
        "Please pick a value"
      );
    });

    test("stays answerable while the required error is showing", () => {
      // A required slider that was submitted empty renders its error with the handle still parked at the
      // minimum, so the recovery has to keep working in exactly that state or the respondent cannot clear
      // the error by choosing the minimum.
      const onResponse = vi.fn();
      render(<SliderHarness errorMessage="Please pick a value" onResponse={onResponse} />);

      pressKey("Home");

      expect(reportedValue(onResponse)).toBe(0);
    });

    test("renders no error affordance while the answer is acceptable", () => {
      const { container } = render(<SliderHarness />);

      expect(getControl().getAttribute("aria-invalid")).toBeNull();
      expect(container.querySelector("#slider-element-input-error")).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Suite 6: time to completion
  //
  // The arithmetic is covered against the mocked control in `slider-element.test.tsx`. What only the real
  // control can show is that a value crossing the alias is what triggers the billing at all.
  // -----------------------------------------------------------------------

  describe("time to completion", () => {
    test("bills the element as soon as the real control reports a value", () => {
      const onTtc = vi.fn();
      render(<SliderHarness onTtc={onTtc} />);
      expect(onTtc).not.toHaveBeenCalled();

      pressKey("ArrowRight");

      expect(onTtc).toHaveBeenCalledTimes(1);
      expect(typeof onTtc.mock.calls[0][0]["slider-element"]).toBe("number");
    });

    test("bills a continuous interaction once per reported value and keeps the total finite", () => {
      const onTtc = vi.fn();
      render(<SliderHarness onTtc={onTtc} />);

      pressKey("ArrowRight");
      pressKey("ArrowRight");
      pressKey("ArrowRight");

      expect(onTtc).toHaveBeenCalledTimes(3);
      const total = onTtc.mock.calls[2][0]["slider-element"] as number;
      expect(Number.isFinite(total)).toBe(true);
      expect(total).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // Suite 7: selecting the value the thumb is parked at, under the alias
  //
  // An unanswered control is parked at `min`, so an interaction asking for the minimum resolves to the value
  // already there and HTML - which reports only an actual change - sends nothing. The control recovers that
  // selection when the interaction finishes, from its own `keyup` and `pointerup` handlers.
  //
  // Those handlers are the one part of the control that is pure component logic rather than platform
  // behaviour, and they are the reason this suite exists here as well as in `@formbricks/survey-ui`. The
  // control's own tests run against real React, and a controlled range input does NOT behave the same way
  // under the two runtimes while the parent's commit is still pending: React writes the rendered value back
  // onto the input as soon as its handler returns, so the input is holding `min` again by the time the release
  // arrives, whereas Preact leaves the value the interaction resolved in place. A release that reported
  // whatever it found would therefore be wrong in opposite ways in the two runtimes - the parked minimum over
  // a real answer under React, the same answer a second time under Preact - and only the second of those is
  // what ships. Every assertion below is made through the production alias for that reason.
  //
  // What is asserted is one response and one segment of time to completion per interaction. The second half
  // matters as much as the first: `getUpdatedTtc` ADDS the duration it is handed, so a duplicated report
  // charges one interaction twice.
  // -----------------------------------------------------------------------

  describe("committing the parked value under the alias", () => {
    /** Dispatches a press and its release, the way a key interaction arrives. */
    const pressKey = (key: string): void => {
      const control = getControl();
      fireEvent.keyDown(control, { key });
      fireEvent.keyUp(control, { key });
    };

    /** Dispatches a pointer press and its release, the way a press on the track arrives. */
    const pressPointer = (button = 0): void => {
      const control = getControl();
      fireEvent.pointerDown(control, { button });
      fireEvent.pointerUp(control, { button });
    };

    test.each(["Home", "ArrowLeft", "ArrowDown", "PageDown"])(
      "reports the parked minimum once, and bills once, when a %s release finishes a pristine interaction",
      (key) => {
        const onResponse = vi.fn();
        const onTtc = vi.fn();
        const { container } = render(<SliderHarness onResponse={onResponse} onTtc={onTtc} />);

        pressKey(key);

        expect(onResponse).toHaveBeenCalledTimes(1);
        expect(onResponse).toHaveBeenCalledWith({ "slider-element": 0 });
        expect(typeof (onResponse.mock.calls[0][0] as TResponseData)["slider-element"]).toBe("number");
        expect(onTtc).toHaveBeenCalledTimes(1);
        // The round trip: the answer is held, so the thumb is filled rather than merely parked.
        expect(getSlot(container, "slider-thumb").className).toContain("bg-brand");
      }
    );

    test("reports a parked minimum that is not zero", () => {
      const onResponse = vi.fn();
      const onTtc = vi.fn();
      const element = createSliderElement({ range: { min: 10, max: 50 }, step: 5 });
      render(<SliderHarness element={element} onResponse={onResponse} onTtc={onTtc} />);

      pressKey("Home");

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse).toHaveBeenCalledWith({ "slider-element": 10 });
      expect(onTtc).toHaveBeenCalledTimes(1);
    });

    test("reports the parked minimum once, and bills once, for a press that lands on the control", () => {
      const onResponse = vi.fn();
      const onTtc = vi.fn();
      render(<SliderHarness onResponse={onResponse} onTtc={onTtc} />);

      pressPointer();

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse).toHaveBeenCalledWith({ "slider-element": 0 });
      expect(onTtc).toHaveBeenCalledTimes(1);
    });

    test("reports the parked minimum while a required error is showing", () => {
      // The respondent's only way out of a rejected required slider is to select the minimum already in front
      // of them, so this is the interaction that has to work for the error to be resolvable at all.
      const onResponse = vi.fn();
      render(<SliderHarness errorMessage="Please pick a value" onResponse={onResponse} />);

      pressKey("Home");

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse).toHaveBeenCalledWith({ "slider-element": 0 });
    });

    test("reports once when a key press moved the value and then released, in one sequence", () => {
      // The duplicate the recovery makes possible. The primitive commits a keyboard change on the press
      // itself, so the release that follows arrives at a control that already holds 5 - and a release that
      // reported what it found would bill 5 twice. The two events are dispatched with no re-render between
      // them, which is what makes this the real sequence rather than an already-answered control.
      const onResponse = vi.fn();
      const onTtc = vi.fn();
      render(<SliderHarness onResponse={onResponse} onTtc={onTtc} />);
      const control = getControl();

      fireEvent.keyDown(control, { key: "ArrowRight" });
      fireEvent.keyUp(control, { key: "ArrowRight" });

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse).toHaveBeenCalledWith({ "slider-element": 5 });
      expect(onTtc).toHaveBeenCalledTimes(1);
    });

    test("reports once when a press moved the value and then released, in one sequence", () => {
      // A press away from the parked minimum: the primitive reports the position as the press lands and
      // commits it on the release, so exactly one answer is recorded for the one interaction.
      const onResponse = vi.fn();
      const onTtc = vi.fn();
      const { container } = render(<SliderHarness onResponse={onResponse} onTtc={onTtc} />);

      pressTrackAt(container, 60);

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse).toHaveBeenCalledWith({ "slider-element": 60 });
      expect(onTtc).toHaveBeenCalledTimes(1);
    });

    /**
     * The same two sequences with the answer deliberately NOT fed back.
     *
     * The two tests above are satisfied by the incoming value alone: the renderer applies the harness's state
     * update between the events, so by the time the release is dispatched the control has been re-rendered
     * holding an answer. A browser produces that same ordering, so those tests are the realistic case and are
     * worth having as they are.
     *
     * They cannot, however, show what a release does when it reaches the control before the answer it reported
     * has come back - a slower renderer, a batched update, a survey that rejects the value. Withholding the
     * commit holds the control in exactly that state, and it is the state in which a recovery keyed on the
     * incoming prop would fire a second time: the control still looks unanswered from the outside. What it must
     * key on instead is what it has itself already reported. Nothing about the assertion changes - one response,
     * one segment - only what has to be true for it to hold.
     */
    test("reports once even if the answer has not come back to the control yet", () => {
      const onResponse = vi.fn();
      const onTtc = vi.fn();
      render(<SliderHarness commitResponse={false} onResponse={onResponse} onTtc={onTtc} />);
      const control = getControl();

      fireEvent.keyDown(control, { key: "ArrowRight" });
      fireEvent.keyUp(control, { key: "ArrowRight" });

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse).toHaveBeenCalledWith({ "slider-element": 5 });
      expect(onTtc).toHaveBeenCalledTimes(1);
      // The handle stays where the respondent put it even though the value never came back, so the control
      // never appears to snap back to the minimum under them.
      expect(control.getAttribute("aria-valuenow")).toBe("5");
    });

    test("reports once for an uncommitted press interaction as well", () => {
      const onResponse = vi.fn();
      const onTtc = vi.fn();
      const { container } = render(
        <SliderHarness commitResponse={false} onResponse={onResponse} onTtc={onTtc} />
      );

      pressTrackAt(container, 60);

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse).toHaveBeenCalledWith({ "slider-element": 60 });
      expect(onTtc).toHaveBeenCalledTimes(1);
    });

    test("reports once for an interaction that reached the maximum, in one sequence", () => {
      // The end of the range the control was never parked on: the platform reports it, so the release adds
      // nothing. The maximum never had the parked-value problem, which is the whole shape of the defect.
      const onResponse = vi.fn();
      const onTtc = vi.fn();
      render(<SliderHarness onResponse={onResponse} onTtc={onTtc} />);
      const control = getControl();

      fireEvent.keyDown(control, { key: "End" });
      fireEvent.keyUp(control, { key: "End" });

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse).toHaveBeenCalledWith({ "slider-element": 100 });
      expect(onTtc).toHaveBeenCalledTimes(1);
    });

    test("bills a whole drag once, at the value it settled on", () => {
      // A drag is one press, many positions and one release, and it is one answer. The positions move the
      // handle and the readout as they arrive - which is what keeps the drag responsive - but only the release
      // records a response, so a drag across the whole track charges one interval of time rather than one per
      // position it passed through.
      const onResponse = vi.fn();
      const onTtc = vi.fn();
      const { container } = render(<SliderHarness onResponse={onResponse} onTtc={onTtc} />);

      dragTrackAcross(container, [25, 50, 75]);

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse).toHaveBeenCalledWith({ "slider-element": 75 });
      expect(onTtc).toHaveBeenCalledTimes(1);
      expect(getControl().getAttribute("aria-valuenow")).toBe("75");
    });

    test("follows a drag on screen while it is still in progress", () => {
      // The other half of the same separation: the positions a drag passes through are shown as they arrive,
      // even though none of them is an answer yet.
      const onResponse = vi.fn();
      const { container } = render(<SliderHarness onResponse={onResponse} />);
      const root = stubTrackGeometry(container);

      fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: 25 });
      fireEvent.pointerMove(root, { pointerId: 1, clientX: 60 });

      expect(getControl().getAttribute("aria-valuenow")).toBe("60");
      expect(container.querySelector("output")?.textContent).toBe("60");
      expect(onResponse).not.toHaveBeenCalled();

      fireEvent.pointerUp(root, { button: 0, pointerId: 1, clientX: 60 });

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse).toHaveBeenCalledWith({ "slider-element": 60 });
    });

    test.each(["Enter", " ", "Tab", "Escape"])(
      "reports nothing for a %s release, which the control does not act on",
      (key) => {
        // `Enter` submits the surrounding form. Treating it as a selection would answer an untouched required
        // slider with its minimum and defeat the required check the response contract depends on.
        const onResponse = vi.fn();
        const onTtc = vi.fn();
        render(<SliderHarness onResponse={onResponse} onTtc={onTtc} />);

        pressKey(key);

        expect(onResponse).not.toHaveBeenCalled();
        expect(onTtc).not.toHaveBeenCalled();
      }
    );

    test("reports nothing for a release whose press began somewhere else", () => {
      const onResponse = vi.fn();
      render(<SliderHarness onResponse={onResponse} />);

      fireEvent.pointerUp(getControl(), { button: 0 });

      expect(onResponse).not.toHaveBeenCalled();
    });

    test("reports nothing for a press with a button the control ignores", () => {
      const onResponse = vi.fn();
      render(<SliderHarness onResponse={onResponse} />);

      pressPointer(2);

      expect(onResponse).not.toHaveBeenCalled();
    });

    test("reports nothing for an interaction that resolves to the answer already held", () => {
      // The hardest case for the recovery, and the reason it is keyed on whether an answer exists rather than
      // on which value it is: this slider is answered WITH its minimum, so every signal the recovery looks at
      // is the same as a pristine control's. `Home` and a press both resolve to the value already held, the
      // primitive reports neither, and neither is a new answer - reporting one would charge a further interval
      // of time to an answer already given.
      const onResponse = vi.fn();
      const onTtc = vi.fn();
      render(<SliderHarness initialValue={0} onResponse={onResponse} onTtc={onTtc} />);

      pressKey("Home");
      pressPointer();

      expect(onResponse).not.toHaveBeenCalled();
      expect(onTtc).not.toHaveBeenCalled();
    });

    test("reports nothing for a press that lands on the answer already held", () => {
      // The same invariant away from the minimum, where the press has to be measured to land on the answer.
      const onResponse = vi.fn();
      const onTtc = vi.fn();
      const { container } = render(<SliderHarness initialValue={50} onResponse={onResponse} onTtc={onTtc} />);

      pressTrackAt(container, 50);

      expect(onResponse).not.toHaveBeenCalled();
      expect(onTtc).not.toHaveBeenCalled();
    });

    test("still reports a key press that moves an answered slider", () => {
      // The other side of the invariant, so it cannot be satisfied by refusing every interaction on an
      // answered control: a respondent changing their mind with the keyboard is a new answer.
      const onResponse = vi.fn();
      const onTtc = vi.fn();
      render(<SliderHarness initialValue={50} onResponse={onResponse} onTtc={onTtc} />);

      pressKey("ArrowLeft");

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse).toHaveBeenCalledWith({ "slider-element": 45 });
      expect(onTtc).toHaveBeenCalledTimes(1);
    });

    test("reports nothing further once the parked minimum has been committed", () => {
      // The recovery is one report per answer: having committed 0, the identical interaction repeated on the
      // now-answered control adds neither a response nor a segment.
      const onResponse = vi.fn();
      const onTtc = vi.fn();
      render(<SliderHarness onResponse={onResponse} onTtc={onTtc} />);

      pressKey("Home");
      pressKey("Home");
      pressPointer();

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onTtc).toHaveBeenCalledTimes(1);
    });
  });
});
