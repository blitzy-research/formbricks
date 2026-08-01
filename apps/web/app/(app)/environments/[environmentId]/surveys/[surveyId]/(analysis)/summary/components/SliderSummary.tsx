"use client";

import { InboxIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TSurvey, TSurveyElementSummarySlider } from "@formbricks/types/surveys/types";
import { EmptyState } from "@/modules/ui/components/empty-state";
import { ProgressBar } from "@/modules/ui/components/progress-bar";
import { ElementSummaryHeader } from "./ElementSummaryHeader";

interface SliderSummaryProps {
  /** Aggregated Slider results: response count, average of the submitted values and dismissal count. */
  elementSummary: TSurveyElementSummarySlider;
  /** Parent survey, consumed by the shared header to resolve recall references inside the headline. */
  survey: TSurvey;
}

/**
 * Minimal numeric summary card for a Slider element.
 *
 * Renders the shared element header (icon, label and count chips), the average of every submitted
 * value, the number of dismissals, and a progress indicator showing where that average sits inside
 * the range the author configured.
 *
 * Per-value distributions, histograms, medians and percentiles are deliberately absent: a continuous
 * range has no natural buckets, so any bucketing policy would have to be invented here rather than
 * derived from the element's own configuration.
 */
export const SliderSummary = ({ elementSummary, survey }: SliderSummaryProps) => {
  const { t } = useTranslation();

  // The bounds are intrinsic to the element definition, so they are read from the element itself
  // rather than from the aggregated summary, which carries no min/max of its own.
  const { min, max } = elementSummary.element.range;
  const span = max - min;
  // Guarding the denominator up front is required rather than merely defensive. `ProgressBar` clamps
  // its `progress` prop into [0, 1] but cannot rescue `NaN` (`Math.floor(NaN)` is `NaN`), so a legacy
  // or hand-crafted survey whose bounds collapsed to `min === max` would divide zero by zero and
  // render `width: "NaN%"`. Measuring from `min` - not from zero - keeps offset ranges correct: an
  // average of 30 across a 10..50 range is half way along the bar, not three fifths.
  const normalized = span > 0 ? (elementSummary.average - min) / span : 0;

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
                {elementSummary.average.toFixed(2)}
              </p>
            </div>
            <ProgressBar barColor="bg-brand-dark" progress={normalized} />
            {/* The configured bounds are rendered as bare numbers so the bar's fill is legible as a
                position within the range rather than as a bare percentage. */}
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
