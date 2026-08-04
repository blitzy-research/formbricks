"use client";

import { InboxIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TSurvey, TSurveyElementSummarySlider } from "@formbricks/types/surveys/types";
import { EmptyState } from "@/modules/ui/components/empty-state";
import { ProgressBar } from "@/modules/ui/components/progress-bar";
import { getSliderSummaryDisplay } from "../lib/sliderSummaryDisplay";
import { ElementSummaryHeader } from "./ElementSummaryHeader";

interface SliderSummaryProps {
  elementSummary: TSurveyElementSummarySlider;
  survey: TSurvey;
}

/**
 * Per-value distributions and percentiles are deliberately absent: a continuous range has no natural
 * buckets, so any bucketing policy would have to be invented here rather than derived from the
 * element's own configuration.
 *
 * The two decisions this card depends on - how the mean is printed, and where along the configured range it
 * sits - live in `../lib/sliderSummaryDisplay`, which is where they are also tested.
 */
export const SliderSummary = ({ elementSummary, survey }: SliderSummaryProps) => {
  const { t } = useTranslation();

  const { min, max } = elementSummary.element.range;
  const { averageText, normalized } = getSliderSummaryDisplay(elementSummary);
  const lowerLabel = elementSummary.element.lowerLabel?.default ?? "";
  const upperLabel = elementSummary.element.upperLabel?.default ?? "";

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
            {/* The value area grows with the figure instead of being fixed at the sibling cards' width: a mean
                on a wide range is longer than any of theirs, and a fixed width would push it out of the card.
                It keeps that width as a floor so an ordinary two-decimal mean still lines up with every other
                card, is capped so the label beside it can never be squeezed out, and breaks across lines
                rather than overflowing when a figure exceeds even that. */}
            <div className="text flex justify-between gap-4 px-2 pb-2">
              <p className="font-semibold text-slate-700">{t("environments.surveys.summary.average")}</p>
              <p className="flex min-w-[8rem] max-w-[60%] items-end justify-end break-all text-end text-slate-600">
                {averageText}
              </p>
            </div>
            <ProgressBar barColor="bg-brand-dark" progress={normalized} />
            <div className="mt-1 flex justify-between px-2 text-xs text-slate-500">
              <span>{min}</span>
              <span>{max}</span>
            </div>
            {/* Endpoint labels. Either one can stand alone, so the upper label pushes itself into the end slot
                with a logical inline-start margin rather than relying on `justify-between` having a sibling to
                push against - without it an upper label set on its own would sit under the minimum, naming the
                wrong end of the scale. Margin and alignment are both logical, so the label stays at the
                maximum when the reading direction flips. This is how the respondent-facing control lays the
                same pair out, so the summary reads as the question did. */}
            {(lowerLabel || upperLabel) && (
              <div className="mt-1 flex justify-between gap-4 px-2 text-xs text-slate-500">
                {lowerLabel ? <span className="max-w-[50%] break-words">{lowerLabel}</span> : null}
                {upperLabel ? (
                  <span className="ms-auto max-w-[50%] break-words text-end">{upperLabel}</span>
                ) : null}
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
