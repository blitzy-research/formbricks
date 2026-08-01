import { useState } from "preact/hooks";
import { useTranslation } from "react-i18next";
import { Slider } from "@formbricks/survey-ui";
import { type TResponseData, type TResponseTtc } from "@formbricks/types/responses";
import type { TSurveySliderElement } from "@formbricks/types/surveys/elements";
import { getLocalizedValue } from "@/lib/i18n";
import { getUpdatedTtc, useTtc } from "@/lib/ttc";

interface SliderElementProps {
  element: TSurveySliderElement;
  value?: number;
  onChange: (responseData: TResponseData) => void;
  languageCode: string;
  ttc: TResponseTtc;
  setTtc: (ttc: TResponseTtc) => void;
  currentElementId: string;
  dir?: "ltr" | "rtl" | "auto";
  errorMessage?: string;
}

/**
 * Runtime wrapper for the slider element.
 *
 * A selection is stored as a bare number. `value` is forwarded exactly as it arrives, never defaulted
 * and never emitted on mount, so an untouched slider keeps no value at all - a slider answered with `0`
 * would otherwise be indistinguishable from one that was skipped, which both the required check and the
 * summary's dismissed count depend on.
 *
 * Time to completion is accounted per completed interaction, not per value change: `getUpdatedTtc` ADDS
 * the duration it is handed, so charging the full elapsed time on every value a drag reports would bill
 * the same seconds repeatedly. `handleChange` therefore only writes the response, and `handleValueCommit`
 * closes one segment and opens the next when a drag or key press finishes.
 */
export function SliderElement({
  element,
  value,
  onChange,
  languageCode,
  ttc,
  setTtc,
  currentElementId,
  dir = "auto",
  errorMessage,
}: SliderElementProps) {
  const [startTime, setStartTime] = useState(performance.now());
  const isCurrent = element.id === currentElementId;
  const isRequired = element.required;
  const { t } = useTranslation();
  useTtc(element.id, ttc, setTtc, startTime, setStartTime, isCurrent);

  const handleChange = (sliderValue: number) => {
    onChange({ [element.id]: sliderValue });
  };

  const handleValueCommit = () => {
    // A single reading of the clock closes the finished segment and opens the next one, so the instant
    // between the two is neither billed twice nor lost.
    const now = performance.now();
    const updatedTtcObj = getUpdatedTtc(ttc, element.id, now - startTime);
    setTtc(updatedTtcObj);
    setStartTime(now);
  };

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    // Update TTC when form is submitted (for TTC collection)
    const updatedTtcObj = getUpdatedTtc(ttc, element.id, performance.now() - startTime);
    setTtc(updatedTtcObj);
  };

  return (
    <form key={element.id} onSubmit={handleSubmit} className="w-full">
      <Slider
        elementId={element.id}
        inputId={element.id}
        headline={getLocalizedValue(element.headline, languageCode)}
        description={element.subheader ? getLocalizedValue(element.subheader, languageCode) : undefined}
        min={element.range.min}
        max={element.range.max}
        step={element.step}
        value={value}
        onChange={handleChange}
        onValueCommit={handleValueCommit}
        lowerLabel={element.lowerLabel ? getLocalizedValue(element.lowerLabel, languageCode) : undefined}
        upperLabel={element.upperLabel ? getLocalizedValue(element.upperLabel, languageCode) : undefined}
        showValue={element.showValue}
        required={isRequired}
        requiredLabel={t("common.required")}
        unansweredLabel={t("common.no_value_selected")}
        dir={dir}
        imageUrl={element.imageUrl}
        videoUrl={element.videoUrl}
        errorMessage={errorMessage}
      />
    </form>
  );
}
