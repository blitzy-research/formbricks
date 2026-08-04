import { useEffect, useRef, useState } from "preact/hooks";
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
 * The control reports a value once an interaction settles rather than once per movement, so each report is
 * one answer: the response record is written once and one segment of time to completion is billed. The
 * instant that segment starts is held in a ref rather than in state, for two reasons. `getUpdatedTtc` ADDS
 * the duration it is handed, so a second interaction billed from the element's mount time would re-charge
 * time the first one already paid for; advancing the ref makes each interaction pay only for itself. And
 * writing it as state would re-run `useTtc`'s `visibilitychange` registration on every answer, replacing a
 * listener that has not changed. The ref still follows the mount and tab-visible resets `useTtc` performs
 * through `startTime`, so the two never diverge.
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

  // The instant this element's unbilled segment began. `useTtc` owns `startTime` - it sets it on mount and
  // again whenever the tab becomes visible - so following it here is what keeps the ref authoritative
  // without this component ever writing to it.
  const segmentStartRef = useRef(startTime);
  useEffect(() => {
    segmentStartRef.current = startTime;
  }, [startTime]);

  /** Closes the current segment, bills it to this element, and opens the next from the same reading. */
  const billElapsedTime = () => {
    const now = performance.now();
    setTtc(getUpdatedTtc(ttc, element.id, now - segmentStartRef.current));
    segmentStartRef.current = now;
  };

  const handleChange = (sliderValue: number) => {
    onChange({ [element.id]: sliderValue });
    billElapsedTime();
  };

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    // Update TTC when form is submitted (for TTC collection)
    billElapsedTime();
  };

  return (
    <form key={element.id} onSubmit={handleSubmit} className="w-full">
      <Slider
        elementId={element.id}
        // Distinct from the element id, which the control puts on its own wrapper: the header's label and
        // the value readout both point at this id, and a duplicate would bind them to the wrapper instead,
        // leaving the control with no accessible name.
        inputId={`${element.id}-input`}
        headline={getLocalizedValue(element.headline, languageCode)}
        description={element.subheader ? getLocalizedValue(element.subheader, languageCode) : undefined}
        min={element.range.min}
        max={element.range.max}
        step={element.step}
        value={value}
        onChange={handleChange}
        lowerLabel={element.lowerLabel ? getLocalizedValue(element.lowerLabel, languageCode) : undefined}
        upperLabel={element.upperLabel ? getLocalizedValue(element.upperLabel, languageCode) : undefined}
        showValue={element.showValue}
        required={isRequired}
        requiredLabel={t("common.required")}
        dir={dir}
        imageUrl={element.imageUrl}
        videoUrl={element.videoUrl}
        errorMessage={errorMessage}
      />
    </form>
  );
}
