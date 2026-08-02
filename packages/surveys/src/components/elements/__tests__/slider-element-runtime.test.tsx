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
// with the keyboard submitted `0` instead of `5`.
//
// The assertions below therefore pin the value, keyboard, pointer, ARIA and submission behaviour at the
// alias boundary. Every mocked-boundary concern (prop forwarding, time-to-completion arithmetic,
// localisation) is covered by `slider-element.test.tsx`; this suite covers only what a mock cannot see.
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

/** Returns the thumb - the node that owns the value, the keyboard and the ARIA state. */
function getThumb(): HTMLElement {
  return screen.getByRole("slider");
}

/** Pins the root's geometry so a pointer position maps to a predictable value. 200px wide, origin at 0. */
function stubRootGeometry(container: Element, width = 200, left = 0): HTMLElement {
  const root = container.querySelector<HTMLElement>('[data-slot="slider"]');
  if (!root) throw new Error("slider root not found");
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
    width,
    height: 20,
    left,
    top: 0,
    right: left + width,
    bottom: 20,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return root;
}

describe("SliderElement under the production preact alias", () => {
  // -----------------------------------------------------------------------
  // Suite 1: the thumb resolves its value
  // -----------------------------------------------------------------------

  describe("thumb value resolution", () => {
    test("renders exactly one thumb, focusable and carrying the full aria value set", () => {
      render(<SliderHarness />);
      const thumbs = screen.getAllByRole("slider");
      expect(thumbs).toHaveLength(1);

      const thumb = thumbs[0];
      expect(thumb.getAttribute("aria-valuemin")).toBe("0");
      expect(thumb.getAttribute("aria-valuemax")).toBe("100");
      expect(thumb.getAttribute("aria-valuenow")).toBe("0");
      expect(thumb.getAttribute("tabindex")).toBe("0");
      expect(thumb.getAttribute("id")).toBe("slider-element");
    });

    test("renders the thumb visibly and positioned rather than hidden", () => {
      render(<SliderHarness />);
      const style = getThumb().getAttribute("style") ?? "";
      expect(style).not.toContain("display: none");
      expect(style).toContain("inset-inline-start");
    });

    test("reports the current value through aria-valuenow", () => {
      render(<SliderHarness initialValue={50} />);
      expect(getThumb().getAttribute("aria-valuenow")).toBe("50");
    });

    test("positions the thumb and the filled range from the current value", () => {
      const { container } = render(<SliderHarness initialValue={50} />);
      expect(getThumb().getAttribute("style") ?? "").toContain("50%");
      const range = container.querySelector('[data-slot="slider-range"]');
      expect(range?.getAttribute("style") ?? "").toContain("inset-inline-end: 50%");
    });

    test("announces an unanswered slider through aria-valuetext", () => {
      render(<SliderHarness />);
      expect(getThumb().getAttribute("aria-valuetext")).toBe("common.no_value_selected");
    });

    test("drops aria-valuetext once a value is selected so the number speaks for itself", () => {
      render(<SliderHarness initialValue={50} />);
      expect(getThumb().getAttribute("aria-valuetext")).toBeNull();
    });

    test("withholds the readout while no value exists", () => {
      const { container } = render(<SliderHarness />);
      expect(container.querySelector("output")).toBeNull();
    });

    test("renders the readout once a value exists", () => {
      const { container } = render(<SliderHarness initialValue={50} />);
      expect(container.querySelector("output")?.textContent).toBe("50");
    });

    test("moves the thumb and the readout as an interaction changes the value", () => {
      // The value is round-tripped through the harness exactly as the survey runtime round-trips it, so this
      // asserts the whole loop: the control reports a number, the runtime stores it, and the re-rendered thumb
      // reflects it. A control that reports values but leaves its thumb parked fails here.
      const { container } = render(<SliderHarness />);
      const thumb = getThumb();

      fireEvent.keyDown(thumb, { key: "ArrowRight" });
      expect(getThumb().getAttribute("aria-valuenow")).toBe("5");
      expect(container.querySelector("output")?.textContent).toBe("5");

      fireEvent.keyDown(getThumb(), { key: "End" });
      expect(getThumb().getAttribute("aria-valuenow")).toBe("100");
      expect(container.querySelector("output")?.textContent).toBe("100");
      expect(getThumb().getAttribute("style") ?? "").toContain("100%");
    });
  });

  // -----------------------------------------------------------------------
  // Suite 2: keyboard interaction
  // -----------------------------------------------------------------------

  describe("keyboard interaction", () => {
    test("the first arrow key press steps one increment up from the minimum", () => {
      // The exact production defect: the previous implementation swallowed this key press and committed
      // the parked minimum, so a respondent who stepped forward once submitted 0 instead of 5.
      const onResponse = vi.fn();
      render(<SliderHarness onResponse={onResponse} />);
      const thumb = getThumb();

      fireEvent.keyDown(thumb, { key: "ArrowRight" });
      fireEvent.keyUp(thumb, { key: "ArrowRight" });

      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse).toHaveBeenCalledWith({ "slider-element": 5 });
      expect(getThumb().getAttribute("aria-valuenow")).toBe("5");
    });

    test("continues stepping from the value already selected", () => {
      const onResponse = vi.fn();
      render(<SliderHarness initialValue={50} onResponse={onResponse} />);

      fireEvent.keyDown(getThumb(), { key: "ArrowRight" });
      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 55 });
      expect(getThumb().getAttribute("aria-valuenow")).toBe("55");

      fireEvent.keyDown(getThumb(), { key: "ArrowLeft" });
      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 50 });
      expect(getThumb().getAttribute("aria-valuenow")).toBe("50");
    });

    test("Home and End jump to the range bounds", () => {
      const onResponse = vi.fn();
      render(<SliderHarness initialValue={50} onResponse={onResponse} />);

      fireEvent.keyDown(getThumb(), { key: "End" });
      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 100 });

      fireEvent.keyDown(getThumb(), { key: "Home" });
      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 0 });
      expect(getThumb().getAttribute("aria-valuenow")).toBe("0");
    });

    test("the page keys move by ten increments", () => {
      const onResponse = vi.fn();
      render(<SliderHarness initialValue={50} onResponse={onResponse} />);

      fireEvent.keyDown(getThumb(), { key: "PageDown" });
      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 0 });

      fireEvent.keyDown(getThumb(), { key: "PageUp" });
      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 50 });
    });

    test("steps from the element's own minimum when the range does not start at zero", () => {
      const onResponse = vi.fn();
      const element = createSliderElement({ range: { min: 10, max: 50 }, step: 5 });
      render(<SliderHarness element={element} onResponse={onResponse} />);

      expect(getThumb().getAttribute("aria-valuenow")).toBe("10");
      fireEvent.keyDown(getThumb(), { key: "ArrowRight" });
      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 15 });
    });

    test("bills time to completion once the key press finishes", () => {
      const onTtc = vi.fn();
      render(<SliderHarness onTtc={onTtc} />);
      const thumb = getThumb();

      fireEvent.keyDown(thumb, { key: "ArrowRight" });
      expect(onTtc).not.toHaveBeenCalled();

      fireEvent.keyUp(thumb, { key: "ArrowRight" });
      expect(onTtc).toHaveBeenCalledTimes(1);
      expect(typeof onTtc.mock.calls[0][0]["slider-element"]).toBe("number");
    });
  });

  // -----------------------------------------------------------------------
  // Suite 3: pointer interaction
  // -----------------------------------------------------------------------

  describe("pointer interaction", () => {
    test("selects the value at the pressed position and moves the thumb there", () => {
      const onResponse = vi.fn();
      const { container } = render(<SliderHarness onResponse={onResponse} />);
      const root = stubRootGeometry(container);

      fireEvent.pointerDown(root, { pointerId: 1, clientX: 100 });

      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 50 });
      expect(getThumb().getAttribute("aria-valuenow")).toBe("50");
      expect(getThumb().getAttribute("style") ?? "").toContain("50%");
    });

    test("tracks a drag and reports every position it crosses", () => {
      const onResponse = vi.fn();
      const { container } = render(<SliderHarness onResponse={onResponse} />);
      const root = stubRootGeometry(container);

      fireEvent.pointerDown(root, { pointerId: 1, clientX: 0 });
      fireEvent.pointerMove(root, { pointerId: 1, clientX: 100 });
      fireEvent.pointerMove(root, { pointerId: 1, clientX: 200 });
      fireEvent.pointerUp(root, { pointerId: 1, clientX: 200 });

      const reported = onResponse.mock.calls.map((call) => (call[0] as TResponseData)["slider-element"]);
      expect(reported).toEqual([0, 50, 100]);
      expect(getThumb().getAttribute("aria-valuenow")).toBe("100");
    });

    test("bills time to completion once when the drag ends, not per reported position", () => {
      const onTtc = vi.fn();
      const { container } = render(<SliderHarness onTtc={onTtc} />);
      const root = stubRootGeometry(container);

      fireEvent.pointerDown(root, { pointerId: 1, clientX: 0 });
      fireEvent.pointerMove(root, { pointerId: 1, clientX: 100 });
      expect(onTtc).not.toHaveBeenCalled();

      fireEvent.pointerUp(root, { pointerId: 1, clientX: 100 });
      expect(onTtc).toHaveBeenCalledTimes(1);
    });

    test("hands focus to the thumb so the keyboard continues from the pointer's value", () => {
      const onResponse = vi.fn();
      const { container } = render(<SliderHarness onResponse={onResponse} />);
      const root = stubRootGeometry(container);

      fireEvent.pointerDown(root, { pointerId: 1, clientX: 100 });
      fireEvent.pointerUp(root, { pointerId: 1, clientX: 100 });

      expect(document.activeElement).toBe(getThumb());

      fireEvent.keyDown(getThumb(), { key: "ArrowRight" });
      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 55 });
    });

    test("snaps a pressed position onto the configured grid", () => {
      const onResponse = vi.fn();
      const { container } = render(<SliderHarness onResponse={onResponse} />);
      const root = stubRootGeometry(container);

      // 47% of the range is 47, which is off a step-5 grid; the nearest grid point is 45.
      fireEvent.pointerDown(root, { pointerId: 1, clientX: 94 });
      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 45 });
    });
  });

  // -----------------------------------------------------------------------
  // Suite 4: right-to-left direction
  // -----------------------------------------------------------------------

  describe("right-to-left direction", () => {
    test("inverts the horizontal arrows", () => {
      const onResponse = vi.fn();
      render(<SliderHarness dir="rtl" initialValue={50} onResponse={onResponse} />);

      fireEvent.keyDown(getThumb(), { key: "ArrowRight" });
      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 45 });

      fireEvent.keyDown(getThumb(), { key: "ArrowLeft" });
      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 50 });
    });

    test("keeps the vertical arrows pointing at the range bounds", () => {
      const onResponse = vi.fn();
      render(<SliderHarness dir="rtl" initialValue={50} onResponse={onResponse} />);

      fireEvent.keyDown(getThumb(), { key: "ArrowUp" });
      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 55 });
    });

    test("measures a pointer press from the right edge", () => {
      const onResponse = vi.fn();
      const { container } = render(<SliderHarness dir="rtl" onResponse={onResponse} />);
      const root = stubRootGeometry(container);

      fireEvent.pointerDown(root, { pointerId: 1, clientX: 50 });
      expect(onResponse).toHaveBeenLastCalledWith({ "slider-element": 75 });
    });
  });

  // -----------------------------------------------------------------------
  // Suite 5: the submitted response
  // -----------------------------------------------------------------------

  describe("submitted response", () => {
    test("writes a bare number keyed by the element id", () => {
      const onResponse = vi.fn();
      render(<SliderHarness onResponse={onResponse} />);

      fireEvent.keyDown(getThumb(), { key: "End" });

      const responseData = onResponse.mock.calls[0][0] as TResponseData;
      expect(Object.keys(responseData)).toEqual(["slider-element"]);
      expect(typeof responseData["slider-element"]).toBe("number");
      expect(responseData["slider-element"]).toBe(100);
    });

    test("keeps a slider that was never touched free of any response value", () => {
      const onResponse = vi.fn();
      render(<SliderHarness onResponse={onResponse} />);
      expect(onResponse).not.toHaveBeenCalled();
    });

    test("reports a selection of the minimum as the number it is", () => {
      const onResponse = vi.fn();
      render(<SliderHarness initialValue={50} onResponse={onResponse} />);

      fireEvent.keyDown(getThumb(), { key: "Home" });

      const responseData = onResponse.mock.calls[0][0] as TResponseData;
      expect(responseData["slider-element"]).toBe(0);
      expect(typeof responseData["slider-element"]).toBe("number");
    });

    test("surfaces a validation message alongside the control", () => {
      render(<SliderHarness errorMessage="Please pick a value" />);
      expect(screen.getByText("Please pick a value")).toBeTruthy();
      expect(getThumb().getAttribute("aria-invalid")).toBe("true");
    });
  });
});
