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
  // `min === max` would render `width: "NaN%"`. Measuring from `min` keeps offset ranges correct.
  const normalized = hasFiniteAverage && span > 0 ? (elementSummary.average - min) / span : 0;

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
                {hasFiniteAverage ? elementSummary.average.toFixed(2) : "-"}
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
