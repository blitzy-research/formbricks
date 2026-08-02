"use client";

import { InboxIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TSurvey, TSurveyElementSummarySlider } from "@formbricks/types/surveys/types";
import { EmptyState } from "@/modules/ui/components/empty-state";
import { ProgressBar } from "@/modules/ui/components/progress-bar";
import { ElementSummaryHeader } from "./ElementSummaryHeader";

interface SliderSummaryProps {
  elementSummary: TSurveyElementSummarySlider;
  survey: TSurvey;
}

// `toFixed` is specified for 0 to 100 fraction digits and throws a RangeError outside that, while either of
// the grid's own numbers may legitimately be far finer than that. Clamping here keeps a lawful configuration
// from crashing the card; a mean needing more than 100 places is displayed truncated rather than not at all.
const MAX_DISPLAY_DECIMALS = 100;

// A finite double always prints as [-]digits[.digits][e(+|-)digits] - "0.2", "1e-7", "1.5e+21" - so the
// fraction and the exponent are the two parts that decide how many decimal places it needs.
const DECIMAL_NOTATION_PATTERN = /^-?\d+(?:\.(?<fraction>\d+))?(?:e(?<exponent>[+-]\d+))?$/i;

/**
 * Number of decimal places needed to state `value` exactly, or null when it has none.
 *
 * Taken from the shortest decimal string that round-trips back to the same double - the decimal the survey
 * author typed, `0.2` rather than the binary fraction 0.200000000000000011102230246251565... A positive
 * exponent that outruns the fraction describes an integer such as 1.5e+21, which needs none.
 *
 * This is a presentation concern and lives with the presentation: it decides how precisely a mean is worth
 * printing, and nothing about whether an answer is valid.
 */
const getDecimalScale = (value: number): number | null => {
  if (!Number.isFinite(value)) {
    return null;
  }

  const match = DECIMAL_NOTATION_PATTERN.exec(String(value));
  if (!match) {
    return null;
  }

  const fraction = match.groups?.fraction ?? "";
  const exponent = match.groups?.exponent ?? "0";
  return Math.max(0, fraction.length - Number(exponent));
};

// Fewest decimals any average is shown with. Two is what every summary card in this folder uses, so a Slider
// on a whole-number grid - every preset and the overwhelming majority of real configurations - reads exactly
// as its siblings do.
const MIN_DISPLAY_DECIMALS = 2;

/**
 * Per-value distributions and percentiles are deliberately absent: a continuous range has no natural
 * buckets, so any bucketing policy would have to be invented here rather than derived from the
 * element's own configuration.
 */
export const SliderSummary = ({ elementSummary, survey }: SliderSummaryProps) => {
  const { t } = useTranslation();

  const { min, max } = elementSummary.element.range;
  const span = max - min;
  // The aggregation always emits a finite average, so this only guards a summary read back from an older
  // cache or assembled by hand; without it the card would print the literal `Infinity` while `ProgressBar`
  // silently clamped the bar to 100%. A non-finite average falls back to the dash this folder already uses
  // for unavailable figures (see SummaryMetadata).
  const hasFiniteAverage = Number.isFinite(elementSummary.average);
  // `ProgressBar` clamps its progress into [0, 1] but cannot rescue `NaN`, so bounds that collapsed to
  // `min === max` would render `width: "NaN%"`. Measuring from `min` keeps offset ranges correct. The
  // aggregation reports the mean unrounded, so the bar resolves the full configured range - on a {0, 0.001}
  // range a mean of 0.0005 sits at the halfway point rather than collapsing to the left edge.
  const normalized = hasFiniteAverage && span > 0 ? (elementSummary.average - min) / span : 0;

  // How many decimals the average is worth showing. Displaying a fixed two would round every mean on a range
  // finer than 0.01 away to `0.00`, and displaying the mean's own scale in full would print the 16-digit
  // artefacts of an exact division. So the mean's own scale is floored at the two decimals this folder
  // conventionally shows and capped just past the finest distinction the author asked for, with two extra
  // places to cover a mean landing between two grid points. An integer-stepped Slider anchored at an integer
  // therefore yields exactly two decimals, identical to every sibling card.
  //
  // That finest distinction is the grid, not the step alone. Selectable values are `range.min + n * step`, so
  // the origin contributes its own decimals: a {min: 0.001, step: 5} grid lands on 0.001, 5.001, 10.001, and
  // capping from the step alone would round a mean of 2.501 down to `2.50` - erasing the only digits that
  // distinguish it from the grid point below.
  const gridScale = Math.max(getDecimalScale(min) ?? 0, getDecimalScale(elementSummary.element.step) ?? 0);
  const averageScale = getDecimalScale(elementSummary.average) ?? MIN_DISPLAY_DECIMALS;
  const displayDecimals = Math.min(
    Math.max(averageScale, MIN_DISPLAY_DECIMALS),
    gridScale + MIN_DISPLAY_DECIMALS,
    MAX_DISPLAY_DECIMALS
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <ElementSummaryHeader
        survey={survey}
        elementSummary={elementSummary}
        showResponses={false}
        additionalInfo={
          <>
            <div className="flex items-center rounded-lg bg-slate-100 p-2">
              <InboxIcon className="mr-2 h-4 w-4" />
              {`${elementSummary.responseCount} ${t("common.responses")}`}
            </div>
            {elementSummary.dismissed.count > 0 && (
              <div className="flex items-center rounded-lg bg-slate-100 p-2">
                <InboxIcon className="mr-2 h-4 w-4" />
                {`${elementSummary.dismissed.count} ${t("common.dismissed")}`}
              </div>
            )}
          </>
        }
      />
      <div className="space-y-5 px-4 pb-6 pt-4 text-sm md:px-6 md:text-base">
        {elementSummary.responseCount === 0 ? (
          <EmptyState text={t("environments.surveys.summary.no_responses_found")} variant="simple" />
        ) : (
          <div>
            <div className="text flex justify-between px-2 pb-2">
              <p className="font-semibold text-slate-700">{t("environments.surveys.summary.average")}</p>
              <p className="flex w-32 items-end justify-end text-slate-600">
                {hasFiniteAverage ? elementSummary.average.toFixed(displayDecimals) : "-"}
              </p>
            </div>
            <ProgressBar barColor="bg-brand-dark" progress={normalized} />
            <div className="mt-1 flex justify-between px-2 text-xs text-slate-500">
              <span>{min}</span>
              <span>{max}</span>
            </div>
            {(elementSummary.element.lowerLabel || elementSummary.element.upperLabel) && (
              <div className="mt-1 flex justify-between px-2 text-xs text-slate-500">
                <span>{elementSummary.element.lowerLabel?.default ?? ""}</span>
                <span>{elementSummary.element.upperLabel?.default ?? ""}</span>
              </div>
            )}
          </div>
        )}
      </div>
      {elementSummary.dismissed.count > 0 && (
        <div className="rounded-b-lg border-t bg-white px-6 py-4">
          <div className="text flex justify-between px-2">
            <p className="font-semibold text-slate-700">{t("common.dismissed")}</p>
            <p className="flex w-32 items-end justify-end text-slate-600">
              {elementSummary.dismissed.count}{" "}
              {elementSummary.dismissed.count === 1 ? t("common.response") : t("common.responses")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
