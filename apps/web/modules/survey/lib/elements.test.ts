import { TFunction } from "i18next";
import { GaugeIcon } from "lucide-react";
import { describe, expect, test } from "vitest";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import { ZSurveySliderElement } from "@formbricks/types/surveys/elements";
import { getCXElementTypes, getElementDefaults, getElementTypes } from "@/modules/survey/lib/elements";

/**
 * The add-element registry is the single source the editor, the response table and the summary header all
 * read an element type's label, icon and starting configuration from. Its entry type declares `id: string`,
 * `icon: any` and `preset: any`, so it is invisible to the compiler: deleting the Slider entry, mistyping
 * its translation keys or corrupting its preset all compile cleanly and leave every other suite green. This
 * file is the source test that closes that gap.
 *
 * The registry is a pure function of a translation function, so no mocking is needed beyond a `t` stub that
 * echoes its key. Echoing rather than translating is what lets the assertions pin the exact key each field
 * resolves - the thing that actually regresses - instead of a rendered English string.
 */

/**
 * A translation stub that returns the key it was given, so an assertion reads as the key contract.
 *
 * `getElementTypes` calls `t` in two shapes: with a key alone, and with a key plus an inline English
 * fallback for the default scale labels. The stub echoes the key in both cases, so a fallback that stopped
 * being passed would not silently change what this suite sees - `expectedDefaultLabel` below asserts the
 * fallback separately.
 */
const t = ((key: string) => key) as unknown as TFunction;

/** The registry's entry ids, as plain strings, for set comparisons against the element type enum. */
const registryIds: string[] = getElementTypes(t).map((elementType) => elementType.id);
const enumElementTypes: string[] = [...Object.values(TSurveyElementTypeEnum)];

/** The Slider entry, resolved once. Absence is asserted before use so every test below reads cleanly. */
function getSliderEntry() {
  const entry = getElementTypes(t).find((elementType) => elementType.id === TSurveyElementTypeEnum.Slider);
  if (!entry) {
    throw new Error(
      `The element registry has no "${TSurveyElementTypeEnum.Slider}" entry; the add-element menu, the response table column header and the summary header can none of them resolve an icon or label without it.`
    );
  }
  return entry;
}

