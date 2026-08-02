import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { TEnvironment } from "@formbricks/types/environment";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import type { TSurvey, TSurveySummary } from "@formbricks/types/surveys/types";
import type { TUserLocale } from "@formbricks/types/user";
import { SummaryList } from "./SummaryList";

/**
 * `SummaryList` dispatches each element summary to its own card through a chain of `if` statements that ends
 * in a bare `return null`. That terminator is silent: an element type with no branch produces no card, no
 * warning and no error, so the only way to know the Slider is wired in is to render a Slider summary and
 * watch which card comes back. This suite does exactly that, and pins the terminator's behaviour too, so the
 * two facts stay distinguishable.
 *
 * Every summary card is stubbed. They each own their internals, they are covered separately, and rendering
 * the real ones would make this suite a test of seventeen unrelated components. The stubs record the props
 * they were handed, which is what lets the dispatch assertions check the payload and not merely the routing.
 */

interface RecordedRender {
  component: string;
  props: Record<string, unknown>;
}

const recordedRenders: RecordedRender[] = [];
const setSelectedFilter = vi.fn();

/**
 * Builds a recording stub. Declared as a hoisted function so the `vi.mock` factories below - which vitest
 * lifts above the imports - can reference it safely; `recordedRenders` is only touched at render time, long
 * after this module's bindings are initialised.
 */
function summaryStub(component: string) {
  return function Stub(props: Record<string, unknown>) {
    recordedRenders.push({ component, props });
    return <div data-testid={`stub-${component}`} />;
  };
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-hot-toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/components/response-filter-context",
  () => ({
    useResponseFilter: () => ({
      setSelectedFilter,
      selectedFilter: { filter: [], responseStatus: "all" },
    }),
  })
);

vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/components/EmptyInAppSurveys",
  () => ({
    EmptyAppSurveys: () => <div data-testid="empty-app-surveys" />,
  })
);

vi.mock("@/modules/ui/components/skeleton-loader", () => ({
  SkeletonLoader: ({ type }: { type: string }) => <div data-testid="skeleton-loader" data-type={type} />,
}));

// The seventeen absolutely-imported cards, plus the one relative import. Specifiers must match the source
// exactly, so the mocks intercept the same module ids the component resolves.
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/CTASummary",
  () => ({ CTASummary: summaryStub("CTASummary") })
);
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/CalSummary",
  () => ({ CalSummary: summaryStub("CalSummary") })
);
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/ConsentSummary",
  () => ({ ConsentSummary: summaryStub("ConsentSummary") })
);
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/ContactInfoSummary",
  () => ({
    ContactInfoSummary: summaryStub("ContactInfoSummary"),
  })
);
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/DateElementSummary",
  () => ({
    DateElementSummary: summaryStub("DateElementSummary"),
  })
);
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/FileUploadSummary",
  () => ({
    FileUploadSummary: summaryStub("FileUploadSummary"),
  })
);
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/HiddenFieldsSummary",
  () => ({
    HiddenFieldsSummary: summaryStub("HiddenFieldsSummary"),
  })
);
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/MatrixElementSummary",
  () => ({
    MatrixElementSummary: summaryStub("MatrixElementSummary"),
  })
);
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/MultipleChoiceSummary",
  () => ({
    MultipleChoiceSummary: summaryStub("MultipleChoiceSummary"),
  })
);
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/NPSSummary",
  () => ({ NPSSummary: summaryStub("NPSSummary") })
);
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/OpenTextSummary",
  () => ({ OpenTextSummary: summaryStub("OpenTextSummary") })
);
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/OpinionScaleSummary",
  () => ({
    OpinionScaleSummary: summaryStub("OpinionScaleSummary"),
  })
);
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/PaymentSummary",
  () => ({ PaymentSummary: summaryStub("PaymentSummary") })
);
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/PictureChoiceSummary",
  () => ({
    PictureChoiceSummary: summaryStub("PictureChoiceSummary"),
  })
);
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/RankingSummary",
  () => ({ RankingSummary: summaryStub("RankingSummary") })
);
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/RatingSummary",
  () => ({ RatingSummary: summaryStub("RatingSummary") })
);
vi.mock(
  "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/components/SliderSummary",
  () => ({ SliderSummary: summaryStub("SliderSummary") })
);
vi.mock("./AddressSummary", () => ({ AddressSummary: summaryStub("AddressSummary") }));

