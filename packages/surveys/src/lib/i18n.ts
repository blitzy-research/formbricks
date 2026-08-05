import type { TFunction } from "i18next";
import { TI18nString } from "@formbricks/types/i18n";
import i18n from "./i18n.config";

// Type guard to check if an object is an I18nString
const isI18nObject = (obj: any): obj is TI18nString => {
  return typeof obj === "object" && obj !== null && Object.keys(obj).includes("default");
};

// Matches \r\n, \n, \r, and their HTML entity variants
const ESCAPED_NEWLINES = /\\r\\n|&#13;&#10;|\\n|\\r|&#10;|&#13;/g;

export const unescapeNewlines = (s: string): string => s.replace(ESCAPED_NEWLINES, "\n");

export const getLocalizedValue = (
  value: TI18nString | undefined,
  languageId: string,
  replaceNewLines: boolean = false
): string => {
  if (!value) {
    return "";
  }

  let result = "";

  if (isI18nObject(value)) {
    if (typeof value[languageId] === "string") {
      result = value[languageId];
    } else {
      result = value.default;
    }

    result = replaceNewLines ? unescapeNewlines(result) : result;
  }

  return result;
};

/**
 * Whether a language code can be used to format an ICU message.
 *
 * The instance is configured with the ICU plugin, which builds an `IntlMessageFormat` from the
 * resolved language. That constructor rejects anything that is not a structurally valid BCP-47 tag,
 * and the plugin's default parse-error handler swallows the rejection and returns the *raw* message
 * pattern - so a code such as "e" or "en-" silently produces "...in increments of {step}" with the
 * placeholder intact instead of the interpolated value. `Intl.getCanonicalLocales` applies exactly
 * the same structural check, which makes it a faithful predicate for "will formatting succeed".
 *
 * Note this is deliberately a *structural* check, not a "do we ship this language" check: a
 * well-formed but unknown tag such as "zz" stays untouched so i18next can resolve it to the
 * fallback language on its own, exactly as it does today.
 *
 * @param languageCode - Candidate language code, from caller-supplied data and therefore untrusted
 * @returns true when the code is a non-empty string that Intl accepts as a language tag
 */
const isFormattableLanguageTag = (languageCode: string): boolean => {
  if (typeof languageCode !== "string" || languageCode.length === 0) {
    return false;
  }

  try {
    // Throws a RangeError for a structurally invalid tag; returns [] for non-string input, which the
    // guard above already excludes but which is cheap to keep honest here.
    return Intl.getCanonicalLocales(languageCode).length > 0;
  } catch {
    return false;
  }
};

/**
 * Language handed to i18next whenever the requested one cannot be used for message formatting.
 *
 * Derived from the instance's own `fallbackLng` rather than hard-coded so the two stay in lockstep:
 * i18next normalises the configured value into an array, so a bare string, an array and anything
 * unexpected are all reduced here to a single tag, with "en" as the last resort.
 */
const FALLBACK_LANGUAGE: string = ((): string => {
  const configured = i18n.options.fallbackLng;
  let candidate: unknown;

  if (typeof configured === "string") {
    candidate = configured;
  } else if (Array.isArray(configured)) {
    candidate = configured[0];
  }

  return typeof candidate === "string" && isFormattableLanguageTag(candidate) ? candidate : "en";
})();

/**
 * Get translation function from surveys package's i18n instance
 * This ensures translations are always available, even when called from API routes
 *
 * The requested code is resolved before use so a malformed one - respondents can put an arbitrary
 * `language` on a submitted response - degrades to the fallback language instead of defeating ICU
 * interpolation and exposing raw `{placeholder}` text in a validation message. Every code that Intl
 * accepts is passed through untouched, so translation lookup and number formatting are unaffected
 * for every real language, including region variants and well-formed unknown tags.
 */
export const getTranslations = (languageCode: string): TFunction => {
  const resolvedLanguage = isFormattableLanguageTag(languageCode) ? languageCode : FALLBACK_LANGUAGE;

  // Ensure the language is set (i18n.changeLanguage is synchronous when resources are already loaded).
  // Setting the resolved code also keeps the shared instance from retaining a malformed one.
  if (i18n.language !== resolvedLanguage) {
    i18n.changeLanguage(resolvedLanguage);
  }
  return i18n.getFixedT(resolvedLanguage);
};
