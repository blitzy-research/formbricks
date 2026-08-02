// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { TResponseData, TResponseDataValue, TResponseTtc } from "@formbricks/types/responses";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import type { TSurveyElement, TSurveySliderElement } from "@formbricks/types/surveys/elements";
import { ElementConditional } from "../element-conditional";

// ---------------------------------------------------------------------------
// Every element component the dispatcher can reach is replaced by a stub that records the props it was
// handed. That is deliberate: the seam under test is the `switch (element.type)` itself - which component
// a type reaches, and which of the dispatcher's props survive the hand-off - not what any element
// component then renders. Each element component owns its own suite for that.
//
// Recording props rather than rendering them keeps the assertions exact. `value: 0` and a wrapped `setTtc`
// cannot be asserted through the DOM without stringifying them first, and function identity - proving the
// dispatcher forwards *the caller's* `onChange` rather than a copy - cannot be asserted through the DOM at
// all.
//
// The stub renders a `<form>` because every real element component does, which is what the dispatcher's
// form-exposure effect looks for.
// ---------------------------------------------------------------------------

type StubProps = Record<string, unknown>;

interface RecordedRender {
  component: string;
  props: StubProps;
}

const recordedRenders: RecordedRender[] = [];

function renderStub(component: string, props: StubProps) {
  recordedRenders.push({ component, props });
  return (
    <form data-testid={`stub-${component}`}>
      <span data-testid="stub-component-name">{component}</span>
    </form>
  );
}

vi.mock("@/components/elements/address-element", () => ({
  AddressElement: (props: StubProps) => renderStub("AddressElement", props),
}));
vi.mock("@/components/elements/cal-element", () => ({
  CalElement: (props: StubProps) => renderStub("CalElement", props),
}));
vi.mock("@/components/elements/consent-element", () => ({
  ConsentElement: (props: StubProps) => renderStub("ConsentElement", props),
}));
vi.mock("@/components/elements/contact-info-element", () => ({
  ContactInfoElement: (props: StubProps) => renderStub("ContactInfoElement", props),
}));
vi.mock("@/components/elements/cta-element", () => ({
  CTAElement: (props: StubProps) => renderStub("CTAElement", props),
}));
vi.mock("@/components/elements/date-element", () => ({
  DateElement: (props: StubProps) => renderStub("DateElement", props),
}));
vi.mock("@/components/elements/file-upload-element", () => ({
  FileUploadElement: (props: StubProps) => renderStub("FileUploadElement", props),
}));
vi.mock("@/components/elements/matrix-element", () => ({
  MatrixElement: (props: StubProps) => renderStub("MatrixElement", props),
}));
vi.mock("@/components/elements/multiple-choice-multi-element", () => ({
  MultipleChoiceMultiElement: (props: StubProps) => renderStub("MultipleChoiceMultiElement", props),
}));
vi.mock("@/components/elements/multiple-choice-single-element", () => ({
  MultipleChoiceSingleElement: (props: StubProps) => renderStub("MultipleChoiceSingleElement", props),
}));
vi.mock("@/components/elements/nps-element", () => ({
  NPSElement: (props: StubProps) => renderStub("NPSElement", props),
}));
vi.mock("@/components/elements/open-text-element", () => ({
  OpenTextElement: (props: StubProps) => renderStub("OpenTextElement", props),
}));
vi.mock("@/components/elements/opinion-scale-element", () => ({
  OpinionScaleElement: (props: StubProps) => renderStub("OpinionScaleElement", props),
}));
vi.mock("@/components/elements/payment-element", () => ({
  PaymentElement: (props: StubProps) => renderStub("PaymentElement", props),
}));
vi.mock("@/components/elements/picture-selection-element", () => ({
  PictureSelectionElement: (props: StubProps) => renderStub("PictureSelectionElement", props),
}));
vi.mock("@/components/elements/ranking-element", () => ({
  RankingElement: (props: StubProps) => renderStub("RankingElement", props),
}));
vi.mock("@/components/elements/rating-element", () => ({
  RatingElement: (props: StubProps) => renderStub("RatingElement", props),
}));
vi.mock("@/components/elements/slider-element", () => ({
  SliderElement: (props: StubProps) => renderStub("SliderElement", props),
}));

// ---------------------------------------------------------------------------
// `getLocalizedValue` is only reached by the ranking branch's label-to-choice-id resolution. It is mocked
// so importing the dispatcher never pulls in the i18next runtime, keeping this suite hermetic.
// ---------------------------------------------------------------------------

