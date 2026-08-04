// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { TResponseTtc } from "@formbricks/types/responses";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import type { TSurveySliderElement } from "@formbricks/types/surveys/elements";
import { SliderElement } from "../slider-element";

// ---------------------------------------------------------------------------
// The props the runtime wrapper forwards to the presentational control. Declared as an interface so the
// mock below states the contract it stands in for; it is erased at compile time, which is why the hoisted
// `vi.mock` factory may reference it.
// ---------------------------------------------------------------------------

interface MockSliderProps {
  elementId: string;
  headline: string;
  description?: string;
  inputId: string;
  min: number;
  max: number;
  step: number;
  value?: number;
  onChange: (value: number) => void;
  lowerLabel?: string;
  upperLabel?: string;
  showValue?: boolean;
  required?: boolean;
  requiredLabel?: string;
  errorMessage?: string;
  dir?: string;
  imageUrl?: string;
  videoUrl?: string;
}

// ---------------------------------------------------------------------------
// Mock @formbricks/survey-ui — the Slider presentational control.
//
// Pointer, keyboard and direction handling belong to that package (and are covered by its own suite), so
// the mock deliberately owns none of it. It renders every forwarded prop as an inspectable node and
// exposes buttons that invoke `onChange` with a chosen number, which is exactly the boundary this
// wrapper is responsible for: the control hands it a bare number and the wrapper turns that into a
// response payload, and bills a segment of time to completion for it.
//
// `value` and `showValue` are stringified rather than rendered directly, because `0` and `false` are
// meaningful values here and conditional rendering would erase them.
//
// The buttons are explicitly `type="button"` so a selection never implicitly submits the surrounding
// form. That keeps the two code paths under test apart: a selection exercises only the change handler,
// while the submission tests dispatch a submit event themselves.
// ---------------------------------------------------------------------------

vi.mock("@formbricks/survey-ui", () => ({
  Slider: vi.fn(
    ({
      elementId,
      headline,
      description,
      inputId,
      min,
      max,
      step,
      value,
      onChange,
      lowerLabel,
      upperLabel,
      showValue,
      required,
      requiredLabel,
      errorMessage,
      dir,
      imageUrl,
      videoUrl,
    }: MockSliderProps) => (
      <div data-testid={`slider-${elementId}`}>
        <span data-testid="headline">{headline}</span>
        <span data-testid="element-id">{elementId}</span>
        <span data-testid="input-id">{inputId}</span>
        <span data-testid="min">{min}</span>
        <span data-testid="max">{max}</span>
        <span data-testid="step">{step}</span>
        <span data-testid="value">{typeof value === "number" ? String(value) : "unanswered"}</span>
        <span data-testid="show-value">{String(showValue)}</span>
        {description ? <span data-testid="description">{description}</span> : null}
        {lowerLabel ? <span data-testid="lower-label">{lowerLabel}</span> : null}
        {upperLabel ? <span data-testid="upper-label">{upperLabel}</span> : null}
        {required ? <span data-testid="required">{requiredLabel}</span> : null}
        {dir ? <span data-testid="dir">{dir}</span> : null}
        {imageUrl ? <span data-testid="image-url">{imageUrl}</span> : null}
        {videoUrl ? <span data-testid="video-url">{videoUrl}</span> : null}
        {errorMessage ? <span data-testid="error-message">{errorMessage}</span> : null}
        <button type="button" data-testid="select-min" onClick={() => onChange(min)}>
          select min
        </button>
        <button type="button" data-testid="select-max" onClick={() => onChange(max)}>
          select max
        </button>
        <button type="button" data-testid="select-zero" onClick={() => onChange(0)}>
          select zero
        </button>
        <button type="button" data-testid="select-fifty" onClick={() => onChange(50)}>
          select fifty
        </button>
      </div>
    )
  ),
}));

// ---------------------------------------------------------------------------
// Mock the TTC tracking utilities. The mocks are declared at module scope and referenced from inside the
// factory's wrapper functions, so they are only touched when the component calls them — never while the
// hoisted factory is being evaluated. `getUpdatedTtc` reproduces the real accumulation semantics so the
// value handed to `setTtc` can be asserted exactly.
// ---------------------------------------------------------------------------

