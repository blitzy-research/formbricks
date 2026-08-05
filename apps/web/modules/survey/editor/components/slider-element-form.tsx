"use client";

import { useAutoAnimate } from "@formkit/auto-animate/react";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  TSurveySliderConfigurationIssueCode,
  TSurveySliderElement,
  parseSurveySliderConfiguration,
} from "@formbricks/types/surveys/elements";
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

/*
 * The panel's own logic lives here rather than in a sibling module: the Slider's change inventory admits this
 * file and no other under this directory. Every rule about what makes a configuration usable still comes from
 * `parseSurveySliderConfiguration`, so nothing below decides that question for itself.
 */

/** The three numeric fields the panel writes. */
type TSliderNumericField = "min" | "max" | "step";

/**
 * The element-scoped DOM ids the panel renders: one per interactive field, plus the group the two bounds form
 * and the caption that names it.
 */
interface TSliderFieldIds {
  rangeId: string;
  rangeLabelId: string;
  rangeMinId: string;
  rangeMaxId: string;
  stepId: string;
  showValueId: string;
}

/**
 * What the author is currently typing into each numeric field, keyed by field.
 *
 * A field is absent from this map whenever it is not being edited, which is what makes the element the default
 * source of truth: an entry exists only between the first keystroke and the blur that ends it.
 */
type TSliderNumericDrafts = Partial<Record<TSliderNumericField, string>>;

/**
 * Reads a numeric editor field, returning the value only when the WHOLE field is a finite number.
 *
 * The conversion is applied to the entire trimmed field rather than scanned from its start, because a scanning
 * parse (`Number.parseFloat`) stops at the first character it cannot use and keeps what came before it: "1e"
 * becomes 1 and "12abc" becomes 12, writing a number the author never typed. An empty or blank field is
 * declined explicitly, since converting it would yield `0` and silently rewrite a cleared bound to zero. A
 * decimal such as `0.5` and a complete exponent such as `1e3` are both whole numbers and are accepted;
 * `parseInt` would truncate the former to a non-positive step the schema rejects.
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
 * Derives the panel's DOM ids from the element's own id, so several Slider cards can be open at once.
 *
 * A survey may hold any number of sliders, and a document-wide id such as "rangeMin" would repeat on every
 * card: the browser resolves a duplicate id to the FIRST match, so a later card's label would focus - and a
 * screen reader would announce - the first card's input. `element.id` is unique per element within a survey.
 */
const getSliderFieldIds = (elementId: string): TSliderFieldIds => ({
  rangeId: `${elementId}-range`,
  rangeLabelId: `${elementId}-range-label`,
  rangeMinId: `${elementId}-range-min`,
  rangeMaxId: `${elementId}-range-max`,
  stepId: `${elementId}-step`,
  showValueId: `showValue-${elementId}`,
});

/**
 * The id of the message that reports what is wrong with one field, derived from that field's own id.
 *
 * The message has to carry an id at all so the input can point at it with `aria-describedby`: a red border is
 * the only signal a sighted author needs, and it is no signal whatsoever to a screen reader.
 */
const getSliderFieldErrorId = (fieldId: string): string => `${fieldId}-error`;

/**
 * What is wrong with the element's numeric configuration, addressed at the field the author has to correct.
 *
 * Each entry is the rule that was broken rather than a sentence, so the panel renders the mistake in the
 * author's own language while the decision about what counts as a mistake stays where it belongs - in
 * `parseSurveySliderConfiguration`, the same function the element schema refines against and the response
 * evaluator consults. Nothing here restates a rule, which is what keeps the editor from ever disagreeing with
 * the schema that refuses the save.
 *
 * `range` is the pair, not a third field: an inverted or unrepresentable range is a fact about the two bounds
 * together, so both of them are wrong and the reason is reported once beneath them rather than twice.
 */
interface TSliderConfigurationIssues {
  /** Broken by the minimum alone */
  min?: TSurveySliderConfigurationIssueCode;
  /** Broken by the maximum alone */
  max?: TSurveySliderConfigurationIssueCode;
  /** Broken by the two bounds together */
  range?: TSurveySliderConfigurationIssueCode;
  /** Broken by the step */
  step?: TSurveySliderConfigurationIssueCode;
}

/** No issue is recorded twice, so the first one reported for a field is the one the author is shown. */
const recordFirstIssue = (
  issues: TSliderConfigurationIssues,
  field: keyof TSliderConfigurationIssues,
  code: TSurveySliderConfigurationIssueCode
): void => {
  if (issues[field] === undefined) {
    issues[field] = code;
  }
};

/**
 * Sorts the configuration's issues onto the panel's fields.
 *
 * An element whose configuration is usable yields an empty object, which is what lets the panel treat "no
 * entry" as "nothing to say about this field" rather than having to know the rules itself.
 */
