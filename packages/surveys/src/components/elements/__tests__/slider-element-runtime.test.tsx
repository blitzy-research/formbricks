// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { TResponseData, TResponseTtc } from "@formbricks/types/responses";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import type { TSurveySliderElement } from "@formbricks/types/surveys/elements";
import { SliderElement } from "../slider-element";

// ---------------------------------------------------------------------------
// Production-parity regression coverage for the slider control.
//
// Unlike every sibling runtime suite, this file deliberately does NOT mock `@formbricks/survey-ui`. It
// renders the real presentational control through the runtime wrapper, which means the control is loaded
// under this package's build aliases - `react` and `react-dom` resolve to `preact/compat` and
// `react/jsx-runtime` to `preact/jsx-runtime` (packages/surveys/vite.config.mts) - exactly the way the
// shipped ESM and UMD bundles resolve it.
//
// That distinction is the whole point of the suite. The control's own tests in `@formbricks/survey-ui`
// run against real React, so any behaviour that depends on React-specific hook or effect scheduling
// passes there while failing in the browser. A previous implementation built on a third-party slider
// primitive did exactly that: the primitive resolved which thumb owns the value from a memo whose
// dependencies were populated by a passive effect, an ordering React guarantees and Preact does not.
// Under the production alias the thumb never resolved, so it rendered hidden, exposed no `aria-valuenow`,
// and every key press addressed a thumb index that did not exist - a required 0..100 slider stepped once
// with the keyboard submitted `0` instead of `5`. The control is now a native `<input type="range">`
// precisely so that no third-party scheduling assumption sits between the respondent and their answer.
//
// Two things follow for what this suite asserts. First, the ARIA value set is now implicit - the browser
// derives it from `min`, `max` and `value`, so those are what is pinned here rather than hand-written
// `aria-*` attributes, and the resolved accessibility tree is verified in a real browser. Second, the one
// alias-specific hazard that remains is event naming: a dragged range input reports through `input`, and
// `preact/compat` maps an `onChange` prop onto that event. The change-reporting assertions below dispatch
// `input` for exactly that reason - under the production alias they are what proves a drag is heard at all.
//
// Every mocked-boundary concern (prop forwarding, time-to-completion arithmetic, localisation) is covered
// by `slider-element.test.tsx`; this suite covers only what a mock cannot see. Drag geometry, key
// semantics and grid snapping belong to the platform and are verified in a real browser, since jsdom
// renders no layout and implements neither.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stub the icon library.
//
// This is the one concession the suite makes to the test runner, and it is a runner artifact rather than a
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
}

/**
 * Controlled harness. The response the wrapper reports is fed straight back in as the rendered value, which
 * is how the survey runtime drives the element. Round-tripping the value is what proves the thumb actually
 * tracks the selection rather than merely emitting one: an interaction that reports a value but leaves the
 * thumb parked - the production defect this suite guards against - fails these assertions.
 */
