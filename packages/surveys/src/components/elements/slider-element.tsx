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

/** Bounds and grid an element's own configuration resolves to, once it has been found usable. */
interface TSliderRenderConfig {
  min: number;
  max: number;
  step: number;
}

/**
 * Bounds and grid the control is given when the element's own cannot be trusted.
 *
 * These are the figures the editor's own preset starts an author from, so a slider still being configured
 * renders the way a new one does rather than as a broken control.
 */
const FALLBACK_CONFIG: TSliderRenderConfig = { min: 0, max: 100, step: 1 };

/**
 * The element's bounds and grid, or the fallback ones when they cannot be trusted.
 *
 * This is the same defensive read the shared response evaluator (`readSliderConfig` in
 * `@/lib/validation/evaluator`) performs before it derives a slider's validation rules, applied for the same
 * reason: the editor's draft autosave path persists a survey without parsing
 * `ZSurveySliderElement` - `ZSurveyDraft` accepts blocks as records of unknown - so a slider can reach the
 * renderer with `range` or `step` absent or non-numeric even though the compiled type declares them present,
 * and the editor's own preview renders exactly those drafts. Reading them unguarded would raise a TypeError
 * and blank the survey; the shared evaluator already answers such an element with a configuration error,
 * which reaches the respondent through `errorMessage` the moment an answer is submitted, so the renderer's
 * only job is to stay standing until it does.
 *
 * The trust test mirrors the evaluator's exactly - finite numbers, `min < max`, a positive step no wider than
 * the range - so the two layers agree on which configurations are usable.
 */
const readRenderConfig = (element: TSurveySliderElement): TSliderRenderConfig => {
  const { range, step } = element as { range?: unknown; step?: unknown };
  const bounds = (typeof range === "object" && range !== null ? range : {}) as {
    min?: unknown;
    max?: unknown;
  };

  if (
    typeof bounds.min !== "number" ||
    typeof bounds.max !== "number" ||
    typeof step !== "number" ||
    !Number.isFinite(bounds.min) ||
    !Number.isFinite(bounds.max) ||
    !Number.isFinite(step)
  ) {
    return FALLBACK_CONFIG;
  }

  const { min, max } = bounds as { min: number; max: number };
  if (min >= max || step <= 0 || step > max - min) {
    return FALLBACK_CONFIG;
  }

  return { min, max, step };
};

/**
 * Runtime wrapper for the slider element.
 *
 * The bounds and grid handed to the control are read through `readRenderConfig`, so an element whose
 * configuration cannot be trusted renders instead of throwing; the shared evaluator refuses its answers.
 *
 * A selection is emitted as a bare number keyed by the element id. `value` is forwarded exactly as it
 * arrives, never defaulted and never emitted on mount, so an untouched slider carries no value at all - a
 * slider answered with `0` would otherwise be indistinguishable from one that was skipped, which both the
 * required check and the summary's dismissed count depend on.
 *
 * Every value the control reports bills one segment of time to completion. `getUpdatedTtc` ADDS the duration
 * it is handed, so each segment has to start where the previous one ended - otherwise a later report billed
 * from the element's mount time would re-charge time an earlier one already paid for. `billElapsedTime`
 * closes and reopens the segment in one clock reading, and advances both records of where it begins: this
 * component's own ref, which is read synchronously, and the `startTime` state that `useTtc` bills from when
 * the tab is hidden. Keeping those two in step is what stops a report and a subsequent tab switch from
 * charging the same seconds twice.
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
  const { min, max, step } = readRenderConfig(element);
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
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        lowerLabel={element.lowerLabel ? getLocalizedValue(element.lowerLabel, languageCode) : undefined}
        upperLabel={element.upperLabel ? getLocalizedValue(element.upperLabel, languageCode) : undefined}
        showValue={element.showValue}
        required={isRequired}
        requiredLabel={t("common.required")}
        // Announced in place of the parked position while nothing has been answered, so that a screen-reader
        // user is told "unanswered" rather than the lower bound - the same distinction the unfilled handle
        // makes visually, and the one the required check depends on.
        unansweredLabel={t("common.no_value_selected")}
        dir={dir}
        imageUrl={element.imageUrl}
        videoUrl={element.videoUrl}
        errorMessage={errorMessage}
      />
    </form>
  );
}