const mockGetUpdatedTtc = vi.fn(
  (ttc: TResponseTtc, id: string, time: number): TResponseTtc => ({
    ...ttc,
    [id]: ((ttc[id] as number) || 0) + time,
  })
);
const mockUseTtc = vi.fn();

vi.mock("@/lib/ttc", () => ({
  getUpdatedTtc: (...args: unknown[]) => mockGetUpdatedTtc(...(args as [TResponseTtc, string, number])),
  useTtc: (...args: unknown[]) => mockUseTtc(...args),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/i18n — `getLocalizedValue` resolves an internationalized string for the active language,
// falling back to the default translation, mirroring the real helper.
// ---------------------------------------------------------------------------

vi.mock("@/lib/i18n", () => ({
  getLocalizedValue: vi.fn(
    (localizedString: Record<string, string> | undefined, languageCode: string): string => {
      if (!localizedString) return "";
      return localizedString[languageCode] || localizedString.default || "";
    }
  ),
}));

// ---------------------------------------------------------------------------
// Freeze the clock so every time-to-completion assertion is exact. Individual tests advance it after
// mounting to assert the elapsed time the wrapper reports.
// ---------------------------------------------------------------------------

vi.spyOn(performance, "now").mockReturnValue(1000);

// ---------------------------------------------------------------------------
// Test helper — a realistic slider element matching the ZSurveySliderElement contract, configured with
// the feature's reference range of 0..100 in steps of 5.
// ---------------------------------------------------------------------------

function createMockSliderElement(overrides: Partial<TSurveySliderElement> = {}): TSurveySliderElement {
  return {
    id: "s1",
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

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("SliderElement", () => {
  const defaultProps = {
    element: createMockSliderElement(),
    value: undefined as number | undefined,
    onChange: vi.fn(),
    languageCode: "default",
    ttc: {} as TResponseTtc,
    setTtc: vi.fn(),
    currentElementId: "s1",
    dir: "auto" as const,
    errorMessage: undefined as string | undefined,
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Re-stub performance.now after clearAllMocks so the clock stays frozen for the next test.
    vi.spyOn(performance, "now").mockReturnValue(1000);
  });

  // -----------------------------------------------------------------------
  // Suite 1: Configuration pass-through
  // -----------------------------------------------------------------------

  describe("configuration pass-through", () => {
    test("renders the control keyed by the element id", () => {
      render(<SliderElement {...defaultProps} />);
      expect(screen.getByTestId("slider-s1")).toBeTruthy();
    });

    test("gives the control an input id derived from, but distinct from, the element id", () => {
      // The element id is already on the control's own wrapper. Reusing it for the input would leave two
      // nodes answering to one id, and the header's label binds to whichever comes first - the wrapper -
      // so the control would be left with no accessible name.
      render(<SliderElement {...defaultProps} />);
      expect(screen.getByTestId("input-id").textContent).toBe("s1-input");
      expect(screen.getByTestId("element-id").textContent).toBe("s1");
    });

    test("forwards the configured minimum, maximum and step", () => {
      render(<SliderElement {...defaultProps} />);
      expect(screen.getByTestId("min").textContent).toBe("0");
      expect(screen.getByTestId("max").textContent).toBe("100");
      expect(screen.getByTestId("step").textContent).toBe("5");
    });

    test("forwards a range that does not start at zero", () => {
      const element = createMockSliderElement({ range: { min: 10, max: 50 }, step: 5 });
      render(<SliderElement {...defaultProps} element={element} />);
      expect(screen.getByTestId("min").textContent).toBe("10");
      expect(screen.getByTestId("max").textContent).toBe("50");
      expect(screen.getByTestId("step").textContent).toBe("5");
    });

    test("forwards a fractional step unchanged", () => {
      const element = createMockSliderElement({ range: { min: 0, max: 1 }, step: 0.1 });
      render(<SliderElement {...defaultProps} element={element} />);
      expect(screen.getByTestId("step").textContent).toBe("0.1");
    });

    test("renders inside a full-width form", () => {
      const { container } = render(<SliderElement {...defaultProps} />);
      const form = container.querySelector("form");
      expect(form).toBeTruthy();
      expect(form?.className).toContain("w-full");
    });

    test("forwards the element's media urls", () => {
      const element = createMockSliderElement({
        imageUrl: "https://example.com/image.png",
        videoUrl: "https://example.com/video.mp4",
      });
      render(<SliderElement {...defaultProps} element={element} />);
      expect(screen.getByTestId("image-url").textContent).toBe("https://example.com/image.png");
      expect(screen.getByTestId("video-url").textContent).toBe("https://example.com/video.mp4");
    });

    test("omits media urls when the element carries none", () => {
      render(<SliderElement {...defaultProps} />);
      expect(screen.queryByTestId("image-url")).toBeNull();
      expect(screen.queryByTestId("video-url")).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Suite 2: Localization
  // -----------------------------------------------------------------------

  describe("localization", () => {
    test("resolves the headline for the active language", () => {
      render(<SliderElement {...defaultProps} />);
      expect(screen.getByTestId("headline").textContent).toBe("How satisfied are you?");
    });

    test("resolves the headline for a non-default language", () => {
      const element = createMockSliderElement({
        headline: { default: "How satisfied are you?", de: "Wie zufrieden sind Sie?" },
      });
      render(<SliderElement {...defaultProps} element={element} languageCode="de" />);
      expect(screen.getByTestId("headline").textContent).toBe("Wie zufrieden sind Sie?");
    });

    test("resolves the description from the element's subheader", () => {
      render(<SliderElement {...defaultProps} />);
      expect(screen.getByTestId("description").textContent).toBe("Drag the handle to pick a value");
    });

    test("omits the description when the element has no subheader", () => {
      const element = createMockSliderElement({ subheader: undefined });
      render(<SliderElement {...defaultProps} element={element} />);
      expect(screen.queryByTestId("description")).toBeNull();
    });

    test("resolves the lower and upper scale labels", () => {
      render(<SliderElement {...defaultProps} />);
      expect(screen.getByTestId("lower-label").textContent).toBe("Not satisfied");
      expect(screen.getByTestId("upper-label").textContent).toBe("Very satisfied");
    });

    test("resolves the scale labels for a non-default language", () => {
      const element = createMockSliderElement({
        lowerLabel: { default: "Not satisfied", de: "Unzufrieden" },
        upperLabel: { default: "Very satisfied", de: "Sehr zufrieden" },
      });
      render(<SliderElement {...defaultProps} element={element} languageCode="de" />);
      expect(screen.getByTestId("lower-label").textContent).toBe("Unzufrieden");
      expect(screen.getByTestId("upper-label").textContent).toBe("Sehr zufrieden");
    });

    test("omits the scale labels when the element declares none", () => {
      const element = createMockSliderElement({ lowerLabel: undefined, upperLabel: undefined });
      render(<SliderElement {...defaultProps} element={element} />);
      expect(screen.queryByTestId("lower-label")).toBeNull();
      expect(screen.queryByTestId("upper-label")).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Suite 3: Response capture — the numeric payload keyed by the element id
  // -----------------------------------------------------------------------

  describe("response capture", () => {
    test("does not emit a response on mount", () => {
      const onChange = vi.fn();
      render(<SliderElement {...defaultProps} onChange={onChange} />);
      expect(onChange).not.toHaveBeenCalled();
    });

    test("does not emit a response when re-rendered with an existing value", () => {
      const onChange = vi.fn();
      const { rerender } = render(<SliderElement {...defaultProps} onChange={onChange} />);
      rerender(<SliderElement {...defaultProps} onChange={onChange} value={50} />);
      expect(onChange).not.toHaveBeenCalled();
    });

    test("emits the selected value keyed by the element id", () => {
      const onChange = vi.fn();
      render(<SliderElement {...defaultProps} onChange={onChange} />);
      fireEvent.click(screen.getByTestId("select-fifty"));
      expect(onChange).toHaveBeenCalledWith({ s1: 50 });
    });

    test("emits a bare number rather than a string", () => {
      const onChange = vi.fn();
      render(<SliderElement {...defaultProps} onChange={onChange} />);
      fireEvent.click(screen.getByTestId("select-fifty"));
      const responseData = onChange.mock.calls[0][0] as Record<string, unknown>;
      expect(typeof responseData.s1).toBe("number");
      expect(responseData.s1).toBe(50);
    });

    test("emits zero as a real answer", () => {
      const onChange = vi.fn();
      render(<SliderElement {...defaultProps} onChange={onChange} />);
      fireEvent.click(screen.getByTestId("select-zero"));
      expect(onChange).toHaveBeenCalledWith({ s1: 0 });
      const responseData = onChange.mock.calls[0][0] as Record<string, unknown>;
      expect(typeof responseData.s1).toBe("number");
    });

    test("emits the lower bound of the configured range", () => {
      const onChange = vi.fn();
      const element = createMockSliderElement({ range: { min: 10, max: 50 } });
      render(<SliderElement {...defaultProps} element={element} onChange={onChange} />);
      fireEvent.click(screen.getByTestId("select-min"));
      expect(onChange).toHaveBeenCalledWith({ s1: 10 });
    });

    test("emits the upper bound of the configured range", () => {
      const onChange = vi.fn();
      render(<SliderElement {...defaultProps} onChange={onChange} />);
      fireEvent.click(screen.getByTestId("select-max"));
      expect(onChange).toHaveBeenCalledWith({ s1: 100 });
    });

    test("emits exactly once per selection", () => {
      const onChange = vi.fn();
      render(<SliderElement {...defaultProps} onChange={onChange} />);
      fireEvent.click(screen.getByTestId("select-fifty"));
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    test("emits once per selection when the respondent changes their mind", () => {
      const onChange = vi.fn();
      render(<SliderElement {...defaultProps} onChange={onChange} />);
      fireEvent.click(screen.getByTestId("select-fifty"));
      fireEvent.click(screen.getByTestId("select-max"));
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenNthCalledWith(1, { s1: 50 });
      expect(onChange).toHaveBeenNthCalledWith(2, { s1: 100 });
    });

    test("keys the payload with a custom element id", () => {
      const onChange = vi.fn();
      const element = createMockSliderElement({ id: "custom-slider-id" });
      render(
        <SliderElement
          {...defaultProps}
          element={element}
          currentElementId="custom-slider-id"
          onChange={onChange}
        />
      );
      fireEvent.click(screen.getByTestId("select-fifty"));
      expect(onChange).toHaveBeenCalledWith({ "custom-slider-id": 50 });
    });
  });

  // -----------------------------------------------------------------------
  // Suite 4: Unanswered state
  //
  // The wrapper must forward `value` untouched. An unanswered slider whose minimum is 0 would otherwise
  // be indistinguishable from one answered with 0, which both the required check and the summary's
  // dismissed count rely on.
  // -----------------------------------------------------------------------

  describe("unanswered state", () => {
    test("forwards no value when the element is unanswered", () => {
      render(<SliderElement {...defaultProps} value={undefined} />);
      expect(screen.getByTestId("value").textContent).toBe("unanswered");
    });

    test("does not default an unanswered value to the range minimum", () => {
      const element = createMockSliderElement({ range: { min: 10, max: 50 } });
      render(<SliderElement {...defaultProps} element={element} value={undefined} />);
      expect(screen.getByTestId("value").textContent).toBe("unanswered");
      expect(screen.getByTestId("min").textContent).toBe("10");
    });

    test("forwards a stored zero as an answered value", () => {
      render(<SliderElement {...defaultProps} value={0} />);
      expect(screen.getByTestId("value").textContent).toBe("0");
    });

    test("forwards a stored mid-range value unchanged", () => {
      render(<SliderElement {...defaultProps} value={35} />);
      expect(screen.getByTestId("value").textContent).toBe("35");
    });
  });

  // -----------------------------------------------------------------------
  // Suite 5: Time-to-completion tracking
  // -----------------------------------------------------------------------

  describe("time to completion", () => {
    test("registers the tracking hook for the element", () => {
      render(<SliderElement {...defaultProps} />);
      expect(mockUseTtc).toHaveBeenCalled();
      expect(mockUseTtc.mock.calls[0][0]).toBe("s1");
    });

    test("passes the ttc record and its setter to the tracking hook", () => {
      const ttc = { otherElement: 500 } as TResponseTtc;
      const setTtc = vi.fn();
      render(<SliderElement {...defaultProps} ttc={ttc} setTtc={setTtc} />);
      expect(mockUseTtc.mock.calls[0][1]).toBe(ttc);
      expect(mockUseTtc.mock.calls[0][2]).toBe(setTtc);
    });

    test("passes the mount time as the tracking start time", () => {
      render(<SliderElement {...defaultProps} />);
      expect(mockUseTtc.mock.calls[0][3]).toBe(1000);
    });

    test("marks the element as current when it matches the current element id", () => {
      render(<SliderElement {...defaultProps} />);
      expect(mockUseTtc.mock.calls[0][5]).toBe(true);
    });

    test("marks the element as not current when another element is showing", () => {
      render(<SliderElement {...defaultProps} currentElementId="another-element" />);
      expect(mockUseTtc.mock.calls[0][5]).toBe(false);
    });

    test("reports the time elapsed since mount when a value is reported", () => {
      const ttc = { s1: 200 } as TResponseTtc;
      render(<SliderElement {...defaultProps} ttc={ttc} />);
      // The wrapper captured 1000 as its start time on mount, so advancing the clock by 500 must be
      // reported as 500 rather than as the absolute timestamp.
      vi.spyOn(performance, "now").mockReturnValue(1500);
      fireEvent.click(screen.getByTestId("select-fifty"));
      expect(mockGetUpdatedTtc).toHaveBeenCalledWith(ttc, "s1", 500);
    });

    test("accumulates the elapsed time onto the existing record", () => {
      const setTtc = vi.fn();
      const ttc = { s1: 200 } as TResponseTtc;
      render(<SliderElement {...defaultProps} ttc={ttc} setTtc={setTtc} />);
      vi.spyOn(performance, "now").mockReturnValue(1500);
      fireEvent.click(screen.getByTestId("select-fifty"));
      expect(setTtc).toHaveBeenCalledTimes(1);
      expect(setTtc).toHaveBeenCalledWith({ s1: 700 });
    });

    test("does not re-charge the elapsed time once per answer", () => {
      // `getUpdatedTtc` ADDS the duration it is handed, so billing the whole time since mount for every
      // answer would charge several interactions as if each had lasted the element's whole lifetime. The
      // segment advances as each answer is billed, so answers after the first cost only their own time.
      const setTtc = vi.fn();
      render(<SliderElement {...defaultProps} ttc={{ s1: 200 } as TResponseTtc} setTtc={setTtc} />);
      vi.spyOn(performance, "now").mockReturnValue(1500);
      fireEvent.click(screen.getByTestId("select-min"));
      fireEvent.click(screen.getByTestId("select-fifty"));
      fireEvent.click(screen.getByTestId("select-max"));

      expect(mockGetUpdatedTtc.mock.calls.map((call) => call[2])).toEqual([500, 0, 0]);
    });

    test("bills consecutive answers as one continuous span rather than as overlapping ones", () => {
      // The durations billed across a series of answers must add up to the time they actually took: every
      // segment starts where the previous one ended, so no instant is billed twice or lost.
      const setTtc = vi.fn();
      render(<SliderElement {...defaultProps} ttc={{} as TResponseTtc} setTtc={setTtc} />);
      vi.spyOn(performance, "now").mockReturnValue(1200);
      fireEvent.click(screen.getByTestId("select-min"));
      vi.spyOn(performance, "now").mockReturnValue(1500);
      fireEvent.click(screen.getByTestId("select-fifty"));
      vi.spyOn(performance, "now").mockReturnValue(1600);
      fireEvent.click(screen.getByTestId("select-max"));

      const billed = mockGetUpdatedTtc.mock.calls.map((call) => call[2] as number);
      expect(billed).toEqual([200, 300, 100]);
      expect(billed.reduce((total, duration) => total + duration, 0)).toBe(600);
    });

    test("bills exactly one segment per answer", () => {
      const setTtc = vi.fn();
      render(<SliderElement {...defaultProps} setTtc={setTtc} />);

      fireEvent.click(screen.getByTestId("select-fifty"));

      expect(mockGetUpdatedTtc).toHaveBeenCalledTimes(1);
      expect(setTtc).toHaveBeenCalledTimes(1);
    });

    test("hands the tracking hook the same segment start it bills from", () => {
      // `useTtc` bills `performance.now() - startTime` when the tab is hidden. If an answer advanced only
      // this component's own ref, the hook would still be measuring from the mount, and a tab hidden after an
      // answer would re-charge every instant that answer had already paid for.
      const setTtc = vi.fn();
      render(<SliderElement {...defaultProps} setTtc={setTtc} />);
      expect(mockUseTtc.mock.calls[0][3]).toBe(1000);

      vi.spyOn(performance, "now").mockReturnValue(1500);
      fireEvent.click(screen.getByTestId("select-fifty"));
      expect(mockUseTtc.mock.calls[mockUseTtc.mock.calls.length - 1][3]).toBe(1500);

      vi.spyOn(performance, "now").mockReturnValue(1900);
      fireEvent.click(screen.getByTestId("select-max"));
      expect(mockUseTtc.mock.calls[mockUseTtc.mock.calls.length - 1][3]).toBe(1900);

      // Each answer still pays for its own segment only.
      expect(mockGetUpdatedTtc.mock.calls.map((call) => call[2])).toEqual([500, 400]);
    });

    test("bills a tab switch after an answer only for the time since that answer", () => {
      // The arithmetic the hook performs, reproduced against the start time it was actually handed: an answer
      // at 1500 bills 500, and a hide at 2000 must bill the 500 since the answer - not the 1000 since mount.
      const setTtc = vi.fn();
      render(<SliderElement {...defaultProps} ttc={{} as TResponseTtc} setTtc={setTtc} />);

      vi.spyOn(performance, "now").mockReturnValue(1500);
      fireEvent.click(screen.getByTestId("select-fifty"));

      const startTimeForHide = mockUseTtc.mock.calls[mockUseTtc.mock.calls.length - 1][3] as number;
      const billedOnAnswer = mockGetUpdatedTtc.mock.calls[0][2] as number;
      const billedOnHide = 2000 - startTimeForHide;

      expect(billedOnAnswer).toBe(500);
      expect(billedOnHide).toBe(500);
      // The element was on screen for a thousand units in total, and that is what the two segments add up to.
      expect(billedOnAnswer + billedOnHide).toBe(1000);
    });

    test("keeps billing from the ref when two answers land in the same tick", () => {
      // The ref is authoritative because it is correct synchronously: two answers before the re-render must
      // not both bill from the same start.
      const setTtc = vi.fn();
      render(<SliderElement {...defaultProps} ttc={{} as TResponseTtc} setTtc={setTtc} />);

      vi.spyOn(performance, "now").mockReturnValue(1300);
      fireEvent.click(screen.getByTestId("select-min"));
      fireEvent.click(screen.getByTestId("select-fifty"));

      expect(mockGetUpdatedTtc.mock.calls.map((call) => call[2])).toEqual([300, 0]);
    });

    test("starts a new segment at the instant the previous one closed", () => {
      // One clock reading closes the finished segment and opens the next, so the instant between two
      // answers is neither billed twice nor lost.
      const setTtc = vi.fn();
      render(<SliderElement {...defaultProps} ttc={{} as TResponseTtc} setTtc={setTtc} />);
      vi.spyOn(performance, "now").mockReturnValue(1400);
      fireEvent.click(screen.getByTestId("select-fifty"));
      vi.spyOn(performance, "now").mockReturnValue(1900);
      fireEvent.click(screen.getByTestId("select-max"));
      expect(setTtc).toHaveBeenNthCalledWith(1, { s1: 400 });
      expect(mockGetUpdatedTtc).toHaveBeenLastCalledWith(expect.anything(), "s1", 500);
    });
  });

  // -----------------------------------------------------------------------
  // Suite 6: Form submission
  // -----------------------------------------------------------------------

  describe("form submission", () => {
    test("prevents the browser's default submission", () => {
      const { container } = render(<SliderElement {...defaultProps} />);
      const form = container.querySelector("form");
      expect(form).toBeTruthy();
      const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
      const preventDefault = vi.spyOn(submitEvent, "preventDefault");
      form?.dispatchEvent(submitEvent);
      expect(preventDefault).toHaveBeenCalled();
    });

    test("reports the elapsed time for the element on submission", () => {
      const ttc = { s1: 200 } as TResponseTtc;
      const { container } = render(<SliderElement {...defaultProps} ttc={ttc} />);
      vi.spyOn(performance, "now").mockReturnValue(1500);
      fireEvent.submit(container.querySelector("form")!);
      expect(mockGetUpdatedTtc).toHaveBeenCalledWith(ttc, "s1", 500);
    });

    test("stores the accumulated time on submission", () => {
      const setTtc = vi.fn();
      const ttc = { s1: 200 } as TResponseTtc;
      const { container } = render(<SliderElement {...defaultProps} ttc={ttc} setTtc={setTtc} />);
      vi.spyOn(performance, "now").mockReturnValue(1500);
      fireEvent.submit(container.querySelector("form")!);
      expect(setTtc).toHaveBeenCalledWith({ s1: 700 });
    });

    test("does not emit a response value on submission", () => {
      const onChange = vi.fn();
      const { container } = render(<SliderElement {...defaultProps} onChange={onChange} />);
      fireEvent.submit(container.querySelector("form")!);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Suite 7: Prop variations
  // -----------------------------------------------------------------------

  describe("prop variations", () => {
    test("marks a required element with the translated required label", () => {
      render(<SliderElement {...defaultProps} />);
      expect(screen.getByTestId("required").textContent).toBe("common.required");
    });

    test("does not mark an optional element as required", () => {
      const element = createMockSliderElement({ required: false });
      render(<SliderElement {...defaultProps} element={element} />);
      expect(screen.queryByTestId("required")).toBeNull();
    });

    test("forwards an enabled value readout", () => {
      render(<SliderElement {...defaultProps} />);
      expect(screen.getByTestId("show-value").textContent).toBe("true");
    });

    test("forwards a disabled value readout", () => {
      const element = createMockSliderElement({ showValue: false });
      render(<SliderElement {...defaultProps} element={element} />);
      expect(screen.getByTestId("show-value").textContent).toBe("false");
    });

    test("defaults the text direction to auto", () => {
      // `dir` is deliberately omitted here rather than spread from the defaults, so the assertion proves
      // the wrapper's own default rather than the value the other tests pass in.
      render(
        <SliderElement
          element={defaultProps.element}
          onChange={defaultProps.onChange}
          languageCode="default"
          ttc={{}}
          setTtc={defaultProps.setTtc}
          currentElementId="s1"
        />
      );
      expect(screen.getByTestId("dir").textContent).toBe("auto");
    });

    test("forwards a right-to-left text direction", () => {
      render(<SliderElement {...defaultProps} dir="rtl" />);
      expect(screen.getByTestId("dir").textContent).toBe("rtl");
    });

    test("forwards a validation error message", () => {
      render(<SliderElement {...defaultProps} errorMessage="Please enter a value in increments of 5" />);
      expect(screen.getByTestId("error-message").textContent).toBe("Please enter a value in increments of 5");
    });

    test("renders no error message when there is none", () => {
      render(<SliderElement {...defaultProps} errorMessage={undefined} />);
      expect(screen.queryByTestId("error-message")).toBeNull();
    });
  });
});
