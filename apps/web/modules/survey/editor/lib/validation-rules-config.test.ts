import { describe, expect, test } from "vitest";
import { TValidationRuleType, ZValidationRuleType } from "@formbricks/types/surveys/validation-rules";
import { RULE_TYPE_CONFIG } from "./validation-rules-config";

/**
 * The rule types the shared enum declares, taken from the enum itself rather than transcribed.
 *
 * The list used to be hand-written and had fallen ten short, so the test named "config for all validation
 * rule types" passed while `stepMultipleOf` — the rule the Slider's grid check runs on — went entirely
 * unexercised. Deriving it keeps the claim true as the enum grows.
 */
const allRuleTypes: TValidationRuleType[] = [...ZValidationRuleType.options];

describe("RULE_TYPE_CONFIG", () => {
  test("should have config for all validation rule types", () => {
    expect(allRuleTypes).toHaveLength(27);

    allRuleTypes.forEach((ruleType) => {
      expect(RULE_TYPE_CONFIG[ruleType], `config for ${ruleType}`).toBeDefined();
      expect(RULE_TYPE_CONFIG[ruleType].labelKey).toBeDefined();
      expect(typeof RULE_TYPE_CONFIG[ruleType].labelKey).toBe("string");
      expect(typeof RULE_TYPE_CONFIG[ruleType].needsValue).toBe("boolean");
    });
  });

  test("should not configure any rule type the enum does not declare", () => {
    // The other direction of the same contract: a stale entry left behind after a rule was renamed would
    // otherwise sit in the map unnoticed and appear in the editor's rule picker.
    expect(Object.keys(RULE_TYPE_CONFIG).sort()).toEqual([...allRuleTypes].sort());
  });

  test("should give every rule that needs a value a value type", () => {
    for (const ruleType of allRuleTypes) {
      const config = RULE_TYPE_CONFIG[ruleType];
      if (config.needsValue) {
        expect(config.valueType, `valueType for ${ruleType}`).toBeDefined();
      } else {
        expect(config.valueType, `valueType for ${ruleType}`).toBeUndefined();
      }
    }
  });

  describe("minLength rule", () => {
    test("should have correct config", () => {
      const config = RULE_TYPE_CONFIG.minLength;
      expect(config.labelKey).toBe("min_length");
      expect(config.needsValue).toBe(true);
      expect(config.valueType).toBe("number");
      expect(config.valuePlaceholder).toBe("100");
      expect(config.unitOptions).toEqual([{ value: "characters", labelKey: "characters" }]);
    });
  });

  describe("maxLength rule", () => {
    test("should have correct config", () => {
      const config = RULE_TYPE_CONFIG.maxLength;
      expect(config.labelKey).toBe("max_length");
      expect(config.needsValue).toBe(true);
      expect(config.valueType).toBe("number");
      expect(config.valuePlaceholder).toBe("500");
      expect(config.unitOptions).toEqual([{ value: "characters", labelKey: "characters" }]);
    });
  });

  describe("pattern rule", () => {
    test("should have correct config", () => {
      const config = RULE_TYPE_CONFIG.pattern;
      expect(config.labelKey).toBe("pattern");
      expect(config.needsValue).toBe(true);
      expect(config.valueType).toBe("text");
      expect(config.valuePlaceholder).toBe("^[A-Z].*");
      expect(config.unitOptions).toBeUndefined();
    });
  });

  describe("email rule", () => {
    test("should have correct config", () => {
      const config = RULE_TYPE_CONFIG.email;
      expect(config.labelKey).toBe("email");
      expect(config.needsValue).toBe(false);
      expect(config.valueType).toBeUndefined();
      expect(config.valuePlaceholder).toBeUndefined();
      expect(config.unitOptions).toBeUndefined();
    });
  });

  describe("url rule", () => {
    test("should have correct config", () => {
      const config = RULE_TYPE_CONFIG.url;
      expect(config.labelKey).toBe("url");
      expect(config.needsValue).toBe(false);
      expect(config.valueType).toBeUndefined();
      expect(config.valuePlaceholder).toBeUndefined();
      expect(config.unitOptions).toBeUndefined();
    });
  });

  describe("phone rule", () => {
    test("should have correct config", () => {
      const config = RULE_TYPE_CONFIG.phone;
      expect(config.labelKey).toBe("phone");
      expect(config.needsValue).toBe(false);
      expect(config.valueType).toBeUndefined();
      expect(config.valuePlaceholder).toBeUndefined();
      expect(config.unitOptions).toBeUndefined();
    });
  });

  describe("minValue rule", () => {
    test("should have correct config", () => {
      const config = RULE_TYPE_CONFIG.minValue;
      expect(config.labelKey).toBe("min_value");
      expect(config.needsValue).toBe(true);
      expect(config.valueType).toBe("number");
      expect(config.valuePlaceholder).toBe("0");
      expect(config.unitOptions).toBeUndefined();
    });
  });

  describe("maxValue rule", () => {
    test("should have correct config", () => {
      const config = RULE_TYPE_CONFIG.maxValue;
      expect(config.labelKey).toBe("max_value");
      expect(config.needsValue).toBe(true);
      expect(config.valueType).toBe("number");
      expect(config.valuePlaceholder).toBe("100");
      expect(config.unitOptions).toBeUndefined();
    });
  });

  describe("stepMultipleOf rule", () => {
    test("should have correct config", () => {
      const config = RULE_TYPE_CONFIG.stepMultipleOf;
      expect(config.labelKey).toBe("step_multiple_of");
      expect(config.needsValue).toBe(true);
      expect(config.valueType).toBe("number");
      expect(config.valuePlaceholder).toBe("5");
      expect(config.unitOptions).toBeUndefined();
    });

    test("should carry no unit, because the step is expressed in the element's own scale", () => {
      // Unlike minLength ("characters") or minSelections ("options"), a step has no unit of its own — it is
      // read in whatever the slider's range is measured in — so offering a unit picker would be misleading.
      expect(RULE_TYPE_CONFIG.stepMultipleOf.unitOptions).toBeUndefined();
    });
  });

  describe("minSelections rule", () => {
    test("should have correct config", () => {
      const config = RULE_TYPE_CONFIG.minSelections;
      expect(config.labelKey).toBe("min_selections");
      expect(config.needsValue).toBe(true);
      expect(config.valueType).toBe("number");
      expect(config.valuePlaceholder).toBe("1");
      expect(config.unitOptions).toEqual([{ value: "options", labelKey: "options_selected" }]);
    });
  });

  describe("maxSelections rule", () => {
    test("should have correct config", () => {
      const config = RULE_TYPE_CONFIG.maxSelections;
      expect(config.labelKey).toBe("max_selections");
      expect(config.needsValue).toBe(true);
      expect(config.valueType).toBe("number");
      expect(config.valuePlaceholder).toBe("3");
      expect(config.unitOptions).toEqual([{ value: "options", labelKey: "options_selected" }]);
    });
  });

  describe("valueType validation", () => {
    test("should have valueType 'number' for numeric rules", () => {
      expect(RULE_TYPE_CONFIG.minLength.valueType).toBe("number");
      expect(RULE_TYPE_CONFIG.maxLength.valueType).toBe("number");
      expect(RULE_TYPE_CONFIG.minValue.valueType).toBe("number");
      expect(RULE_TYPE_CONFIG.maxValue.valueType).toBe("number");
      expect(RULE_TYPE_CONFIG.stepMultipleOf.valueType).toBe("number");
      expect(RULE_TYPE_CONFIG.minSelections.valueType).toBe("number");
      expect(RULE_TYPE_CONFIG.maxSelections.valueType).toBe("number");
    });

    test("should have valueType 'text' for text rules", () => {
      expect(RULE_TYPE_CONFIG.pattern.valueType).toBe("text");
    });

    test("should not have valueType for rules that don't need values", () => {
      expect(RULE_TYPE_CONFIG.email.valueType).toBeUndefined();
      expect(RULE_TYPE_CONFIG.url.valueType).toBeUndefined();
      expect(RULE_TYPE_CONFIG.phone.valueType).toBeUndefined();
    });
  });

  describe("unitOptions validation", () => {
    test("should have unitOptions for length and selection rules", () => {
      expect(RULE_TYPE_CONFIG.minLength.unitOptions).toBeDefined();
      expect(RULE_TYPE_CONFIG.maxLength.unitOptions).toBeDefined();
      expect(RULE_TYPE_CONFIG.minSelections.unitOptions).toBeDefined();
      expect(RULE_TYPE_CONFIG.maxSelections.unitOptions).toBeDefined();
    });

    test("should not have unitOptions for other rules", () => {
      expect(RULE_TYPE_CONFIG.pattern.unitOptions).toBeUndefined();
      expect(RULE_TYPE_CONFIG.email.unitOptions).toBeUndefined();
      expect(RULE_TYPE_CONFIG.url.unitOptions).toBeUndefined();
      expect(RULE_TYPE_CONFIG.phone.unitOptions).toBeUndefined();
      expect(RULE_TYPE_CONFIG.minValue.unitOptions).toBeUndefined();
      expect(RULE_TYPE_CONFIG.maxValue.unitOptions).toBeUndefined();
      expect(RULE_TYPE_CONFIG.stepMultipleOf.unitOptions).toBeUndefined();
    });

    test("should offer unitOptions only for the length and selection rules", () => {
      const withUnits = allRuleTypes.filter((ruleType) => RULE_TYPE_CONFIG[ruleType].unitOptions);

      expect(withUnits.sort()).toEqual(["maxLength", "maxSelections", "minLength", "minSelections"]);
    });
  });
});
