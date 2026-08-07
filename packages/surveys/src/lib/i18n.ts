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
 * The code a survey uses for its own default language rather than for a named one.
 *
 * Every internationalized string in a survey keeps its default translation under the key `default`,
 * and the runtime carries that same code as the *selected language* whenever the respondent is
 * reading the survey in its default language - which is every single-language survey. It is not a
 * language: it is a pointer to whichever language the survey nominated as its default, resolved
 * elsewhere by `getI18nLanguage` against the survey's own language list.
 *
 * It has to be named here because `Intl.getCanonicalLocales("default")` returns `["default"]` - the
 * string is a structurally valid BCP-47 tag - so no structural check can distinguish it from a real
 * language code. Left unresolved it reaches i18next as a language with no resource bundle, and every
 * lookup silently answers in the fallback language.
 */
const DEFAULT_LANGUAGE_SENTINEL = "default";

/**
 * The language the survey is currently being presented in.
 *
 * `I18nProvider` sets the shared instance to `getI18nLanguage(selectedLanguage, surveyLanguages)` on
 * its first render and on every language change, so the instance is already the authority on which
 * language the respondent is reading - including the case this function exists for, where the
 * selected language is the default sentinel and the provider has resolved it to the survey's real
 * default code. Reading it back is what lets a validation message be produced in that language
 * without threading the survey's language list through the evaluator and all seven response routes
 * that share it.
 *
 * `resolvedLanguage` is preferred over `language` because it is the tag i18next actually matched to a
 * bundle: an instance set to `de-DE` resolves to `de`, which is the code that carries translations.
 *
 * On the server there is no provider, so the instance stays at the language `init` established and
 * the sentinel resolves to English - the same answer the previous implementation produced, and the
 * one the response routes already pass explicitly.
 */
const readPresentedLanguage = (): string => {
  const presented = i18n.resolvedLanguage ?? i18n.language;

  // A sentinel here would mean something outside this module set the instance to it, which would make
  // the resolution circular; anything unusable would defeat ICU formatting. Both take the fallback.
  if (
    typeof presented !== "string" ||
    presented === DEFAULT_LANGUAGE_SENTINEL ||
    !isFormattableLanguageTag(presented)
  ) {
    return FALLBACK_LANGUAGE;
  }

  return presented;
};

/**
 * Get translation function from surveys package's i18n instance
 * This ensures translations are always available, even when called from API routes
 *
 * The requested code is resolved before use so a malformed one - respondents can put an arbitrary
 * `language` on a submitted response - degrades to the fallback language instead of defeating ICU
 * interpolation and exposing raw `{placeholder}` text in a validation message. Every code that Intl
 * accepts is passed through untouched, so translation lookup and number formatting are unaffected
 * for every real language, including region variants and well-formed unknown tags.
 *
 * Two properties of this function are load-bearing and easy to lose.
 *
 * It resolves the default-language sentinel instead of forwarding it. The runtime passes the selected
 * language code, which is `default` for every survey presented in its own default language, so
 * forwarding it asks i18next for a language it has no bundle for and every message comes back in the
 * fallback language - a German survey telling a German respondent "Please fill out this field".
 *
 * It does NOT mutate the shared instance. `i18n` is a module singleton that `I18nProvider` owns and
 * that every translated component is subscribed to through `I18nextProvider`, so calling
 * `changeLanguage` here re-renders the entire survey - buttons, progress, language switch, every
 * built-in string - in whatever language this call happened to want. With the sentinel that language
 * was the fallback, so one failed validation reset a localized survey to English and left it there:
 * the provider only re-applies its own language when its `language` prop changes, which submitting a
 * response does not do. `getFixedT` binds the language to the returned translator instead, which is
 * all a caller needs and costs the instance nothing. On the server it additionally removes a shared
 * singleton being rewritten per request while other requests read it.
 */
export const getTranslations = (languageCode: string): TFunction => {
  const requestedLanguage =
    languageCode === DEFAULT_LANGUAGE_SENTINEL ? readPresentedLanguage() : languageCode;
  const resolvedLanguage = isFormattableLanguageTag(requestedLanguage)
    ? requestedLanguage
    : FALLBACK_LANGUAGE;

  return i18n.getFixedT(resolvedLanguage);
};
