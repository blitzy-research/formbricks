"use client";

import { useAutoAnimate } from "@formkit/auto-animate/react";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TSurveySliderElement } from "@formbricks/types/surveys/elements";
import { TSurvey } from "@formbricks/types/surveys/types";
import { TUserLocale } from "@formbricks/types/user";
import { createI18nString, extractLanguageCodes } from "@/lib/i18n/utils";
import { ElementFormInput } from "@/modules/survey/components/element-form-input";
import { AdvancedOptionToggle } from "@/modules/ui/components/advanced-option-toggle";
import { Button } from "@/modules/ui/components/button";
import { Input } from "@/modules/ui/components/input";
import { Label } from "@/modules/ui/components/label";

interface SliderElementFormProps {
  localSurvey: TSurvey;
  element: TSurveySliderElement;
  elementIdx: number;
  updateElement: (elementIdx: number, updatedAttributes: Partial<TSurveySliderElement>) => void;
  selectedLanguageCode: string;
  setSelectedLanguageCode: (language: string) => void;
  isInvalid: boolean;
  locale: TUserLocale;
  isStorageConfigured: boolean;
  isExternalUrlsAllowed?: boolean;
}

/**
 * Reads a numeric editor field, returning the value only when it parses to a finite number.
 *
 * `Number.parseFloat` is used rather than `Number` because `Number("")` is `0`, which would silently
 * rewrite a cleared field to zero, and rather than `parseInt` because the step may legitimately be a
 * decimal such as `0.5`. `null` tells the caller not to write, leaving the value already stored on the
 * element in place.
 */
const readFiniteNumber = (rawValue: string): number | null => {
  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
};

/** The three numeric fields, used to key the transient draft text held while one of them is being edited. */
type NumericDraftField = "min" | "max" | "step";

