import { TSurveySliderElement } from "@formbricks/types/surveys/elements";
import { createI18nString } from "@/lib/i18n/utils";

/**
 * The logic behind the Slider element's editor panel, extracted so it can be executed directly.
 *
 * Every function here was previously inline in `slider-element-form.tsx`, where none of it was reachable from
 * a test: the panel exports only a component, so the numeric reader, the element-scoped DOM ids and the three
 * update payloads could only be re-implemented alongside the tests and asserted in duplicate. That form of
 * coverage passes whether or not the panel still calls the logic it stands for, which is precisely the gap it
 * appeared to close. The panel now imports these functions and holds no copy of them.
 *
 * The type system does not stand in for any of it. `updateElement` takes a `Partial<TSurveySliderElement>`, so
 * a payload that drops the sibling range bound - the mistake `buildSliderNumericUpdate` exists to prevent -
 * type-checks perfectly happily.
 */

/** The three numeric fields the panel writes. */
export type TSliderNumericField = "min" | "max" | "step";

/** The element-scoped DOM ids the panel renders, one per interactive field. */
export interface TSliderFieldIds {
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
export type TSliderNumericDrafts = Partial<Record<TSliderNumericField, string>>;

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
export const readFiniteNumber = (rawValue: string): number | null => {
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
export const getSliderFieldIds = (elementId: string): TSliderFieldIds => ({
  rangeMinId: `${elementId}-range-min`,
  rangeMaxId: `${elementId}-range-max`,
  stepId: `${elementId}-step`,
  showValueId: `showValue-${elementId}`,
});

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
export const buildSliderNumericUpdate = (
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
export const buildSliderDescriptionUpdate = (
  surveyLanguageCodes: string[]
): Partial<TSurveySliderElement> => ({
  subheader: createI18nString("", surveyLanguageCodes),
});

/**
 * Whether the selected value is shown to the respondent.
 *
 * `showValue` is optional and defaults to true, so only an explicit `false` turns the readout off. Reading it
 * as truthy would leave a slider whose author never touched the toggle with the readout hidden.
 */
export const isSliderValueShown = (element: TSurveySliderElement): boolean => element.showValue !== false;

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
export const recordSliderNumericDraft = (
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
export const clearSliderNumericDraft = (
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
export const getSliderNumericFieldText = (
  drafts: TSliderNumericDrafts,
  field: TSliderNumericField,
  storedValue: number
): string | number => drafts[field] ?? storedValue;