const environment = { id: "env-1", appSetupCompleted: true } as unknown as TEnvironment;
const linkSurvey = { id: "survey-1", type: "link" } as unknown as TSurvey;
const locale: TUserLocale = "en-US";

type SummaryEntries = TSurveySummary["summary"];

/**
 * The summary array is a closed union of seventeen shapes; a card stub reads nothing off its payload, so the
 * fixtures carry only the fields the dispatcher itself touches - the discriminator and the element id it
 * keys on - and are cast in rather than fully populated.
 */
function sliderEntry(id = "slider-1"): SummaryEntries[number] {
  return {
    type: TSurveyElementTypeEnum.Slider,
    element: {
      id,
      type: TSurveyElementTypeEnum.Slider,
      headline: { default: "How satisfied are you?" },
      required: true,
      range: { min: 0, max: 100 },
      step: 5,
      showValue: true,
    },
    responseCount: 3,
    average: 50,
    dismissed: { count: 0 },
  } as unknown as SummaryEntries[number];
}

function entryOfType(type: TSurveyElementTypeEnum, id: string): SummaryEntries[number] {
  return {
    type,
    element: { id, type, headline: { default: `${type} element` }, required: false },
    responseCount: 1,
  } as unknown as SummaryEntries[number];
}

function renderList(summary: SummaryEntries, overrides: Partial<Parameters<typeof SummaryList>[0]> = {}) {
  return render(
    <SummaryList
      summary={summary}
      responseCount={overrides.responseCount ?? 3}
      environment={overrides.environment ?? environment}
      survey={overrides.survey ?? linkSurvey}
      locale={overrides.locale ?? locale}
    />
  );
}

/** Every stub that actually rendered, in render order. */
function renderedComponents(): string[] {
  return recordedRenders.map((entry) => entry.component);
}