vi.mock("@/lib/i18n", () => ({
  getLocalizedValue: vi.fn((localizedString: Record<string, string> | undefined, languageCode: string) => {
    if (!localizedString) return "";
    return localizedString[languageCode] || localizedString.default || "";
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SLIDER_ELEMENT_ID = "slider-1";

/**
 * A slider element matching the `ZSurveySliderElement` contract, configured with the feature's reference
 * range of 0..100 in steps of 5. Fully typed, so the slider-specific assertions below are checked against
 * the real schema rather than against a cast.
 */
function createSliderElement(overrides: Partial<TSurveySliderElement> = {}): TSurveySliderElement {
  return {
    id: SLIDER_ELEMENT_ID,
    type: TSurveyElementTypeEnum.Slider,
    headline: { default: "How satisfied are you?" },
    subheader: { default: "Drag the handle to pick a value" },
    required: true,
    range: { min: 0, max: 100 },
    step: 5,
    lowerLabel: { default: "Not satisfied" },
    upperLabel: { default: "Very satisfied" },
    showValue: true,
    ...overrides,
  };
}

/**
 * A minimal element of an arbitrary type, used by the dispatch-coverage table.
 *
 * The dispatcher itself reads only `element.type`, `element.id` and - for ranking, and only when the
 * submitted value is an array - `element.choices`. Every other field belongs to the element component,
 * which is stubbed here. One cast in one place therefore replaces eighteen hand-built fixtures without
 * weakening any assertion in this file.
 */
function createElementOfType(type: TSurveyElementTypeEnum): TSurveyElement {
  return {
    id: `element-${type}`,
    type,
    headline: { default: `Headline for ${type}` },
    required: false,
  } as unknown as TSurveyElement;
}

/**
 * The dispatcher's full required prop set, with fresh spies on every call so identity assertions cannot
 * leak between tests.
 */
function baseProps() {
  return {
    element: createSliderElement() as TSurveyElement,
    value: undefined as TResponseDataValue,
    onChange: vi.fn((_responseData: TResponseData) => undefined),
    onFileUpload: vi.fn(() => Promise.resolve("https://example.com/upload.png")),
    languageCode: "default",
    ttc: { "welcome-card": 120 } as TResponseTtc,
    setTtc: vi.fn((_ttc: TResponseTtc) => undefined),
    surveyId: "survey-1",
    autoFocusEnabled: false,
    currentElementId: SLIDER_ELEMENT_ID,
    surveyLanguages: [],
    dir: "auto" as const,
    errorMessage: undefined as string | undefined,
  };
}

/** The one component the dispatcher rendered, asserting first that it rendered exactly one. */
function getSingleRender(): RecordedRender {
  expect(recordedRenders).toHaveLength(1);
  return recordedRenders[0];
}

/**
 * Every element type paired with the component it must reach.
 *
 * This table is the seam guard the dispatcher itself cannot provide. Its `switch` ends in
 * `default: return null`, so deleting a `case` - the Slider's included - compiles cleanly and silently
 * renders nothing. Asserting the mapping type by type turns that silence into a failure, and the
 * enum-coverage test below makes an unmapped future type fail too rather than go unnoticed.
 */
const DISPATCH_TABLE: { type: TSurveyElementTypeEnum; component: string }[] = [
  { type: TSurveyElementTypeEnum.FileUpload, component: "FileUploadElement" },
  { type: TSurveyElementTypeEnum.OpenText, component: "OpenTextElement" },
  { type: TSurveyElementTypeEnum.MultipleChoiceSingle, component: "MultipleChoiceSingleElement" },
  { type: TSurveyElementTypeEnum.MultipleChoiceMulti, component: "MultipleChoiceMultiElement" },
  { type: TSurveyElementTypeEnum.NPS, component: "NPSElement" },
  { type: TSurveyElementTypeEnum.CTA, component: "CTAElement" },
  { type: TSurveyElementTypeEnum.Rating, component: "RatingElement" },
  { type: TSurveyElementTypeEnum.Consent, component: "ConsentElement" },
  { type: TSurveyElementTypeEnum.PictureSelection, component: "PictureSelectionElement" },
  { type: TSurveyElementTypeEnum.Cal, component: "CalElement" },
  { type: TSurveyElementTypeEnum.Date, component: "DateElement" },
  { type: TSurveyElementTypeEnum.Matrix, component: "MatrixElement" },
  { type: TSurveyElementTypeEnum.Address, component: "AddressElement" },
  { type: TSurveyElementTypeEnum.Ranking, component: "RankingElement" },
  { type: TSurveyElementTypeEnum.ContactInfo, component: "ContactInfoElement" },
  { type: TSurveyElementTypeEnum.Payment, component: "PaymentElement" },
  { type: TSurveyElementTypeEnum.OpinionScale, component: "OpinionScaleElement" },
  { type: TSurveyElementTypeEnum.Slider, component: "SliderElement" },
];

/** The props the slider case declares, and therefore the complete set the stub may receive. */
const SLIDER_FORWARDED_PROPS = [
  "currentElementId",
  "dir",
  "element",
  "errorMessage",
  "languageCode",
  "onChange",
  "setTtc",
  "ttc",
  "value",
];

/** Dispatcher props the slider case deliberately withholds, because the control has no use for them. */
const SLIDER_WITHHELD_PROPS = [
  "autoFocusEnabled",
  "formRef",
  "onFileUpload",
  "onOpenExternalURL",
  "onTtcCollect",
  "surveyId",
  "surveyLanguages",
];

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("ElementConditional", () => {
  afterEach(() => {
    cleanup();
    recordedRenders.length = 0;
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Suite 1: Slider dispatch
  // -----------------------------------------------------------------------

  describe("slider dispatch", () => {
    test("routes a slider element to the slider component", () => {
      render(<ElementConditional {...baseProps()} />);

      expect(getSingleRender().component).toBe("SliderElement");
    });

    test("renders the slider component into the DOM", () => {
      const { container } = render(<ElementConditional {...baseProps()} />);

      expect(container.querySelector('[data-testid="stub-SliderElement"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="stub-component-name"]')?.textContent).toBe(
        "SliderElement"
      );
    });

    test("routes a slider element to no other element component", () => {
      render(<ElementConditional {...baseProps()} />);

      expect(recordedRenders.map((entry) => entry.component)).toEqual(["SliderElement"]);
    });

    test("does not fall through to the dispatcher's terminal null for a slider element", () => {
      const { container } = render(<ElementConditional {...baseProps()} />);

      // The dispatcher always wraps its result in a container div, so an unhandled type shows up as that
      // div being empty rather than as an absent one.
      expect(container.firstElementChild?.tagName.toLowerCase()).toBe("div");
      expect(container.firstElementChild?.childElementCount).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Suite 2: Value narrowing
  //
  // The slider case narrows with `typeof value === "number" ? value : undefined`. Two properties of that
  // expression matter and neither is obvious: a numeric `0` is a real answer and must survive, and a
  // stored value of any other shape - a leftover string from a retyped element, an array from a
  // multi-select - must arrive as `undefined` rather than be handed to a numeric control.
  // -----------------------------------------------------------------------

  describe("value narrowing", () => {
    const numericValues: { label: string; value: number }[] = [
      { label: "zero, the range minimum and a genuine answer", value: 0 },
      { label: "a mid-range value", value: 50 },
      { label: "the range maximum", value: 100 },
      { label: "a negative value", value: -20 },
      { label: "a fractional value", value: 12.5 },
    ];

    test.each(numericValues)("forwards $label unchanged", ({ value }) => {
      render(<ElementConditional {...baseProps()} value={value} />);

      const forwarded = getSingleRender().props.value;
      expect(forwarded).toBe(value);
      expect(typeof forwarded).toBe("number");
    });

    test("forwards a numeric zero rather than erasing it", () => {
      render(<ElementConditional {...baseProps()} value={0} />);

      // Guards against the falsy-value bug class: `value || undefined` and `value ? value : undefined`
      // both compile and both silently turn a legitimate answer of 0 into an unanswered slider.
      const forwarded = getSingleRender().props.value;
      expect(forwarded).toBe(0);
      expect(forwarded).not.toBeUndefined();
    });

    const nonNumericValues: { label: string; value: TResponseDataValue }[] = [
      { label: "a numeric string", value: "50" },
      { label: "an empty string", value: "" },
      { label: "a non-numeric string", value: "not a number" },
      { label: "an array of strings", value: ["50"] },
      { label: "an empty array", value: [] },
      { label: "a record", value: { row: "50" } },
      { label: "an absent value", value: undefined },
    ];

    test.each(nonNumericValues)("narrows $label to undefined", ({ value }) => {
      render(<ElementConditional {...baseProps()} value={value} />);

      expect(getSingleRender().props.value).toBeUndefined();
    });

    test("forwards NaN, because the dispatcher screens by type and not by finiteness", () => {
      render(<ElementConditional {...baseProps()} value={Number.NaN} />);

      // Documented rather than desired: `typeof NaN === "number"`, so this seam lets it through and the
      // shared validation engine is what rejects it. Pinning the behaviour here means a future change to
      // either layer has to be deliberate.
      expect(Number.isNaN(getSingleRender().props.value)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Suite 3: Prop forwarding
  // -----------------------------------------------------------------------

  describe("prop forwarding", () => {
    test("forwards the element itself by identity", () => {
      const props = baseProps();
      render(<ElementConditional {...props} />);

      expect(getSingleRender().props.element).toBe(props.element);
    });

    test("forwards the caller's change handler by identity", () => {
      const props = baseProps();
      render(<ElementConditional {...props} />);

      expect(getSingleRender().props.onChange).toBe(props.onChange);
    });

    test("forwards the language code, accumulated ttc and current element id", () => {
      const props = baseProps();
      render(<ElementConditional {...props} languageCode="de" />);

      const forwarded = getSingleRender().props;
      expect(forwarded.languageCode).toBe("de");
      expect(forwarded.ttc).toBe(props.ttc);
      expect(forwarded.currentElementId).toBe(SLIDER_ELEMENT_ID);
    });

    test.each(["ltr", "rtl", "auto"] as const)("forwards the %s text direction", (dir) => {
      render(<ElementConditional {...baseProps()} dir={dir} />);

      expect(getSingleRender().props.dir).toBe(dir);
    });

    test("forwards the centralized validation error message", () => {
      render(<ElementConditional {...baseProps()} errorMessage="Please enter a value in increments of 5" />);

      expect(getSingleRender().props.errorMessage).toBe("Please enter a value in increments of 5");
    });

    test("forwards an absent error message as undefined", () => {
      render(<ElementConditional {...baseProps()} />);

      expect(getSingleRender().props.errorMessage).toBeUndefined();
    });

    test("forwards exactly the props the slider case declares", () => {
      render(<ElementConditional {...baseProps()} errorMessage="Please pick a value" />);

      expect(Object.keys(getSingleRender().props).sort()).toEqual([...SLIDER_FORWARDED_PROPS].sort());
    });

    test.each(SLIDER_WITHHELD_PROPS)("withholds %s from the slider component", (propName) => {
      const props = baseProps();
      render(
        <ElementConditional {...props} formRef={vi.fn()} onTtcCollect={vi.fn()} onOpenExternalURL={vi.fn()} />
      );

      expect(Object.keys(getSingleRender().props)).not.toContain(propName);
    });
  });

  // -----------------------------------------------------------------------
  // Suite 4: The wrapped ttc setter
  //
  // The dispatcher does not hand its own `setTtc` to the element component; it hands a wrapper that also
  // reports the elapsed time synchronously through `onTtcCollect`, because the enclosing block cannot wait
  // for a state update before reading it. The slider is billed through that same wrapper as every other
  // element, and this suite proves it.
  // -----------------------------------------------------------------------

  describe("ttc collection", () => {
    /** The setter the dispatcher actually handed the slider component. */
    function getForwardedSetTtc(): (ttc: TResponseTtc) => void {
      return getSingleRender().props.setTtc as (ttc: TResponseTtc) => void;
    }

    test("hands the slider a wrapper rather than the caller's own setter", () => {
      const props = baseProps();
      render(<ElementConditional {...props} onTtcCollect={vi.fn()} />);

      expect(getForwardedSetTtc()).not.toBe(props.setTtc);
    });

    test("passes the reported ttc through to the caller's setter", () => {
      const props = baseProps();
      render(<ElementConditional {...props} onTtcCollect={vi.fn()} />);

      getForwardedSetTtc()({ [SLIDER_ELEMENT_ID]: 4321 });

      expect(props.setTtc).toHaveBeenCalledTimes(1);
      expect(props.setTtc).toHaveBeenCalledWith({ [SLIDER_ELEMENT_ID]: 4321 });
    });

    test("reports this element's ttc to the synchronous collector", () => {
      const onTtcCollect = vi.fn();
      render(<ElementConditional {...baseProps()} onTtcCollect={onTtcCollect} />);

      getForwardedSetTtc()({ [SLIDER_ELEMENT_ID]: 4321, "other-element": 99 });

      expect(onTtcCollect).toHaveBeenCalledTimes(1);
      expect(onTtcCollect).toHaveBeenCalledWith(SLIDER_ELEMENT_ID, 4321);
    });

    test("reports a ttc of zero, because zero is a measurement and not an absence", () => {
      const onTtcCollect = vi.fn();
      render(<ElementConditional {...baseProps()} onTtcCollect={onTtcCollect} />);

      getForwardedSetTtc()({ [SLIDER_ELEMENT_ID]: 0 });

      expect(onTtcCollect).toHaveBeenCalledWith(SLIDER_ELEMENT_ID, 0);
    });

    test("does not report when the update carries no entry for this element", () => {
      const props = baseProps();
      const onTtcCollect = vi.fn();
      render(<ElementConditional {...props} onTtcCollect={onTtcCollect} />);

      getForwardedSetTtc()({ "other-element": 99 });

      expect(props.setTtc).toHaveBeenCalledWith({ "other-element": 99 });
      expect(onTtcCollect).not.toHaveBeenCalled();
    });

    test("still updates the caller's setter when no collector was supplied", () => {
      const props = baseProps();
      render(<ElementConditional {...props} />);

      expect(() => getForwardedSetTtc()({ [SLIDER_ELEMENT_ID]: 4321 })).not.toThrow();
      expect(props.setTtc).toHaveBeenCalledWith({ [SLIDER_ELEMENT_ID]: 4321 });
    });
  });

  // -----------------------------------------------------------------------
  // Suite 5: Form exposure
  // -----------------------------------------------------------------------

  describe("form exposure", () => {
    test("exposes the slider component's form to the caller and releases it on unmount", () => {
      const exposedForms: (HTMLFormElement | null)[] = [];
      const formRef = vi.fn((ref: HTMLFormElement | null) => {
        exposedForms.push(ref);
      });

      const { unmount } = render(<ElementConditional {...baseProps()} formRef={formRef} />);

      expect(exposedForms).toHaveLength(1);
      expect(exposedForms[0]?.getAttribute("data-testid")).toBe("stub-SliderElement");

      unmount();

      expect(exposedForms[exposedForms.length - 1]).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Suite 6: Dispatch coverage
  // -----------------------------------------------------------------------

  describe("dispatch coverage", () => {
    test("the dispatch table covers every member of the element type enum", () => {
      const enumValues = [...Object.values(TSurveyElementTypeEnum)].sort();

      expect(enumValues).toHaveLength(18);
      expect(DISPATCH_TABLE.map((entry) => entry.type).sort()).toEqual(enumValues);
    });

    test.each(DISPATCH_TABLE)("routes $type to $component", ({ type, component }) => {
      render(
        <ElementConditional
          {...baseProps()}
          element={createElementOfType(type)}
          currentElementId={`element-${type}`}
        />
      );

      // An exact array rather than a `toContain`: it fails both when the case is missing - the dispatcher
      // silently returning null - and when a type is wired to the wrong component.
      expect(recordedRenders.map((entry) => entry.component)).toEqual([component]);
    });
  });

  // -----------------------------------------------------------------------
  // Suite 7: Unrecognized types
  //
  // A type outside the enum is the one unhandled case the dispatcher reports rather than swallows. Pinning
  // that here keeps the two failure modes distinguishable: an unknown type warns, whereas a known type
  // whose case went missing is silent - which is exactly why the coverage table above exists.
  // -----------------------------------------------------------------------

  describe("unrecognized element types", () => {
    test("renders nothing and warns for a type outside the enum", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const unknownType = "notAnElementType" as TSurveyElementTypeEnum;

      const { container } = render(
        <ElementConditional
          {...baseProps()}
          element={createElementOfType(unknownType)}
          currentElementId={`element-${unknownType}`}
        />
      );

      expect(recordedRenders).toHaveLength(0);
      expect(container.querySelector("form")).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("notAnElementType");
      expect(warnSpy.mock.calls[0][0]).toContain("element-notAnElementType");

      warnSpy.mockRestore();
    });

    test("does not warn for the slider, which the enum recognizes", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      render(<ElementConditional {...baseProps()} />);

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });
});
