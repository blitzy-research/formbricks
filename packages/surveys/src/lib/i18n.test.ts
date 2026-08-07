import { afterEach, describe, expect, test } from "vitest";
import { TI18nString } from "@formbricks/types/i18n";
import { getLocalizedValue, getTranslations } from "./i18n";
import i18n from "./i18n.config";

describe("i18n", () => {
  describe("getLocalizedValue", () => {
    test("should return empty string for undefined value", () => {
      expect(getLocalizedValue(undefined, "en")).toBe("");
    });
    test("should return empty string for empty string", () => {
      expect(getLocalizedValue({ default: "" }, "en")).toBe("");
    });

    test("should return empty string for non-i18n string", () => {
      expect(getLocalizedValue("not an i18n string" as any, "en")).toBe("");
    });

    test("should return default value when language not found", () => {
      const i18nString: TI18nString = {
        default: "Default text",
        en: "English text",
      };
      expect(getLocalizedValue(i18nString, "fr")).toBe("Default text");
    });

    test("should return localized value when language found", () => {
      const i18nString: TI18nString = {
        default: "Default text",
        en: "English text",
        fr: "French text",
      };
      expect(getLocalizedValue(i18nString, "fr")).toBe("French text");
    });
  });

  describe("getTranslations", () => {
    // A respondent controls the `language` field of a submitted response, so an arbitrary string can
    // reach this function. The instance formats messages through the ICU plugin, whose message
    // formatter only accepts structurally valid BCP-47 tags and, when construction fails, silently
    // returns the raw pattern - leaking "{step}" into a message the respondent reads. These cases pin
    // both halves of the contract: every usable tag behaves exactly as before, and an unusable one
    // degrades to the fallback language rather than to an un-interpolated pattern.
    const INTERPOLATED_KEY = "errors.step_multiple_of";
    const ENGLISH_STEP_MESSAGE = "Please enter a value in increments of 5";

    /** Codes Intl rejects as language tags, drawn from the reported reproduction set. */
    const UNUSABLE_LANGUAGE_CODES = [
      "e",
      "<script>",
      "../../de",
      "en:de",
      "en.de",
      "en-",
      "-",
      "  ",
      "1",
      "true",
      "en\r\nx",
      "en_US",
      "",
    ];

    test.each([
      ["en", ENGLISH_STEP_MESSAGE],
      ["de", "Bitte geben Sie einen Wert in Schritten von 5 ein"],
      ["fr", "Veuillez saisir une valeur par incréments de 5"],
      ["ja", "5刻みの値を入力してください"],
      ["ar", "يرجى إدخال قيمة بزيادات قدرها 5"],
    ])("interpolates in the requested supported language (%s)", (languageCode, expected) => {
      expect(getTranslations(languageCode)(INTERPOLATED_KEY, { step: 5 })).toBe(expected);
    });

    test.each([
      ["en-US", ENGLISH_STEP_MESSAGE],
      ["de-DE", "Bitte geben Sie einen Wert in Schritten von 5 ein"],
    ])("keeps region variants resolving to their base language (%s)", (languageCode, expected) => {
      expect(getTranslations(languageCode)(INTERPOLATED_KEY, { step: 5 })).toBe(expected);
    });

    test.each(["zz", "xx", "qq", "zz-unknown", "eee"])(
      "leaves a well-formed but unshipped tag to i18next's own fallback (%s)",
      (languageCode) => {
        expect(getTranslations(languageCode)(INTERPOLATED_KEY, { step: 5 })).toBe(ENGLISH_STEP_MESSAGE);
      }
    );

    test.each(UNUSABLE_LANGUAGE_CODES)(
      "interpolates rather than leaking the raw pattern for the unusable code %j",
      (languageCode) => {
        const message = getTranslations(languageCode)(INTERPOLATED_KEY, { step: 5 });

        expect(message).toBe(ENGLISH_STEP_MESSAGE);
        expect(message).not.toContain("{step}");
      }
    );

    test("interpolates the other parameterised validation messages for an unusable code", () => {
      const t = getTranslations("e");

      expect(t("errors.max_value", { max: 100 })).toBe("Please enter a value no greater than 100");
      expect(t("errors.min_value", { min: 0 })).toBe("Please enter a value of at least 0");
      expect(t("errors.min_length", { min: 3 })).toBe("Please enter at least 3 characters");
    });

    test("interpolates a numeric step of zero rather than treating it as absent", () => {
      // Guards the fallback path against a falsy-but-present parameter being dropped.
      expect(getTranslations("e")(INTERPOLATED_KEY, { step: 0 })).toBe(
        "Please enter a value in increments of 0"
      );
    });

    test("does not leave the shared instance set to an unusable language", () => {
      getTranslations("de");
      getTranslations("<script>");

      expect(i18n.language).not.toBe("<script>");
      // The next caller must still get its own language, not whatever the malformed call left behind.
      expect(getTranslations("de")(INTERPOLATED_KEY, { step: 5 })).toBe(
        "Bitte geben Sie einen Wert in Schritten von 5 ein"
      );
    });

    test("falls back for a non-string code reaching it from untyped runtime data", () => {
      for (const languageCode of [undefined, null, 1, true, {}, []]) {
        expect(getTranslations(languageCode as unknown as string)(INTERPOLATED_KEY, { step: 5 })).toBe(
          ENGLISH_STEP_MESSAGE
        );
      }
    });

    test("returns a message with no parameter placeholders left for every unusable code", () => {
      for (const languageCode of UNUSABLE_LANGUAGE_CODES) {
        expect(getTranslations(languageCode)("errors.is_between", { startDate: "a", endDate: "b" })).toBe(
          "Please select a date between a and b"
        );
      }
    });

    // The runtime passes the *selected language code*, and that code is the string "default" for every
    // survey being read in its own default language - which is every single-language survey. `default`
    // is not a language: `I18nProvider` resolves it against the survey's language list and sets the
    // shared instance to the real code, so the instance is the only authority this function can ask.
    // These cases pin both halves of that: the sentinel must answer in the presented language, and no
    // call may write to the instance, because every translated component is subscribed to it.
    describe("the default-language sentinel", () => {
      const REQUIRED_KEY = "errors.please_fill_out_this_field";

      afterEach(async () => {
        // The instance is a module singleton shared by every test in this file.
        await i18n.changeLanguage("en");
      });

      test.each([
        ["de", "Bitte füllen Sie dieses Feld aus"],
        ["ja", "このフィールドに入力してください"],
        ["ar", "يرجى ملء هذا الحقل"],
      ])("answers in the language the survey is presented in (%s)", async (presented, expected) => {
        await i18n.changeLanguage(presented);

        expect(getTranslations("default")(REQUIRED_KEY)).toBe(expected);
      });

      test("interpolates through the sentinel in the presented language", async () => {
        await i18n.changeLanguage("de");

        expect(getTranslations("default")(INTERPOLATED_KEY, { step: 5 })).toBe(
          "Bitte geben Sie einen Wert in Schritten von 5 ein"
        );
      });

      test("resolves a region-variant instance to the language that carries the bundle", async () => {
        await i18n.changeLanguage("de-DE");

        expect(getTranslations("default")(REQUIRED_KEY)).toBe("Bitte füllen Sie dieses Feld aus");
      });

      test("leaves the presented language untouched", async () => {
        await i18n.changeLanguage("de");
        const before = i18n.language;

        getTranslations("default");
        getTranslations("ja");
        getTranslations("<script>");
        getTranslations("en");

        // Every translated component re-renders when this changes, so a validation call that moved it
        // would reset a localized survey's whole chrome to another language until the next reload.
        expect(i18n.language).toBe(before);
        expect(i18n.language).toBe("de");
        // ...and the survey still answers in its own language afterwards.
        expect(getTranslations("default")(REQUIRED_KEY)).toBe("Bitte füllen Sie dieses Feld aus");
      });

      test("does not answer in the presented language when a real code is requested", async () => {
        await i18n.changeLanguage("de");

        // An explicitly requested language always wins: only the sentinel defers to the instance.
        expect(getTranslations("ja")(REQUIRED_KEY)).toBe("このフィールドに入力してください");
        expect(getTranslations("en")(REQUIRED_KEY)).toBe("Please fill out this field");
      });

      test("falls back when the instance itself somehow holds the sentinel", async () => {
        // Resolving the sentinel to itself would be circular, so the fallback language is used.
        await i18n.changeLanguage("default");

        expect(getTranslations("default")(REQUIRED_KEY)).toBe("Please fill out this field");
      });

      test("falls back to English with no provider, as on the server", () => {
        // `init` establishes the fallback language and no provider ever moves it in a server process,
        // so a response submitted with language "default" is validated in English exactly as before.
        expect(i18n.language).toBe("en");
        expect(getTranslations("default")(REQUIRED_KEY)).toBe("Please fill out this field");
      });
    });
  });
});