const getSliderConfigurationIssues = (element: TSurveySliderElement): TSliderConfigurationIssues => {
  const result = parseSurveySliderConfiguration(element);
  if (result.valid) {
    return {};
  }

  const issues: TSliderConfigurationIssues = {};
  for (const issue of result.issues) {
    switch (issue.code) {
      case "minimumNotANumber":
        recordFirstIssue(issues, "min", issue.code);
        break;
      case "maximumNotANumber":
        recordFirstIssue(issues, "max", issue.code);
        break;
      case "minimumNotBelowMaximum":
      case "rangeTooWide":
        recordFirstIssue(issues, "range", issue.code);
        break;
      case "stepNotPositive":
      case "stepWiderThanRange":
        recordFirstIssue(issues, "step", issue.code);
        break;
    }
  }

  return issues;
};

/** Whether a numeric field is carrying a mistake: its own, or - for a bound - one the pair shares. */
const isSliderFieldInvalid = (issues: TSliderConfigurationIssues, field: TSliderNumericField): boolean => {
  if (field === "step") {
    return issues.step !== undefined;
  }

  return issues[field] !== undefined || issues.range !== undefined;
};

/**
 * Builds the update payload for one numeric field, or `null` when the field cannot be written.
 *
 * The two bounds are merged into the element's existing `range` rather than replacing it, so editing the
 * minimum cannot drop the maximum - a payload of `{ range: { min } }` satisfies `Partial<TSurveySliderElement>`
 * and would silently leave the element with no upper bound at all. The step is written as a bare `step`,
 * never folded into `range`. The element's own range object is never mutated, only read.
 *
 * Ordering is deliberately not checked here: a minimum above the maximum is a lawful intermediate state while
 * the author edits the pair, and the element schema is the layer that reports it.
 */