describe("getElementTypes", () => {
  describe("registry completeness", () => {
    test("exposes exactly 18 element types", () => {
      expect(getElementTypes(t)).toHaveLength(18);
    });

    test("exposes every element type the shared enum declares, and nothing else", () => {
      // Bidirectional on purpose: an enum member with no entry is a type the editor cannot offer, and an
      // entry with no enum member is a menu item that cannot be persisted.
      expect(registryIds.slice().sort()).toEqual(enumElementTypes.slice().sort());
    });

    test("gives every element type a distinct id", () => {
      expect(new Set(registryIds).size).toBe(registryIds.length);
    });

    test("gives every element type a label, a description, an icon and a preset", () => {
      for (const elementType of getElementTypes(t)) {
        expect(elementType.label, `label for ${elementType.id}`).toBeTruthy();
        expect(elementType.description, `description for ${elementType.id}`).toBeTruthy();
        expect(elementType.icon, `icon for ${elementType.id}`).toBeTruthy();
        expect(elementType.preset, `preset for ${elementType.id}`).toBeTruthy();
      }
    });

    test("gives every element type a distinct icon", () => {
      // The Slider cannot reuse OpinionScale's `SlidersHorizontalIcon`: the two would be
      // indistinguishable in the add-element menu, the response table and the summary list.
      const icons = getElementTypes(t).map((elementType) => elementType.icon);
      expect(new Set(icons).size).toBe(icons.length);
    });
  });

  describe("slider entry", () => {
    test("is registered under the slider element type", () => {
      expect(getSliderEntry().id).toBe(TSurveyElementTypeEnum.Slider);
    });

    test("resolves its label from the slider template key", () => {
      expect(getSliderEntry().label).toBe("templates.slider");
    });

    test("resolves its description from the slider description key", () => {
      expect(getSliderEntry().description).toBe("templates.slider_description");
    });

    test("uses the gauge icon", () => {
      expect(getSliderEntry().icon).toBe(GaugeIcon);
    });

    test("does not reuse the opinion scale icon", () => {
      const opinionScaleEntry = getElementTypes(t).find(
        (elementType) => elementType.id === TSurveyElementTypeEnum.OpinionScale
      );
      expect(getSliderEntry().icon).not.toBe(opinionScaleEntry?.icon);
    });
  });

  describe("slider preset", () => {
    test("starts as an empty headline so the editor can autofocus it", () => {
      expect(getSliderEntry().preset.headline).toEqual({ default: "" });
    });

    test("starts with a 0 to 100 range", () => {
      expect(getSliderEntry().preset.range).toEqual({ min: 0, max: 100 });
    });

    test("starts with a step of 1", () => {
      expect(getSliderEntry().preset.step).toBe(1);
    });

    test("shows the selected value by default", () => {
      expect(getSliderEntry().preset.showValue).toBe(true);
    });

    test("supplies default lower and upper scale labels from their template keys", () => {
      expect(getSliderEntry().preset.lowerLabel).toEqual({ default: "templates.slider_lower_label_default" });
      expect(getSliderEntry().preset.upperLabel).toEqual({ default: "templates.slider_upper_label_default" });
    });

    test("passes an inline English fallback alongside each default scale label key", () => {
      // The registry calls `t(key, fallback)`; a stub that echoes only the key cannot see the fallback, so
      // it is asserted through a stub that returns the fallback instead. Losing the fallback would leave a
      // freshly added Slider with blank scale labels wherever the key is untranslated.
      const fallbackT = ((_key: string, fallback?: string) => fallback ?? "") as unknown as TFunction;
      const entry = getElementTypes(fallbackT).find(
        (elementType) => elementType.id === TSurveyElementTypeEnum.Slider
      );

      expect(entry?.preset.lowerLabel).toEqual({ default: "Low" });
      expect(entry?.preset.upperLabel).toEqual({ default: "High" });
    });

    test("produces a preset the slider element schema accepts once the editor instantiates it", () => {
      // What the editor actually persists: the registry preset merged with the id, type and the universal
      // `required` default. Parsing it is the assertion that matters - a preset that looks plausible but
      // fails `ZSurveySliderElement` would make every newly added Slider unsavable.
      const instantiated = {
        id: "gkhfd0k8rf5jbcnpvfmnmvcn",
        type: TSurveyElementTypeEnum.Slider,
        required: false,
        ...getSliderEntry().preset,
      };

      const result = ZSurveySliderElement.safeParse(instantiated);
      if (!result.success) {
        throw new Error(
          `The slider preset does not satisfy ZSurveySliderElement: ${JSON.stringify(result.error.issues, null, 2)}`
        );
      }

      expect(result.data.range).toEqual({ min: 0, max: 100 });
      expect(result.data.step).toBe(1);
      expect(result.data.showValue).toBe(true);
    });

    test("keeps the preset's step within its own range, as the schema requires", () => {
      const { range, step } = getSliderEntry().preset;
      expect(range.min).toBeLessThan(range.max);
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThanOrEqual(range.max - range.min);
    });

    test("hands out an independent preset copy per call, so editing one element cannot mutate the next", () => {
      const first = getSliderEntry().preset;
      const second = getSliderEntry().preset;

      expect(first).not.toBe(second);
      expect(first.range).not.toBe(second.range);
    });
  });
});

/**
 * The slider fields this suite reads back out of `getElementDefaults`.
 *
 * The helper is declared as returning a `TSurveyElement`, but what it actually returns is the registry
 * preset with project placeholders substituted - a fragment that carries no `id` and no `type`, because the
 * editor supplies both when it instantiates the element. There is therefore no discriminant to narrow the
 * union on, and this shape states the three fields under assertion instead.
 */
interface SliderPresetShape {
  range: { min: number; max: number };
  step: number;
  showValue: boolean;
}

describe("getElementDefaults", () => {
  test("returns the slider preset for the slider element type", () => {
    const defaults = getElementDefaults(
      TSurveyElementTypeEnum.Slider,
      { name: "Acme" },
      t
    ) as unknown as SliderPresetShape;

    expect(defaults.range).toEqual({ min: 0, max: 100 });
    expect(defaults.step).toBe(1);
    expect(defaults.showValue).toBe(true);
  });
});

describe("getCXElementTypes", () => {
  test("excludes the slider from the customer experience allow-list", () => {
    // A deliberate opt-in list, not an oversight: the specification keeps the Slider out of that mode, so
    // this assertion protects the exclusion just as the tests above protect the inclusion.
    const cxIds = getCXElementTypes(t).map((elementType) => elementType.id);

    expect(cxIds).not.toContain(TSurveyElementTypeEnum.Slider);
    expect(cxIds).toHaveLength(7);
  });
});
