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
 * one answer: the response record is written once and one segment of time to completion is billed.
 * `getUpdatedTtc` ADDS the duration it is handed, so every segment has to start where the previous one
 * ended - otherwise a second interaction billed from the element's mount time would re-charge time the first
 * one already paid for. `billElapsedTime` closes and reopens the segment in one clock reading, and advances
 * both records of where it begins: this component's own ref, which is read synchronously, and the
 * `startTime` state that `useTtc` bills from when the tab is hidden. Keeping those two in step is what stops
 * an answer and a subsequent tab switch from charging the same seconds twice.
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

  // The instant this element's unbilled segment began, held in a ref so that billing reads it
  // synchronously - a second answer in the same tick must not bill from a state value that has not been
  // applied yet. `useTtc` also resets `startTime` on mount and whenever the tab becomes visible, so the ref
  // follows it.
  const segmentStartRef = useRef(startTime);
  useEffect(() => {
    segmentStartRef.current = startTime;
  }, [startTime]);

  /**
   * Closes the current segment, bills it to this element, and opens the next from the same reading.
   *
   * Both records of where the segment starts are advanced, because both are read. This component bills from
   * the ref; `useTtc` bills the same segment from `startTime` when the tab is hidden. Advancing only the ref
   * would leave the hook measuring from the mount, so a tab hidden after an answer would re-charge every
   * instant the answer had already paid for - an answer at five seconds followed by a hide at ten would
   * record fifteen.
   */
  const billElapsedTime = () => {
    const now = performance.now();
    setTtc(getUpdatedTtc(ttc, element.id, now - segmentStartRef.current));
    segmentStartRef.current = now;
    setStartTime(now);
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
