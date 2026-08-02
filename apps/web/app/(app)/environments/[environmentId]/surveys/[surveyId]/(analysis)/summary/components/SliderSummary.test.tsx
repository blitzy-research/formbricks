import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import type { TSurvey, TSurveyElementSummarySlider } from "@formbricks/types/surveys/types";
import { SliderSummary } from "./SliderSummary";

/**
 * The Slider summary card turns an aggregate into a position on a bar, and every interesting part of that
 * is arithmetic the aggregator cannot check for it: the average must be placed relative to the element's
 * own configured minimum rather than to zero, a range that collapsed to a single point must not produce a
 * `NaN` width, and a non-finite average must fall back to a dash rather than print `Infinity`. None of that
 * is reachable except by rendering, which is why this suite renders.
 *
 * `ProgressBar` and `EmptyState` are left real: the bar's computed width is the assertion that proves the
 * normalization, and reading it through the real component also proves the two clamp together as intended.
 * Only `ElementSummaryHeader` is stubbed, because it resolves the element registry and the survey's recall
 * substitutions - concerns of its own, covered elsewhere - while this card only needs to know that it
 * forwards the right props and chips to it.
 */

// react-i18next is not mocked globally in this app's vitest setup, so keys are echoed locally and assert as
// literal strings in the DOM.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("./ElementSummaryHeader", () => ({
  ElementSummaryHeader: ({
    showResponses,
    additionalInfo,
  }: {
    showResponses?: boolean;
    additionalInfo?: React.ReactNode;
  }) => (
    <div data-testid="element-summary-header">
      {/* Stringified, because `false` is the meaningful value here and conditional rendering would erase it. */}
      <span data-testid="header-show-responses">{String(showResponses)}</span>
      <div data-testid="header-additional-info">{additionalInfo}</div>
    </div>
  ),
}));

const survey = { id: "clrqm2x820000v9jz9iqp5o5c" } as unknown as TSurvey;

interface SummaryOverrides {
  responseCount?: number;
  average?: number;
  dismissedCount?: number;
  range?: { min: number; max: number };
  step?: number;
  lowerLabel?: { default: string };
  upperLabel?: { default: string };
}

function createSliderSummary(overrides: SummaryOverrides = {}): TSurveyElementSummarySlider {
  const {
    responseCount = 4,
    average = 50,
    dismissedCount = 0,
    range = { min: 0, max: 100 },
    step = 5,
  } = overrides;

  // Both labels are optional on the element, so an explicitly passed `undefined` has to mean "unset" here.
  // A destructuring default would substitute the fallback for it and quietly render the labels anyway, which
  // would make the "omits the label row" cases pass against a card that never omitted anything.
  const lowerLabel = "lowerLabel" in overrides ? overrides.lowerLabel : { default: "Not satisfied" };
  const upperLabel = "upperLabel" in overrides ? overrides.upperLabel : { default: "Very satisfied" };

  return {
    type: TSurveyElementTypeEnum.Slider,
    element: {
      id: "slider-1",
      type: TSurveyElementTypeEnum.Slider,
      headline: { default: "How satisfied are you?" },
      required: true,
      range,
      step,
      lowerLabel,
      upperLabel,
      showValue: true,
    },
    responseCount,
    average,
    dismissed: { count: dismissedCount },
  };
}

/** The width the real ProgressBar computed, read back off its inner bar. */
function getProgressWidth(container: HTMLElement): string | null {
  const bar = container.querySelector<HTMLElement>('div[style*="width"]');
  return bar ? bar.style.width : null;
}

/**
 * The average exactly as the card printed it, read from the average row itself.
 *
 * Searching the whole card by text is ambiguous once a range's own bounds are printed below the bar: a mean
 * sitting on the grid origin renders the same string as the lower bound, and a page-wide query would then
 * match two nodes and fail for a reason that has nothing to do with precision.
 */
function getAverageText(): string {
  const label = screen.getByText("environments.surveys.summary.average");
  const value = label.nextElementSibling;
  if (!value) {
    throw new Error("The average row rendered without a value beside its label.");
  }

  return value.textContent ?? "";
}