const buildSliderNumericUpdate = (
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

/**
 * Builds the update payload that adds an empty, internationalized description to the element.
 *
 * Created across every language the survey declares, so the editor's own translation-completeness check has
 * the keys it needs from the moment the field appears.
 */
const buildSliderDescriptionUpdate = (surveyLanguageCodes: string[]): Partial<TSurveySliderElement> => ({
  subheader: createI18nString("", surveyLanguageCodes),
});

/**
 * Whether the selected value is shown to the respondent.
 *
 * `showValue` is optional and defaults to true, so only an explicit `false` turns the readout off. Reading it
 * as truthy would leave a slider whose author never touched the toggle with the readout hidden.
 */
const isSliderValueShown = (element: TSurveySliderElement): boolean => element.showValue !== false;

/**
 * Records what a numeric field is showing, without deciding whether it can be written.
 *
 * Every arbitrary bound the schema permits is reached by typing through entries that are not numbers yet: a
 * negative passes through "-", a decimal through "0.", an exponent through "1e" and "1e-". A `type="number"`
 * input reports each of those as an empty string, so a field rendered from the stored number alone has that
 * number put straight back on the first such keystroke - erasing the character just typed and leaving those
 * values unreachable from the keyboard. Keeping the entry as typed is what closes that gap; whether it is
 * written to the element is `buildSliderNumericUpdate`'s decision, taken from the same raw text.
 */
const recordSliderNumericDraft = (
  drafts: TSliderNumericDrafts,
  field: TSliderNumericField,
  rawValue: string
): TSliderNumericDrafts => ({ ...drafts, [field]: rawValue });

/**
 * Discards the entry for one field, handing that field back to the element.
 *
 * The same object is returned when there is nothing to discard, so a blur on a field never touched cannot
 * cause a re-render.
 */
const clearSliderNumericDraft = (
  drafts: TSliderNumericDrafts,
  field: TSliderNumericField
): TSliderNumericDrafts => {
  if (drafts[field] === undefined) {
    return drafts;
  }

  const { [field]: _finishedEntry, ...remaining } = drafts;
  return remaining;
};

/** The text a numeric field renders: what is being typed, or the number the element holds. */
const getSliderNumericFieldText = (
  drafts: TSliderNumericDrafts,
  field: TSliderNumericField,
  storedValue: number
): string | number => drafts[field] ?? storedValue;

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

  // Element-scoped DOM ids, so several slider cards can be open at once without any of them colliding.
  const { rangeId, rangeLabelId, rangeMinId, rangeMaxId, stepId, showValueId } = getSliderFieldIds(
    element.id
  );

  // What is wrong with the numeric configuration, addressed at the field the author has to correct.
  //
  // The survey schema refuses to save a slider whose range or step describes nothing selectable, and the save
  // path reports that refusal as a transient toast: correct, but it never says WHICH field is wrong, and it is
  // gone seconds later. Reading the same verdict here is what puts the reason next to the field, from the
  // keystroke that creates it rather than from a save attempt - and because the verdict comes from
  // `parseSurveySliderConfiguration`, the function the schema itself refines against, the panel cannot mark a
  // configuration the schema would accept, nor accept one the schema would refuse.
  const configurationIssues = getSliderConfigurationIssues(element);

  // Each key is named literally, which is what the translation scanner reads.
  const configurationMessages: Record<TSurveySliderConfigurationIssueCode, string> = {
    minimumNotANumber: t("environments.surveys.edit.slider_minimum_must_be_a_number"),
    maximumNotANumber: t("environments.surveys.edit.slider_maximum_must_be_a_number"),
    minimumNotBelowMaximum: t("environments.surveys.edit.slider_minimum_must_be_less_than_maximum"),
    rangeTooWide: t("environments.surveys.edit.slider_range_too_wide"),
    stepNotPositive: t("environments.surveys.edit.slider_step_must_be_greater_than_zero"),
    stepWiderThanRange: t("environments.surveys.edit.slider_step_cannot_exceed_range"),
  };

  const rangeErrorId = getSliderFieldErrorId(rangeId);

  /**
   * The message a numeric field points at, so a screen reader hears the reason the border turned red.
   *
   * A bound with no mistake of its own still points at the pair's message when the two bounds contradict each
   * other, because that message is the reason this field is marked.
   */
  const describedByFor = (field: TSliderNumericField, fieldId: string): string | undefined => {
    if (configurationIssues[field] !== undefined) {
      return getSliderFieldErrorId(fieldId);
    }
    if (field !== "step" && configurationIssues.range !== undefined) {
      return rangeErrorId;
    }
    return undefined;
  };

  /** One configuration mistake, rendered where the author can act on it. */
  const renderConfigurationMessage = (
    code: TSurveySliderConfigurationIssueCode | undefined,
    messageId: string
  ) =>
    code === undefined ? null : (
      <p className="mt-1 text-xs text-red-500" id={messageId}>
        {configurationMessages[code]}
      </p>
    );

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
  // the author keystroke by keystroke rather than waiting for them to leave the field. The write itself is
  // `buildSliderNumericUpdate`, which merges a bound into the element's existing range so editing one bound
  // cannot drop the other.
  const handleNumericChange = (field: TSliderNumericField, rawValue: string) => {
    setNumericDrafts((current) => recordSliderNumericDraft(current, field, rawValue));

    const update = buildSliderNumericUpdate(field, rawValue, element);
    if (update === null) {
      return;
    }

    updateElement(elementIdx, update);
  };

  // Ending the entry hands the field back to the element: a completed entry re-renders as the number that was
  // stored - normalised, so "1e3" reads back as 1000 - and an entry that never became a number reverts to the
  // value the element still holds rather than leaving the author looking at an empty box.
  const handleNumericBlur = (field: TSliderNumericField) => {
    setNumericDrafts((current) => clearSliderNumericDraft(current, field));
  };

  /** The text a numeric field renders: what is being typed, or the number the element holds. */
  const numericFieldValue = (field: TSliderNumericField, storedValue: number): string | number =>
    getSliderNumericFieldText(numericDrafts, field, storedValue);

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
              updateElement(elementIdx, buildSliderDescriptionUpdate(surveyLanguageCodes));
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
        {/* Caption for the pair of bounds. Rendered as a span through `asChild`, and bound to the group it
            names with `aria-labelledby`: a `<label>` here would have no control to label - the two bounds have
            their own - leaving a labelling element pointing at nothing. */}
        <Label asChild>
          <span id={rangeLabelId}>{t("environments.surveys.edit.range")}</span>
        </Label>
        <div
          id={rangeId}
          role="group"
          aria-labelledby={rangeLabelId}
          className="mt-3 flex justify-between gap-8">
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
                isInvalid={isSliderFieldInvalid(configurationIssues, "min")}
                aria-invalid={isSliderFieldInvalid(configurationIssues, "min") || undefined}
                aria-describedby={describedByFor("min", rangeMinId)}
              />
            </div>
            {renderConfigurationMessage(configurationIssues.min, getSliderFieldErrorId(rangeMinId))}
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
                isInvalid={isSliderFieldInvalid(configurationIssues, "max")}
                aria-invalid={isSliderFieldInvalid(configurationIssues, "max") || undefined}
                aria-describedby={describedByFor("max", rangeMaxId)}
              />
            </div>
            {renderConfigurationMessage(configurationIssues.max, getSliderFieldErrorId(rangeMaxId))}
          </div>
        </div>
        {/* Reported once beneath the pair: an inverted or unrepresentable range is a fact about the two bounds
            together, so repeating it under each would state one mistake twice. */}
        {renderConfigurationMessage(configurationIssues.range, rangeErrorId)}
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
            isInvalid={isSliderFieldInvalid(configurationIssues, "step")}
            aria-invalid={isSliderFieldInvalid(configurationIssues, "step") || undefined}
            aria-describedby={describedByFor("step", stepId)}
          />
        </div>
        {renderConfigurationMessage(configurationIssues.step, getSliderFieldErrorId(stepId))}
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
        isChecked={isSliderValueShown(element)}
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
