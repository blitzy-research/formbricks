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

type TSliderNumericField = "min" | "max" | "step";

/**
 * What the author is currently typing into each numeric field, keyed by field.
 *
 * A field is absent from this map whenever it is not being edited, which is what makes the element the
 * default source of truth: an entry exists only between the first keystroke and the blur that ends it.
 */
type TSliderNumericDrafts = Partial<Record<TSliderNumericField, string>>;

/**
 * Reads a numeric editor field, returning the value only when the WHOLE field is a finite number.
 *
 * The conversion is applied to the entire trimmed field rather than scanned from its start, because a
 * scanning parse (`Number.parseFloat`) stops at the first character it cannot use and keeps what came before
 * it: "1e" becomes 1 and "12abc" becomes 12, writing a number the author never typed. An empty or blank field
 * is declined explicitly, since converting it would yield `0` and silently rewrite a cleared bound to zero.
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

/**
 * Builds the update payload for one numeric field, or `null` when the field cannot be written.
 *
 * The two bounds are merged into the element's existing `range` rather than replacing it, so editing the
 * minimum cannot drop the maximum - a payload of `{ range: { min } }` satisfies
 * `Partial<TSurveySliderElement>` and would silently leave the element with no upper bound at all. The step
 * is written as a bare `step`, never folded into `range`. The element's own range object is never mutated.
 *
 * Ordering is deliberately not checked here: a minimum above the maximum is a lawful intermediate state
 * while the author edits the pair, and the element schema is the layer that reports it.
 */
const buildNumericUpdate = (
  field: TSliderNumericField,
  rawValue: string,
  element: TSurveySliderElement
): Partial<TSurveySliderElement> | null => {
  const parsed = readFiniteNumber(rawValue);
  if (parsed === null) {
    return null;
  }

  if (field === "step") {
    return { step: parsed };
  }

  return { range: { ...element.range, [field]: parsed } };
};

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

  // Element-scoped DOM ids, so several slider cards can be open at once without any of them colliding: a
  // document-wide id such as "rangeMin" would repeat on every card, and the browser resolves a duplicate id
  // to the FIRST match, so a later card's label would focus the first card's input.
  const rangeMinId = `${element.id}-range-min`;
  const rangeMaxId = `${element.id}-range-max`;
  const stepId = `${element.id}-step`;
  const showValueId = `showValue-${element.id}`;

  // What is currently being typed, for the fields being typed into. Local state is what makes an entry that
  // is not yet a number survive on screen: a `type="number"` field reports an incomplete entry - a lone "-",
  // a cleared field, a half-written exponent - as an empty string, and a field rendered straight from the
  // element would then be handed back the stored number by React's controlled-input restoration on the very
  // next keystroke. That rewrite is what makes a negative bound unauthorable and a field impossible to clear
  // before retyping, since the author never gets past the first character. Mirroring what the field reports
  // keeps the rendered value equal to the DOM's own, so the characters stay put until the entry is finished.
  const [numericDrafts, setNumericDrafts] = useState<TSliderNumericDrafts>({});

  // Every keystroke is held as a draft, and written through only once the whole field reads as a finite
  // number, so the element never receives `NaN` or a partially typed value and the live preview still follows
  // the author keystroke by keystroke rather than waiting for them to leave the field.
  const handleNumericChange = (field: TSliderNumericField, rawValue: string) => {
    setNumericDrafts((current) => ({ ...current, [field]: rawValue }));

    const update = buildNumericUpdate(field, rawValue, element);
    if (update === null) {
      return;
    }

    updateElement(elementIdx, update);
  };

  // Ending the entry hands the field back to the element: a completed entry re-renders as the number that was
  // stored - normalised, so "1e3" reads back as 1000 - and an entry that never became a number reverts to the
  // value the element still holds rather than leaving the author looking at an empty box.
  const handleNumericBlur = (field: TSliderNumericField) => {
    setNumericDrafts((current) => {
      if (current[field] === undefined) {
        return current;
      }

      const { [field]: _finishedEntry, ...remaining } = current;
      return remaining;
    });
  };

  const numericFieldValue = (field: TSliderNumericField, storedValue: number): string | number =>
    numericDrafts[field] ?? storedValue;

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
              // Created across every language the survey declares, so the editor's own
              // translation-completeness check has the keys it needs from the moment the field appears.
              updateElement(elementIdx, { subheader: createI18nString("", surveyLanguageCodes) });
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
                value={numericFieldValue("min", element.range.min)}
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
                value={numericFieldValue("max", element.range.max)}
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
            value={numericFieldValue("step", element.step)}
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

      <AdvancedOptionToggle
        // `showValue` is optional and defaults to true, so only an explicit `false` turns the readout off.
        // Reading it as truthy would leave a slider whose author never touched the toggle with it hidden.
        isChecked={element.showValue !== false}
        onToggle={(checked: boolean) => {
          updateElement(elementIdx, {
            showValue: checked,
          });
        }}
        htmlId={showValueId}
        title={t("environments.surveys.edit.show_selected_value")}
        description={t("environments.surveys.edit.show_selected_value_description")}
        childBorder
        customContainerClass="p-0 mt-4"
      />
    </form>
  );
};