describe("SliderSummary", () => {
  afterEach(() => {
    cleanup();
  });

  describe("empty state", () => {
    test("shows the no-responses message when nothing has been submitted", () => {
      render(<SliderSummary elementSummary={createSliderSummary({ responseCount: 0 })} survey={survey} />);

      expect(screen.getByText("environments.surveys.summary.no_responses_found")).toBeInTheDocument();
    });

    test("shows no average and no bar when nothing has been submitted", () => {
      const { container } = render(
        <SliderSummary elementSummary={createSliderSummary({ responseCount: 0 })} survey={survey} />
      );

      expect(screen.queryByText("environments.surveys.summary.average")).not.toBeInTheDocument();
      expect(getProgressWidth(container)).toBeNull();
    });

    test("still reports the response count of zero in the header", () => {
      render(<SliderSummary elementSummary={createSliderSummary({ responseCount: 0 })} survey={survey} />);

      expect(screen.getByTestId("header-additional-info")).toHaveTextContent("0 common.responses");
    });

    test("leaves the empty state behind as soon as one response exists", () => {
      const { container } = render(
        <SliderSummary elementSummary={createSliderSummary({ responseCount: 1 })} survey={survey} />
      );

      expect(screen.queryByText("environments.surveys.summary.no_responses_found")).not.toBeInTheDocument();
      expect(screen.getByText("environments.surveys.summary.average")).toBeInTheDocument();
      expect(getProgressWidth(container)).not.toBeNull();
    });
  });

  describe("average display", () => {
    test("renders the average to two decimal places", () => {
      render(<SliderSummary elementSummary={createSliderSummary({ average: 42.5 })} survey={survey} />);

      expect(screen.getByText("42.50")).toBeInTheDocument();
    });

    test("renders a whole-number average with trailing zeros rather than bare", () => {
      render(<SliderSummary elementSummary={createSliderSummary({ average: 50 })} survey={survey} />);

      expect(screen.getByText("50.00")).toBeInTheDocument();
    });

    test("rounds rather than truncates a long average", () => {
      render(<SliderSummary elementSummary={createSliderSummary({ average: 33.336 })} survey={survey} />);

      expect(screen.getByText("33.34")).toBeInTheDocument();
    });

    test("renders an average of zero rather than treating it as missing", () => {
      render(
        <SliderSummary
          elementSummary={createSliderSummary({ average: 0, range: { min: 0, max: 100 } })}
          survey={survey}
        />
      );

      expect(screen.getByText("0.00")).toBeInTheDocument();
    });

    test("renders a negative average", () => {
      render(
        <SliderSummary
          elementSummary={createSliderSummary({ average: -12.5, range: { min: -50, max: 50 } })}
          survey={survey}
        />
      );

      expect(screen.getByText("-12.50")).toBeInTheDocument();
    });
  });

  /**
   * Every case above configures a whole-number grid, so all of them read the same two decimals every other
   * summary card in this folder shows. These cases vary the grid instead, because the displayed precision is
   * derived from it: the aggregator reports the mean at full double precision precisely so that the card can
   * decide here how much of it to show, and a range finer than 0.01 would otherwise be rounded away to
   * `0.00` before a reader ever saw it.
   *
   * The grid is both of the element's numbers, not just the step. Selectable values are `range.min +
   * n * step`, so an offset origin contributes decimals of its own and the cases below cover it in both
   * directions: an origin finer than the step, and a step finer than the origin.
   */
  describe("display precision derived from the configured grid", () => {
    test("shows a mean on a range finer than two decimals rather than rounding it to zero", () => {
      render(
        <SliderSummary
          elementSummary={createSliderSummary({
            average: 0.0005,
            range: { min: 0, max: 0.001 },
            step: 0.0001,
          })}
          survey={survey}
        />
      );

      expect(screen.getByText("0.0005")).toBeInTheDocument();
      expect(screen.queryByText("0.00")).not.toBeInTheDocument();
    });

    test("keeps two extra places for a mean landing between two fine grid points", () => {
      render(
        <SliderSummary
          elementSummary={createSliderSummary({
            // The mean the aggregator reports for the answers 0.0005 and 0.0006: a value between two grid
            // points, and one whose own decimal scale runs to 19 places. Shown to the step's four places
            // plus two, which is enough to distinguish it from either neighbouring grid point without
            // printing the artefacts of the division.
            average: 0.0005499999999999999,
            range: { min: 0, max: 0.001 },
            step: 0.0001,
          })}
          survey={survey}
        />
      );

      expect(screen.getByText("0.000550")).toBeInTheDocument();
    });

    test("caps a coarse step's mean at two decimals rather than printing the mean's own scale", () => {
      // 110 / 3 - the mean of an exact division, whose own decimal scale is 16 places.
      render(
        <SliderSummary
          elementSummary={createSliderSummary({ average: 36.666666666666664, step: 5 })}
          survey={survey}
        />
      );

      expect(screen.getByText("36.67")).toBeInTheDocument();
    });

    test("renders rather than crashing when the step is finer than the displayed precision can express", () => {
      // A lawful configuration: the element schema constrains the step's sign and its size against the span
      // but not its precision, while `toFixed` is specified only to 100 places. The card must clamp, not
      // throw.
      expect(() =>
        render(
          <SliderSummary
            elementSummary={createSliderSummary({
              average: 1e-300,
              range: { min: 0, max: 1e-298 },
              step: 1e-300,
            })}
            survey={survey}
          />
        )
      ).not.toThrow();

      expect(screen.getByText("environments.surveys.summary.average")).toBeInTheDocument();
    });

    test("renders rather than crashing when the grid origin is finer than the precision can express", () => {
      // The same clamp, reached through the origin instead of the step: a lawful range may begin at a value
      // needing 300 decimals while the step stays coarse, and `toFixed` is specified only to 100 places. The
      // origin alone is what admits any decimals here at all - this step's scale is zero.
      expect(() =>
        render(
          <SliderSummary
            elementSummary={createSliderSummary({
              average: 1e-300,
              range: { min: 1e-300, max: 100 },
              step: 5,
            })}
            survey={survey}
          />
        )
      ).not.toThrow();

      // Clamped to the hundred places `toFixed` allows rather than the three hundred the origin asks for.
      expect(getAverageText()).toBe((1e-300).toFixed(100));
    });

    test("keeps the digits an offset origin contributes when the step alone is whole", () => {
      // The grid of {min: 0.001, step: 5} is 0.001, 5.001, 10.001 - three decimals that come entirely from
      // the origin. A cap taken from the step alone allows two, so this mean would read `2.50` and lose the
      // only digits that place it between two grid points.
      render(
        <SliderSummary
          elementSummary={createSliderSummary({
            average: 2.501,
            range: { min: 0.001, max: 100.001 },
            step: 5,
          })}
          survey={survey}
        />
      );

      expect(getAverageText()).toBe("2.501");
    });

    test("keeps them when the aggregator's own mean carries a floating-point remainder", () => {
      // The same two answers as the case above, as the aggregation actually reports them. It folds responses
      // newest-first with an incremental mean, so 5.001 is seen before 0.001 and the result is the nearest
      // double to 2.501 rather than 2.501 itself. Its scale runs to 16 places, so the grid's cap decides:
      // three grid decimals plus two. What matters is that the third decimal - the digit the origin
      // contributes, and the one a step-derived cap would have rounded away to `2.50` - is still printed.
      render(
        <SliderSummary
          elementSummary={createSliderSummary({
            average: 2.5010000000000003,
            range: { min: 0.001, max: 100.001 },
            step: 5,
          })}
          survey={survey}
        />
      );

      expect(getAverageText()).toBe("2.50100");
    });

    test("does not print a mean sitting on an offset origin as zero", () => {
      // Every answer was the lowest selectable value. Rounded to the step's two places that reads `0.00`,
      // which is not a value this Slider can even take.
      render(
        <SliderSummary
          elementSummary={createSliderSummary({
            average: 0.001,
            range: { min: 0.001, max: 100.001 },
            step: 5,
          })}
          survey={survey}
        />
      );

      expect(getAverageText()).toBe("0.001");
    });

    test("still bounds an offset-grid mean two places past the grid", () => {
      // The mean of 0.001, 5.001 and 5.001: an exact division whose own scale runs to 16 places. Widening the
      // cap to admit the origin must not let those artefacts through - three grid decimals plus two.
      render(
        <SliderSummary
          elementSummary={createSliderSummary({
            average: 3.3343333333333334,
            range: { min: 0.001, max: 100.001 },
            step: 5,
          })}
          survey={survey}
        />
      );

      expect(getAverageText()).toBe("3.33433");
    });

    test("reads an origin finer than its own step at the origin's precision", () => {
      // {min: 0.005, step: 0.01} selects 0.005, 0.015, 0.025 - the origin is the finer of the two numbers, so
      // it is the one that decides how much of the mean is worth showing.
      render(
        <SliderSummary
          elementSummary={createSliderSummary({
            average: 0.015,
            range: { min: 0.005, max: 0.105 },
            step: 0.01,
          })}
          survey={survey}
        />
      );

      expect(getAverageText()).toBe("0.015");
    });

    test("leaves a whole-number grid at two decimals even when it is offset", () => {
      // An offset origin only widens the cap when it is itself fractional; {min: 10, step: 5} must read
      // exactly as every sibling card does.
      render(
        <SliderSummary
          elementSummary={createSliderSummary({
            average: 26,
            range: { min: 10, max: 50 },
            step: 5,
          })}
          survey={survey}
        />
      );

      expect(getAverageText()).toBe("26.00");
    });

    test("resolves the bar across a range finer than the displayed precision", () => {
      const { container } = render(
        <SliderSummary
          elementSummary={createSliderSummary({
            average: 0.0005,
            range: { min: 0, max: 0.001 },
            step: 0.0001,
          })}
          survey={survey}
        />
      );

      expect(getProgressWidth(container)).toBe("50%");
    });
  });

  describe("average position within the configured range", () => {
    const positions: {
      label: string;
      range: { min: number; max: number };
      average: number;
      width: string;
    }[] = [
      { label: "the midpoint of a zero-based range", range: { min: 0, max: 100 }, average: 50, width: "50%" },
      { label: "the minimum of a zero-based range", range: { min: 0, max: 100 }, average: 0, width: "0%" },
      {
        label: "the maximum of a zero-based range",
        range: { min: 0, max: 100 },
        average: 100,
        width: "100%",
      },
      // The case a naive `average / max` gets wrong: measured from the minimum, 20 sits a quarter of the
      // way along 10..50; measured from zero it would read as 40%.
      { label: "a quarter along an offset range", range: { min: 10, max: 50 }, average: 20, width: "25%" },
      { label: "the minimum of an offset range", range: { min: 10, max: 50 }, average: 10, width: "0%" },
      {
        label: "the midpoint of a range spanning zero",
        range: { min: -50, max: 50 },
        average: 0,
        width: "50%",
      },
      { label: "a fractional range", range: { min: 0, max: 1 }, average: 0.25, width: "25%" },
    ];

    test.each(positions)("places $label at $width", ({ range, average, width }) => {
      const { container } = render(
        <SliderSummary elementSummary={createSliderSummary({ range, average })} survey={survey} />
      );

      expect(getProgressWidth(container)).toBe(width);
    });

    test("clamps an average above the configured maximum to a full bar", () => {
      const { container } = render(
        <SliderSummary
          elementSummary={createSliderSummary({ range: { min: 0, max: 100 }, average: 150 })}
          survey={survey}
        />
      );

      expect(getProgressWidth(container)).toBe("100%");
    });

    test("clamps an average below the configured minimum to an empty bar", () => {
      const { container } = render(
        <SliderSummary
          elementSummary={createSliderSummary({ range: { min: 10, max: 50 }, average: 5 })}
          survey={survey}
        />
      );

      expect(getProgressWidth(container)).toBe("0%");
    });

    test("renders an empty bar rather than a NaN width when the bounds collapsed", () => {
      // The schema refuses to publish `min === max`, so this can only arrive from a summary read back from
      // an older cache. The bar clamps into [0, 1] but cannot rescue NaN, hence the span guard in the card.
      const { container } = render(
        <SliderSummary
          elementSummary={createSliderSummary({ range: { min: 25, max: 25 }, average: 25 })}
          survey={survey}
        />
      );

      expect(getProgressWidth(container)).toBe("0%");
      expect(container.innerHTML).not.toContain("NaN");
    });

    test("renders an empty bar rather than a NaN width when the bounds are inverted", () => {
      const { container } = render(
        <SliderSummary
          elementSummary={createSliderSummary({ range: { min: 100, max: 0 }, average: 50 })}
          survey={survey}
        />
      );

      expect(getProgressWidth(container)).toBe("0%");
      expect(container.innerHTML).not.toContain("NaN");
    });
  });

  describe("non-finite average fallback", () => {
    /**
     * The summary schema declares `average` as finite, so these values are off-contract by construction and
     * have to be cast in. The card guards them anyway, and that guard is what this suite pins: without it the
     * card would print the literal `Infinity` while the bar silently clamped itself to full.
     */
    function createSummaryWithAverage(average: number): TSurveyElementSummarySlider {
      return { ...createSliderSummary(), average } as TSurveyElementSummarySlider;
    }

    test.each([
      ["positive infinity", Number.POSITIVE_INFINITY],
      ["negative infinity", Number.NEGATIVE_INFINITY],
      ["NaN", Number.NaN],
    ] as [string, number][])("falls back to a dash for %s", (_label, average) => {
      render(<SliderSummary elementSummary={createSummaryWithAverage(average)} survey={survey} />);

      expect(screen.getByText("-")).toBeInTheDocument();
      expect(screen.queryByText("Infinity")).not.toBeInTheDocument();
      expect(screen.queryByText("NaN")).not.toBeInTheDocument();
    });

    test("renders an empty bar for a non-finite average", () => {
      const { container } = render(
        <SliderSummary elementSummary={createSummaryWithAverage(Number.POSITIVE_INFINITY)} survey={survey} />
      );

      expect(getProgressWidth(container)).toBe("0%");
    });
  });

  describe("range bounds and scale labels", () => {
    test("renders the configured minimum and maximum beneath the bar", () => {
      render(
        <SliderSummary
          elementSummary={createSliderSummary({ range: { min: 10, max: 50 } })}
          survey={survey}
        />
      );

      expect(screen.getByText("10")).toBeInTheDocument();
      expect(screen.getByText("50")).toBeInTheDocument();
    });

    test("renders negative bounds", () => {
      render(
        <SliderSummary
          elementSummary={createSliderSummary({ range: { min: -50, max: 50 }, average: 0 })}
          survey={survey}
        />
      );

      expect(screen.getByText("-50")).toBeInTheDocument();
    });

    test("renders both scale labels when the author set them", () => {
      render(<SliderSummary elementSummary={createSliderSummary()} survey={survey} />);

      expect(screen.getByText("Not satisfied")).toBeInTheDocument();
      expect(screen.getByText("Very satisfied")).toBeInTheDocument();
    });

    test("renders the label row when only the lower label was set", () => {
      const { container } = render(
        <SliderSummary
          elementSummary={createSliderSummary({ lowerLabel: { default: "Low" }, upperLabel: undefined })}
          survey={survey}
        />
      );

      expect(screen.getByText("Low")).toBeInTheDocument();
      expect(screen.queryByText("Very satisfied")).not.toBeInTheDocument();
      // Bounds row plus label row: the row survives a half-configured pair.
      expect(container.querySelectorAll("div.text-xs")).toHaveLength(2);
      // The missing half renders as an empty string, never as the word "undefined".
      expect(container.innerHTML).not.toContain("undefined");
    });

    test("renders the label row when only the upper label was set", () => {
      const { container } = render(
        <SliderSummary
          elementSummary={createSliderSummary({ lowerLabel: undefined, upperLabel: { default: "High" } })}
          survey={survey}
        />
      );

      expect(screen.getByText("High")).toBeInTheDocument();
      expect(screen.queryByText("Not satisfied")).not.toBeInTheDocument();
      expect(container.querySelectorAll("div.text-xs")).toHaveLength(2);
      expect(container.innerHTML).not.toContain("undefined");
    });

    test("omits the label row entirely when neither label was set", () => {
      const { container } = render(
        <SliderSummary
          elementSummary={createSliderSummary({ lowerLabel: undefined, upperLabel: undefined })}
          survey={survey}
        />
      );

      // The bounds row survives; only the labels row is dropped, so exactly one such row remains.
      const smallRows = container.querySelectorAll("div.text-xs");
      expect(smallRows).toHaveLength(1);
      expect(container.innerHTML).not.toContain("undefined");
    });
  });

  describe("header wiring", () => {
    test("suppresses the header's own response count", () => {
      // The card renders its own count chip, so leaving the header's on would show it twice.
      render(<SliderSummary elementSummary={createSliderSummary()} survey={survey} />);

      expect(screen.getByTestId("header-show-responses")).toHaveTextContent("false");
    });

    test("passes the response count to the header as additional info", () => {
      render(<SliderSummary elementSummary={createSliderSummary({ responseCount: 7 })} survey={survey} />);

      expect(screen.getByTestId("header-additional-info")).toHaveTextContent("7 common.responses");
    });

    test("adds a dismissed chip to the header only when something was dismissed", () => {
      render(<SliderSummary elementSummary={createSliderSummary({ dismissedCount: 3 })} survey={survey} />);

      expect(screen.getByTestId("header-additional-info")).toHaveTextContent("3 common.dismissed");
    });

    test("omits the dismissed chip when nothing was dismissed", () => {
      render(<SliderSummary elementSummary={createSliderSummary({ dismissedCount: 0 })} survey={survey} />);

      expect(screen.getByTestId("header-additional-info")).not.toHaveTextContent("common.dismissed");
    });
  });

  describe("dismissed footer", () => {
    test("is absent when nothing was dismissed", () => {
      render(<SliderSummary elementSummary={createSliderSummary({ dismissedCount: 0 })} survey={survey} />);

      expect(screen.queryByText("common.dismissed")).not.toBeInTheDocument();
    });

    test("reports a single dismissal in the singular", () => {
      render(<SliderSummary elementSummary={createSliderSummary({ dismissedCount: 1 })} survey={survey} />);

      expect(screen.getByText("common.dismissed")).toBeInTheDocument();
      expect(screen.getByText("1 common.response")).toBeInTheDocument();
    });

    test("reports several dismissals in the plural", () => {
      // The response count is deliberately different from the dismissed count, so that matching the plural
      // footer cannot accidentally match the header's own response chip instead.
      render(
        <SliderSummary
          elementSummary={createSliderSummary({ responseCount: 9, dismissedCount: 4 })}
          survey={survey}
        />
      );

      expect(screen.getByText("4 common.responses")).toBeInTheDocument();
      expect(screen.getByTestId("header-additional-info")).toHaveTextContent("9 common.responses");
    });

    test("appears even when no response was submitted at all", () => {
      render(
        <SliderSummary
          elementSummary={createSliderSummary({ responseCount: 0, dismissedCount: 2 })}
          survey={survey}
        />
      );

      expect(screen.getByText("environments.surveys.summary.no_responses_found")).toBeInTheDocument();
      expect(screen.getByText("common.dismissed")).toBeInTheDocument();
    });
  });

  describe("deliberate omissions", () => {
    test("renders no per-value distribution", () => {
      // Minimal numeric aggregation by design: a continuous range has no natural buckets, so a distribution
      // would require inventing a bucketing policy here. This assertion records that as intent.
      render(<SliderSummary elementSummary={createSliderSummary()} survey={survey} />);

      expect(screen.queryByText("environments.surveys.summary.aggregated")).not.toBeInTheDocument();
      expect(screen.queryByText("environments.surveys.summary.individual")).not.toBeInTheDocument();
    });
  });
});
