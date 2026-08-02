"use client";

import { useAutoAnimate } from "@formkit/auto-animate/react";
import { PlusIcon } from "lucide-react";
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
 * Reads a numeric editor field, returning the value only when the WHOLE field is a finite number.
 *
 * The conversion is applied to the entire trimmed field rather than scanned from its start, because a
 * scanning parse (`Number.parseFloat`) stops at the first character it cannot use and keeps what came
 * before it: "1e" becomes 1 and "12abc" becomes 12, writing a number the author never typed. An empty or
 * blank field is declined explicitly, since converting it would yield `0` and silently rewrite a cleared
 * bound to zero. A decimal such as `0.5` and a complete exponent such as `1e3` are both whole numbers and
 * are accepted; `parseInt` would truncate the former to a non-positive step the schema rejects.
 *
 * `null` tells the caller not to write, leaving the value already stored on the element in place.
 */
const readFiniteNumber = (rawValue: string): number | null => {
  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

/** The three numeric fields the panel writes. */
type NumericField = "min" | "max" | "step";

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

  // Writes a numeric field straight to the element, holding no copy of the field in the component: each
  // input renders the number the element itself stores and every keystroke that completes a number is
  // written back, which is the pattern the payment panel's amount field establishes. A keystroke that does
  // not complete a number is simply not written, so the element never receives `NaN` and the value already
  // stored stays in place - and nothing is lost on screen by declining it, because a `type="number"` field
  // reports an incomplete number as an empty string rather than as the characters typed so far.
  const handleNumericChange = (field: NumericField, rawValue: string) => {
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
                value={element.range.min}
                onChange={(e) => {
                  handleNumericChange("min", e.target.value);
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
                value={element.range.max}
                onChange={(e) => {
                  handleNumericChange("max", e.target.value);
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
            value={element.step}
            onChange={(e) => {
              handleNumericChange("step", e.target.value);
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