export const SliderElementForm = ({
  element,
  elementIdx,
  updateElement,
  isInvalid,
  localSurvey,
  selectedLanguageCode,
  setSelectedLanguageCode,
  locale,
  isStorageConfigured = true,
  isExternalUrlsAllowed,
}: SliderElementFormProps) => {
  const { t } = useTranslation();
  const surveyLanguageCodes = extractLanguageCodes(localSurvey.languages);
  const [parent] = useAutoAnimate();

  // DOM ids for the three numeric fields, scoped to the element so several slider cards can be open at
  // once. A survey may hold any number of sliders, and a document-wide id such as "rangeMin" would repeat
  // on every card: the browser resolves a duplicate id to the FIRST match, so a later card's label would
  // focus - and a screen reader would announce - the first card's input. `element.id` is unique per element
  // within a survey, which is why the show-value toggle below already scopes its own id the same way.
  const rangeMinId = `${element.id}-range-min`;
  const rangeMaxId = `${element.id}-range-max`;
  const stepId = `${element.id}-step`;

  // Transient draft text for the three numeric fields. A controlled numeric input whose `value` is read
  // straight from the element cannot hold text that is not yet a number: clearing the field, or typing the
  // leading "-" of a negative bound, parses to nothing, so nothing is written and React's
  // restore-controlled-state pass immediately reassigns the previous number, erasing the keystroke. Both
  // `-5` and `0.5` are schema-valid yet unreachable that way. Keeping the raw string here and echoing it
  // back means the rendered value already matches what the DOM reports, so React assigns nothing and the
  // browser keeps the intermediate text on screen.
  //
  // `null` means "no edit in progress, show the value stored on the element", which is what keeps the first
  // render identical to reading the element's own numbers directly.
  const [numericDrafts, setNumericDrafts] = useState<Record<NumericDraftField, string | null>>({
    min: null,
    max: null,
    step: null,
  });

  // Records the keystroke, then writes to the element only when it parses to a finite number. A draft that
  // does not parse - "", "-", "1e" - stays on screen and is simply not written, so the element never
  // receives `NaN` and the last good value remains in place.
  const handleNumericChange = (field: NumericDraftField, rawValue: string) => {
    setNumericDrafts((previous) => ({ ...previous, [field]: rawValue }));

    const parsed = readFiniteNumber(rawValue);
    if (parsed === null) {
      return;
    }

    if (field === "min") {
      updateElement(elementIdx, { range: { ...element.range, min: parsed } });
    } else if (field === "max") {
      updateElement(elementIdx, { range: { ...element.range, max: parsed } });
    } else {
      updateElement(elementIdx, { step: parsed });
    }
  };

  // Dropping the draft on blur both commits and reverts: a draft that parsed has already been written, so
  // the field simply re-renders the element's own value in canonical form, while a draft that never parsed
  // was never written, so the field falls back to the value still stored on the element.
  const handleNumericBlur = (field: NumericDraftField) => {
    setNumericDrafts((previous) => ({ ...previous, [field]: null }));
  };

  return (
    <form>
      {/* Headline input — required field for the slider question text */}
      <ElementFormInput
        id="headline"
        value={element.headline}
        label={t("environments.surveys.edit.question") + "*"}
        localSurvey={localSurvey}
        elementIdx={elementIdx}
        isInvalid={isInvalid}
        updateElement={updateElement}
        selectedLanguageCode={selectedLanguageCode}
        setSelectedLanguageCode={setSelectedLanguageCode}
        locale={locale}
        isStorageConfigured={isStorageConfigured}
        autoFocus={!element.headline?.default || element.headline.default.trim() === ""}
        isExternalUrlsAllowed={isExternalUrlsAllowed}
      />

      {/* Subheader / description — optional, toggled via "Add description" button */}
      <div ref={parent}>
        {element.subheader !== undefined && (
          <div className="inline-flex w-full items-center">
            <div className="w-full">
              <ElementFormInput
                id="subheader"
                value={element.subheader}
                label={t("common.description")}
                localSurvey={localSurvey}
                elementIdx={elementIdx}
                isInvalid={isInvalid}
                updateElement={updateElement}
                selectedLanguageCode={selectedLanguageCode}
                setSelectedLanguageCode={setSelectedLanguageCode}
                locale={locale}
                isStorageConfigured={isStorageConfigured}
                autoFocus={!element.subheader?.default || element.subheader.default.trim() === ""}
                isExternalUrlsAllowed={isExternalUrlsAllowed}
              />
            </div>
          </div>
        )}
        {element.subheader === undefined && (
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            type="button"
            onClick={() => {
              updateElement(elementIdx, {
                subheader: createI18nString("", surveyLanguageCodes),
              });
            }}>
            <PlusIcon className="mr-1 h-4 w-4" />
            {t("environments.surveys.edit.add_description")}
          </Button>
        )}
      </div>

      {/* Numeric range — the inclusive bounds a respondent can select between. `step="any"` is set on both
          bounds because the schema accepts any finite number, so a decimal bound must not be reported as a
          step mismatch by the browser. */}
      <div className="mt-3">
        <Label>{t("environments.surveys.edit.range")}</Label>
        <div className="mt-3 flex justify-between gap-8">
          {/* Minimum bound — merged into the existing range object so the maximum is preserved */}
          <div className="flex-1">
            <Label htmlFor={rangeMinId}>{t("environments.surveys.edit.minimum")}</Label>
            <div className="mt-2">
              <Input
                type="number"
                id={rangeMinId}
                value={numericDrafts.min ?? element.range.min}
                onChange={(e) => {
                  handleNumericChange("min", e.target.value);
                }}
                onBlur={() => {
                  handleNumericBlur("min");
                }}
                step="any"
              />
            </div>
          </div>

          {/* Maximum bound — merged into the existing range object so the minimum is preserved */}
          <div className="flex-1">
            <Label htmlFor={rangeMaxId}>{t("environments.surveys.edit.maximum")}</Label>
            <div className="mt-2">
              <Input
                type="number"
                id={rangeMaxId}
                value={numericDrafts.max ?? element.range.max}
                onChange={(e) => {
                  handleNumericChange("max", e.target.value);
                }}
                onBlur={() => {
                  handleNumericBlur("max");
                }}
                step="any"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Step increment — a free step attribute keeps decimal increments such as 0.5 typeable */}
      <div className="mt-3">
        <Label htmlFor={stepId}>{t("environments.surveys.edit.step")}</Label>
        <div className="mt-2">
          <Input
            type="number"
            id={stepId}
            value={numericDrafts.step ?? element.step}
            onChange={(e) => {
              handleNumericChange("step", e.target.value);
            }}
            onBlur={() => {
              handleNumericBlur("step");
            }}
            min={0}
            step="any"
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">{t("environments.surveys.edit.step_description")}</p>
      </div>

      {/* Lower and upper endpoint labels — side by side layout with i18n support */}
      <div className="flex justify-between gap-8">
        <div className="flex-1">
          <ElementFormInput
            id="lowerLabel"
            value={element.lowerLabel}
            label={t("environments.surveys.edit.lower_label")}
            localSurvey={localSurvey}
            elementIdx={elementIdx}
            isInvalid={isInvalid}
            updateElement={updateElement}
            selectedLanguageCode={selectedLanguageCode}
            setSelectedLanguageCode={setSelectedLanguageCode}
            locale={locale}
            isStorageConfigured={isStorageConfigured}
          />
        </div>
        <div className="flex-1">
          <ElementFormInput
            id="upperLabel"
            value={element.upperLabel}
            label={t("environments.surveys.edit.upper_label")}
            localSurvey={localSurvey}
            elementIdx={elementIdx}
            isInvalid={isInvalid}
            updateElement={updateElement}
            selectedLanguageCode={selectedLanguageCode}
            setSelectedLanguageCode={setSelectedLanguageCode}
            locale={locale}
            isStorageConfigured={isStorageConfigured}
          />
        </div>
      </div>

      {/* Show selected value toggle — enabled by default, so only an explicit false turns it off */}
      <AdvancedOptionToggle
        isChecked={element.showValue !== false}
        onToggle={(checked: boolean) => {
          updateElement(elementIdx, {
            showValue: checked,
          });
        }}
        htmlId={`showValue-${element.id}`}
        title={t("environments.surveys.edit.show_selected_value")}
        description={t("environments.surveys.edit.show_selected_value_description")}
        childBorder
        customContainerClass="p-0 mt-4"
      />
    </form>
  );
};