function SliderHarness({
  element,
  initialValue,
  dir = "auto",
  onResponse,
  onTtc,
  errorMessage,
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
        setValue(responseData[sliderElement.id] as number);
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

/** Returns the platform control - `input[type="range"]` carries the implicit `slider` role. */
function getControl(): HTMLInputElement {
  return screen.getByRole("slider") as HTMLInputElement;
}

/** Locates one of the presentation slots the control draws from the current value. */
function getSlot(container: Element, slot: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  if (!element) throw new Error(`no element with data-slot="${slot}" was rendered`);
  return element;
}

/**
 * Reports a value the way a dragged range input does: through an `input` event. Dispatching `input` rather
 * than `change` is deliberate - it is the event a real drag emits, and `preact/compat` maps the component's
 * `onChange` prop onto it, so this is the alias behaviour worth pinning.
 */
function reportValue(value: number): void {
  fireEvent.input(getControl(), { target: { value: String(value) } });
}

describe("SliderElement under the production preact alias", () => {
  // -----------------------------------------------------------------------
  // Suite 1: the control resolves under the alias
  //
  // This is the suite that would have caught the production defect. The third-party primitive rendered a
  // thumb whose value never resolved under Preact, so it came out hidden, valueless and inert. A platform
  // control cannot fail that way, and these assertions are what pin that it is genuinely the platform
  // control that reaches the respondent through the alias.
  // -----------------------------------------------------------------------

  describe("control resolution", () => {
    test("renders exactly one control and it is the platform range input", () => {
      render(<SliderHarness />);
      const controls = screen.getAllByRole("slider");
      expect(controls).toHaveLength(1);

      const control = controls[0] as HTMLInputElement;
      expect(control.tagName).toBe("INPUT");
      expect(control.type).toBe("range");
    });

    test("gives the control an id of its own rather than reusing the element's", () => {
      // The element id belongs to the wrapper. Handing the same id to the control would leave two nodes
      // answering to it, and a label points at whichever comes first - the wrapper - so the control would
      // end up with no accessible name at all.
      const { container } = render(<SliderHarness />);
      expect(getControl().id).toBe("slider-element-input");
      expect(container.querySelectorAll('[id="slider-element"]')).toHaveLength(1);
    });

    test("is named by the question itself, through a label that actually binds to it", () => {
      render(<SliderHarness />);
      const labels = Array.from(getControl().labels ?? []);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.map((label) => label.textContent).join(" ")).toContain("How satisfied are you?");
    });

    test("hands the configured range and grid to the platform as live state", () => {
      // Properties rather than attributes: these are what the browser's own snapping, clamping and keyboard
      // stepping read, so reading them back is what proves the configuration reached the platform intact.
      render(<SliderHarness />);
      const control = getControl();
      expect(control.min).toBe("0");
      expect(control.max).toBe("100");
      expect(control.step).toBe("5");
    });

    test("renders the control enabled, focusable and visible rather than hidden", () => {
      render(<SliderHarness />);
      const control = getControl();
      expect(control.disabled).toBe(false);
      expect(control.getAttribute("style") ?? "").not.toContain("display: none");

      control.focus();
      expect(document.activeElement).toBe(control);
    });

    test("carries its value as platform state instead of authored aria attributes", () => {
      // The browser derives `aria-valuenow`, `aria-valuemin` and `aria-valuemax` from the input's own state,
      // so their absence as authored attributes is correct - and it is exactly the reliance on hand-written
      // ARIA that the previous implementation had to get right and did not.
      render(<SliderHarness initialValue={50} />);
      const control = getControl();
      expect(control.valueAsNumber).toBe(50);
      expect(control.getAttribute("aria-valuenow")).toBeNull();
      expect(control.getAttribute("aria-valuetext")).toBeNull();
    });

    test("parks an unanswered control at the element's own minimum", () => {
      const element = createSliderElement({ range: { min: 10, max: 50 }, step: 5 });
      render(<SliderHarness element={element} />);
      const control = getControl();
      expect(control.valueAsNumber).toBe(10);
      expect(control.min).toBe("10");
    });

    test("omits a grid the configuration does not define rather than asserting a false one", () => {
      const element = createSliderElement({ step: 0 });
      render(<SliderHarness element={element} />);
      expect(getControl().getAttribute("step")).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Suite 2: a reported value crosses the alias
  //
  // The remaining alias-specific hazard. A dragged range input reports through `input`, and `preact/compat`
  // rewrites an `onChange` prop into an `oninput` listener for this input type - a range does not sit on its
  // change-event exception list. These tests dispatch `input` because that is the event a drag emits, so
  // they fail if the handler is ever wired to something the platform does not send.
  // -----------------------------------------------------------------------

  describe("reporting a value", () => {
    test("a native input event reaches the runtime handler", () => {
      const onResponse = vi.fn();
      render(<SliderHarness onResponse={onResponse} />);

      reportValue(45);

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse).toHaveBeenCalledWith({ "slider-element": 45 });
    });

    test("writes a bare number keyed by the element id", () => {
      const onResponse = vi.fn();
      render(<SliderHarness onResponse={onResponse} />);

      reportValue(100);

      const responseData = onResponse.mock.calls[0][0] as TResponseData;
      expect(Object.keys(responseData)).toEqual(["slider-element"]);
      expect(typeof responseData["slider-element"]).toBe("number");
      expect(responseData["slider-element"]).toBe(100);
    });

    test("reports a selection of the minimum as the number it is", () => {
      // Not as `undefined` and not as an empty string: the required check and the summary's dismissed count
      // both distinguish an answer of `0` from no answer, so this has to survive the whole round trip.
      const onResponse = vi.fn();
      render(<SliderHarness initialValue={50} onResponse={onResponse} />);

      reportValue(0);

      const responseData = onResponse.mock.calls[0][0] as TResponseData;
      expect(responseData["slider-element"]).toBe(0);
      expect(typeof responseData["slider-element"]).toBe("number");
    });

    test("reports the value the platform resolved, not the raw one it was handed", () => {
      // The platform clamps to its own bounds before the event is delivered, and the handler reads
      // `valueAsNumber` off the control, so an over-range figure arrives already bounded.
      const onResponse = vi.fn();
      render(<SliderHarness onResponse={onResponse} />);

      reportValue(150);

      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 100 });
    });

    test("reports on the element's own grid when the range does not start at zero", () => {
      const onResponse = vi.fn();
      const element = createSliderElement({ range: { min: 10, max: 50 }, step: 5 });
      render(<SliderHarness element={element} onResponse={onResponse} />);

      reportValue(15);

      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 15 });
    });

    test("reports every value a continuous interaction passes through", () => {
      const onResponse = vi.fn();
      render(<SliderHarness onResponse={onResponse} />);

      reportValue(25);
      reportValue(50);
      reportValue(75);

      const reported = onResponse.mock.calls.map((call) => (call[0] as TResponseData)["slider-element"]);
      expect(reported).toEqual([25, 50, 75]);
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
  // its thumb stays parked - the shape of the production defect - fails here.
  // -----------------------------------------------------------------------

  describe("controlled round trip", () => {
    test("moves the platform value, the thumb and the fill together", () => {
      const { container } = render(<SliderHarness />);

      reportValue(50);

      expect(getControl().valueAsNumber).toBe(50);
      expect(getSlot(container, "slider-thumb").getAttribute("style") ?? "").toContain("50%");
      expect(getSlot(container, "slider-range").getAttribute("style") ?? "").toContain(
        "inset-inline-end: 50%"
      );
    });

    test("positions the thumb from the element's own range rather than from zero", () => {
      const element = createSliderElement({ range: { min: 10, max: 50 }, step: 5 });
      const { container } = render(<SliderHarness element={element} />);

      reportValue(20);

      // A quarter of the way along 10..50, so a quarter of the track less a quarter of the thumb.
      expect(getSlot(container, "slider-thumb").getAttribute("style") ?? "").toContain("25%");
    });

    test("withholds the readout until a value exists, then tracks it", () => {
      const { container } = render(<SliderHarness />);
      expect(container.querySelector("output")).toBeNull();

      reportValue(35);
      expect(container.querySelector("output")?.textContent).toBe("35");

      reportValue(40);
      expect(container.querySelector("output")?.textContent).toBe("40");
    });

    test("honours an element that suppresses the readout", () => {
      const element = createSliderElement({ showValue: false });
      const { container } = render(<SliderHarness element={element} />);

      reportValue(35);

      expect(container.querySelector("output")).toBeNull();
      expect(getControl().valueAsNumber).toBe(35);
    });

    test("keeps the handle a sibling of the control so its focus affordance can reach it", () => {
      // The focus and hover rings are `peer-*` variants, which resolve against siblings of the control.
      // Nesting the handle any deeper compiles them into selectors that match nothing, and a keyboard
      // respondent is left with no visible focus indicator on an otherwise transparent control.
      const { container } = render(<SliderHarness />);
      expect(getSlot(container, "slider-thumb").parentElement).toBe(getControl().parentElement);
    });

    test("fills the thumb only once an answer exists", () => {
      // The one state a range input cannot express on its own: parked at the minimum with nothing selected
      // looks identical to answered with the minimum, so the fill is what tells them apart.
      const { container } = render(<SliderHarness />);
      expect(getSlot(container, "slider-thumb").className).toContain("bg-input-bg");

      reportValue(0);

      expect(getSlot(container, "slider-thumb").className).toContain("bg-brand");
    });
  });

  // -----------------------------------------------------------------------
  // Suite 4: direction and localisation
  // -----------------------------------------------------------------------

  describe("direction and localisation", () => {
    test("hands a right-to-left direction to the platform control as well as the wrapper", () => {
      // The platform inverts the track, the fill and the keyboard from this attribute, so it has to land on
      // the input itself and not only on the surrounding markup. The inversion itself is a browser
      // behaviour and is verified there.
      const { container } = render(<SliderHarness dir="rtl" initialValue={50} />);
      expect(getControl().getAttribute("dir")).toBe("rtl");
      expect(container.querySelector("#slider-element")?.getAttribute("dir")).toBe("rtl");
    });

    test("leaves the control to inherit direction when none is fixed", () => {
      render(<SliderHarness dir="auto" />);
      expect(getControl().getAttribute("dir")).toBeNull();
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

      reportValue(50);

      expect(onTtc).toHaveBeenCalledTimes(1);
      expect(typeof onTtc.mock.calls[0][0]["slider-element"]).toBe("number");
    });

    test("bills a continuous interaction once per reported value and keeps the total finite", () => {
      const onTtc = vi.fn();
      render(<SliderHarness onTtc={onTtc} />);

      reportValue(25);
      reportValue(50);
      reportValue(75);

      expect(onTtc).toHaveBeenCalledTimes(3);
      const total = onTtc.mock.calls[2][0]["slider-element"] as number;
      expect(Number.isFinite(total)).toBe(true);
      expect(total).toBeGreaterThanOrEqual(0);
    });
  });
});