describe("SummaryList", () => {
  beforeEach(() => {
    recordedRenders.length = 0;
    setSelectedFilter.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  describe("slider dispatch", () => {
    test("routes a slider summary to the slider card", () => {
      renderList([sliderEntry()]);

      expect(screen.getByTestId("stub-SliderSummary")).toBeInTheDocument();
    });

    test("routes a slider summary to nothing else", () => {
      renderList([sliderEntry()]);

      // The guard against a mis-typed branch: a slider that fell through into a neighbouring card would
      // still render *something*, and only an exact-match assertion catches that.
      expect(renderedComponents()).toEqual(["SliderSummary"]);
    });

    test("does not swallow the slider into the terminal null return", () => {
      const { container } = renderList([sliderEntry()]);

      expect(container.querySelector('[data-testid^="stub-"]')).not.toBeNull();
    });

    test("hands the slider card exactly the element summary and the survey", () => {
      const entry = sliderEntry();
      renderList([entry], { survey: linkSurvey });

      const record = recordedRenders.find((candidate) => candidate.component === "SliderSummary");
      if (!record) {
        throw new Error("the slider card did not render");
      }
      // `key` is consumed by React and never reaches props, so the prop set is exactly these two.
      expect(Object.keys(record.props).sort()).toEqual(["elementSummary", "survey"]);
      expect(record.props.elementSummary).toBe(entry);
      expect(record.props.survey).toBe(linkSurvey);
    });

    test("passes no filter setter to the slider card", () => {
      // Unlike the choice and scale cards, the slider is not filterable, and the branch reflects that.
      renderList([sliderEntry()]);

      const record = recordedRenders.find((candidate) => candidate.component === "SliderSummary");
      expect(record?.props.setFilter).toBeUndefined();
      expect(record?.props.environmentId).toBeUndefined();
      expect(record?.props.locale).toBeUndefined();
    });

    test("renders one card per slider element", () => {
      renderList([sliderEntry("slider-a"), sliderEntry("slider-b")]);

      // Keyed on the element id: two distinct sliders must not collapse into one card.
      expect(screen.getAllByTestId("stub-SliderSummary")).toHaveLength(2);
      expect(renderedComponents()).toEqual(["SliderSummary", "SliderSummary"]);
    });
  });

  describe("dispatch alongside other element types", () => {
    test("keeps each summary on its own card in a mixed list", () => {
      renderList([
        entryOfType(TSurveyElementTypeEnum.OpenText, "open-1"),
        sliderEntry(),
        entryOfType(TSurveyElementTypeEnum.Payment, "payment-1"),
      ]);

      expect(renderedComponents()).toEqual(["OpenTextSummary", "SliderSummary", "PaymentSummary"]);
    });

    test("preserves the order the summary was aggregated in", () => {
      renderList([
        sliderEntry("slider-a"),
        entryOfType(TSurveyElementTypeEnum.Rating, "rating-1"),
        sliderEntry("slider-b"),
      ]);

      expect(renderedComponents()).toEqual(["SliderSummary", "RatingSummary", "SliderSummary"]);
    });

    test("routes the neighbouring opinion scale to its own card, not the slider's", () => {
      // The two numeric scales are the pair most likely to be crossed over in the branch chain.
      renderList([entryOfType(TSurveyElementTypeEnum.OpinionScale, "opinion-1")]);

      expect(renderedComponents()).toEqual(["OpinionScaleSummary"]);
      expect(screen.queryByTestId("stub-SliderSummary")).not.toBeInTheDocument();
    });
  });

  describe("terminal null return", () => {
    test("renders no card for an element type with no branch", () => {
      const { container } = renderList([
        entryOfType("wheelOfFortune" as TSurveyElementTypeEnum, "unknown-1"),
      ]);

      expect(renderedComponents()).toEqual([]);
      expect(container.querySelector('[data-testid^="stub-"]')).toBeNull();
    });

    test("still renders the cards either side of an unbranched type", () => {
      renderList([
        sliderEntry("slider-a"),
        entryOfType("wheelOfFortune" as TSurveyElementTypeEnum, "unknown-1"),
        sliderEntry("slider-b"),
      ]);

      expect(renderedComponents()).toEqual(["SliderSummary", "SliderSummary"]);
    });
  });

  describe("gating before any card renders", () => {
    test("shows the app-setup prompt instead of cards for an unconfigured app survey", () => {
      renderList([sliderEntry()], {
        responseCount: 0,
        survey: { id: "survey-1", type: "app" } as unknown as TSurvey,
        environment: { id: "env-1", appSetupCompleted: false } as unknown as TEnvironment,
      });

      expect(screen.getByTestId("empty-app-surveys")).toBeInTheDocument();
      expect(screen.queryByTestId("stub-SliderSummary")).not.toBeInTheDocument();
    });

    test("shows the skeleton loader while the summary is still empty", () => {
      renderList([], { responseCount: 3 });

      expect(screen.getByTestId("skeleton-loader")).toHaveAttribute("data-type", "summary");
      expect(renderedComponents()).toEqual([]);
    });

    test("shows the no-responses message when nothing has been submitted", () => {
      renderList([sliderEntry()], { responseCount: 0 });

      expect(screen.getByText("environments.surveys.summary.no_responses_found")).toBeInTheDocument();
      expect(screen.queryByTestId("stub-SliderSummary")).not.toBeInTheDocument();
    });

    test("renders the slider card once responses exist", () => {
      renderList([sliderEntry()], { responseCount: 1 });

      expect(screen.getByTestId("stub-SliderSummary")).toBeInTheDocument();
    });

    test("renders the slider card when the response count is not yet known", () => {
      // A null count means "still loading the count", not "zero responses", so cards must not be withheld.
      renderList([sliderEntry()], { responseCount: null });

      expect(screen.getByTestId("stub-SliderSummary")).toBeInTheDocument();
    });
  });
});
