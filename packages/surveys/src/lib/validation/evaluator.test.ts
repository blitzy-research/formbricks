// @vitest-environment happy-dom
import type { TFunction } from "i18next";
import { describe, expect, test, vi } from "vitest";
import type { TResponseData, TResponseDataValue } from "@formbricks/types/responses";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import type {
  TSurveyAddressElement,
  TSurveyContactInfoElement,
  TSurveyElement,
  TSurveyMatrixElement,
  TSurveyOpenTextElement,
  TSurveyRankingElement,
  TSurveySliderElement,
} from "@formbricks/types/surveys/elements";
import { getFirstErrorMessage, validateBlockResponses, validateElementResponse } from "./evaluator";

// Mock translation function
const mockT = vi.fn((key: string) => {
  return key;
}) as unknown as TFunction;

// Mock getLocalizedValue and getTranslations
vi.mock("@/lib/i18n", () => {
  const mockTFn = vi.fn((key: string) => key) as unknown as TFunction;
  return {
    getLocalizedValue: (
      localizedString: Record<string, string> | undefined,
      languageCode: string
    ): string => {
      if (!localizedString) return "";
      return localizedString[languageCode] || localizedString.default || "";
    },
    getTranslations: () => mockTFn,
  };
});

// Mock i18n.config to return our mock translation function
vi.mock("@/lib/i18n.config", () => ({
  default: {
    language: "en",
    changeLanguage: vi.fn(),
    getFixedT: vi.fn(() => mockT),
  },
}));

describe("validateElementResponse", () => {
  describe("required field validation", () => {
    test("should return error when required field is empty", () => {
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        required: true,
        inputType: "text",
        charLimit: 0,
      } as unknown as TSurveyOpenTextElement;

      const result = validateElementResponse(element, "", "en");
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].ruleId).toBe("required");
    });

    test("should return valid when required field has value", () => {
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        required: true,
        inputType: "text",
        charLimit: 0,
      } as unknown as TSurveyOpenTextElement;

      const result = validateElementResponse(element, "test value", "en");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("should return valid when field is not required", () => {
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        required: false,
        inputType: "text",
        charLimit: 0,
      } as unknown as TSurveyOpenTextElement;

      const result = validateElementResponse(element, "", "en");
      expect(result.valid).toBe(true);
    });

    test("should handle required ranking element - at least one ranked", () => {
      const element: TSurveyElement = {
        id: "rank1",
        type: TSurveyElementTypeEnum.Ranking,
        headline: { default: "Rank these" },
        required: true,
        choices: [
          { id: "opt1", label: { default: "Option 1" } },
          { id: "opt2", label: { default: "Option 2" } },
        ],
      } as unknown as TSurveyRankingElement;

      const result = validateElementResponse(element, ["opt1"], "en");
      expect(result.valid).toBe(true);
    });

    test("should return error when required ranking element has no ranked options", () => {
      const element: TSurveyElement = {
        id: "rank1",
        type: TSurveyElementTypeEnum.Ranking,
        headline: { default: "Rank these" },
        required: true,
        choices: [
          { id: "opt1", label: { default: "Option 1" } },
          { id: "opt2", label: { default: "Option 2" } },
        ],
      } as unknown as TSurveyRankingElement;

      const result = validateElementResponse(element, [], "en");
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    test("should handle required matrix element - at least 1 row must be answered", () => {
      const element: TSurveyElement = {
        id: "matrix1",
        type: TSurveyElementTypeEnum.Matrix,
        headline: { default: "Matrix question" },
        required: true,
        shuffleOption: "none",
        rows: [
          { id: "row1", label: { default: "Row 1" } },
          { id: "row2", label: { default: "Row 2" } },
        ],
        columns: [
          { id: "col1", label: { default: "Col 1" } },
          { id: "col2", label: { default: "Col 2" } },
        ],
      } as unknown as TSurveyMatrixElement;

      // At least 1 row answered should pass
      const result1 = validateElementResponse(element, { row1: "col1" }, "en");
      expect(result1.valid).toBe(true);

      // All rows answered should also pass
      const result2 = validateElementResponse(element, { row1: "col1", row2: "col2" }, "en");
      expect(result2.valid).toBe(true);
    });

    test("should return error when required matrix element has no rows answered", () => {
      const element: TSurveyElement = {
        id: "matrix1",
        type: TSurveyElementTypeEnum.Matrix,
        headline: { default: "Matrix question" },
        required: true,
        shuffleOption: "none",
        rows: [
          { id: "row1", label: { default: "Row 1" } },
          { id: "row2", label: { default: "Row 2" } },
        ],
        columns: [
          { id: "col1", label: { default: "Col 1" } },
          { id: "col2", label: { default: "Col 2" } },
        ],
      } as unknown as TSurveyMatrixElement;

      const result = validateElementResponse(element, {}, "en");
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    test("should return error when required OpinionScale field is empty", () => {
      const element = {
        id: "os1",
        type: TSurveyElementTypeEnum.OpinionScale,
        headline: { default: "Rate this" },
        required: true,
        scaleRange: 5,
        visualStyle: "number",
      } as unknown as TSurveyElement;

      const result = validateElementResponse(element, undefined, "en");
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].ruleId).toBe("required");
    });

    test("should return valid when required OpinionScale field has value", () => {
      const element = {
        id: "os1",
        type: TSurveyElementTypeEnum.OpinionScale,
        headline: { default: "Rate this" },
        required: true,
        scaleRange: 5,
        visualStyle: "number",
      } as unknown as TSurveyElement;

      const result = validateElementResponse(element, 4, "en");
      expect(result.valid).toBe(true);
    });

    test("should NOT apply CTA exemption to OpinionScale", () => {
      const element = {
        id: "os1",
        type: TSurveyElementTypeEnum.OpinionScale,
        headline: { default: "Rate" },
        required: true,
        scaleRange: 5,
        visualStyle: "number",
      } as unknown as TSurveyElement;

      const result = validateElementResponse(element, undefined, "en");
      expect(result.valid).toBe(false);
    });

    test("should return error when required Payment field is empty", () => {
      const element = {
        id: "pay1",
        type: TSurveyElementTypeEnum.Payment,
        headline: { default: "Pay now" },
        required: true,
        currency: "usd",
        amount: 1000,
      } as unknown as TSurveyElement;

      const result = validateElementResponse(element, "", "en");
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].ruleId).toBe("required");
    });

    test("should return valid when required Payment field has value", () => {
      const element = {
        id: "pay1",
        type: TSurveyElementTypeEnum.Payment,
        headline: { default: "Pay now" },
        required: true,
        currency: "usd",
        amount: 1000,
      } as unknown as TSurveyElement;

      const result = validateElementResponse(element, "paid", "en");
      expect(result.valid).toBe(true);
    });

    test("should NOT apply CTA exemption to Payment", () => {
      const element = {
        id: "pay1",
        type: TSurveyElementTypeEnum.Payment,
        headline: { default: "Pay" },
        required: true,
        currency: "usd",
        amount: 1000,
      } as unknown as TSurveyElement;

      const result = validateElementResponse(element, "", "en");
      expect(result.valid).toBe(false);
    });
  });

  describe("validation rules - AND logic", () => {
    test("should return valid when all rules pass", () => {
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        required: false,
        inputType: "text",
        charLimit: 0,
        validation: {
          rules: [
            { id: "rule1", type: "minLength", params: { min: 5 } },
            { id: "rule2", type: "maxLength", params: { max: 10 } },
          ],
          logic: "and",
        },
      } as unknown as TSurveyOpenTextElement;

      const result = validateElementResponse(element, "hello", "en");
      expect(result.valid).toBe(true);
    });

    test("should return error when one rule fails", () => {
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        required: false,
        inputType: "text",
        charLimit: 0,
        validation: {
          rules: [
            { id: "rule1", type: "minLength", params: { min: 10 } },
            { id: "rule2", type: "maxLength", params: { max: 20 } },
          ],
          logic: "and",
        },
      } as unknown as TSurveyOpenTextElement;

      const result = validateElementResponse(element, "hi", "en");
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    test("should return multiple errors when multiple rules fail", () => {
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        required: false,
        inputType: "text",
        charLimit: 0,
        validation: {
          rules: [
            { id: "rule1", type: "minLength", params: { min: 10 } },
            { id: "rule2", type: "maxLength", params: { max: 5 } },
          ],
          logic: "and",
        },
      } as unknown as TSurveyOpenTextElement;

      const result = validateElementResponse(element, "hello", "en");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test("should default to AND logic when logic is not specified", () => {
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        required: false,
        inputType: "text",
        charLimit: 0,
        validation: {
          rules: [
            { id: "rule1", type: "minLength", params: { min: 10 } },
            { id: "rule2", type: "maxLength", params: { max: 5 } },
          ],
        },
      } as unknown as TSurveyOpenTextElement;

      const result = validateElementResponse(element, "hello", "en");
      expect(result.valid).toBe(false);
    });
  });

  describe("validation rules - OR logic", () => {
    test("should return valid when at least one rule passes", () => {
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        required: false,
        inputType: "text",
        charLimit: 0,
        validation: {
          rules: [
            { id: "rule1", type: "minLength", params: { min: 10 } },
            { id: "rule2", type: "maxLength", params: { max: 20 } },
          ],
          logic: "or",
        },
      } as unknown as TSurveyOpenTextElement;

      const result = validateElementResponse(element, "hello", "en");
      expect(result.valid).toBe(true);
    });

    test("should return error when all rules fail", () => {
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        required: false,
        inputType: "text",
        charLimit: 0,
        validation: {
          rules: [
            { id: "rule1", type: "minLength", params: { min: 10 } },
            { id: "rule2", type: "maxLength", params: { max: 3 } },
          ],
          logic: "or",
        },
      } as unknown as TSurveyOpenTextElement;

      const result = validateElementResponse(element, "hello", "en");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("implicit validation for OpenText inputType", () => {
    test("should add implicit email validation for email inputType", () => {
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        inputType: "email",
        required: false,
        charLimit: 0,
      } as unknown as TSurveyOpenTextElement;

      const result = validateElementResponse(element, "invalid-email", "en");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.ruleId === "__implicit_email__")).toBe(true);
    });

    test("should add implicit url validation for url inputType", () => {
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        inputType: "url",
        required: false,
        charLimit: 0,
      } as unknown as TSurveyOpenTextElement;

      const result = validateElementResponse(element, "not-a-url", "en");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.ruleId === "__implicit_url__")).toBe(true);
    });

    test("should add implicit phone validation for phone inputType", () => {
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        inputType: "phone",
        required: false,
        charLimit: 0,
      } as unknown as TSurveyOpenTextElement;

      const result = validateElementResponse(element, "invalid-phone", "en");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.ruleId === "__implicit_phone__")).toBe(true);
    });

    test("should not add implicit rule if explicit rule exists", () => {
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        inputType: "email",
        required: false,
        charLimit: 0,
        validation: {
          rules: [{ id: "rule1", type: "email", params: {} }],
        },
      } as unknown as TSurveyOpenTextElement;

      const result = validateElementResponse(element, "test@example.com", "en");
      expect(result.valid).toBe(true);
      expect(result.errors.some((e) => e.ruleId === "__implicit_email__")).toBe(false);
    });
  });

  describe("implicit validation for ContactInfo", () => {
    test("should add implicit email validation for email field", () => {
      const element: TSurveyElement = {
        id: "contact1",
        type: TSurveyElementTypeEnum.ContactInfo,
        headline: { default: "Contact Info" },
        firstName: { show: true, required: false, placeholder: { default: "First Name" } },
        lastName: { show: true, required: false, placeholder: { default: "Last Name" } },
        email: { show: true, required: false, placeholder: { default: "Email" } },
        phone: { show: false, required: false, placeholder: { default: "Phone" } },
        company: { show: false, required: false, placeholder: { default: "Company" } },
        required: false,
      } as unknown as TSurveyContactInfoElement;

      const result = validateElementResponse(element, ["John", "Doe", "invalid-email", "", ""], "en");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.ruleId === "__implicit_email_field__")).toBe(true);
    });

    test("should add implicit phone validation for phone field", () => {
      const element: TSurveyElement = {
        id: "contact1",
        type: TSurveyElementTypeEnum.ContactInfo,
        headline: { default: "Contact Info" },
        firstName: { show: true, required: false, placeholder: { default: "First Name" } },
        lastName: { show: true, required: false, placeholder: { default: "Last Name" } },
        email: { show: false, required: false, placeholder: { default: "Email" } },
        phone: { show: true, required: false, placeholder: { default: "Phone" } },
        company: { show: false, required: false, placeholder: { default: "Company" } },
        required: false,
      } as unknown as TSurveyContactInfoElement;

      const result = validateElementResponse(element, ["John", "Doe", "", "invalid-phone", ""], "en");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.ruleId === "__implicit_phone_field__")).toBe(true);
    });

    test("should not add implicit rule if explicit rule exists", () => {
      const element: TSurveyElement = {
        id: "contact1",
        type: TSurveyElementTypeEnum.ContactInfo,
        headline: { default: "Contact Info" },
        firstName: { show: true, required: false, placeholder: { default: "First Name" } },
        lastName: { show: true, required: false, placeholder: { default: "Last Name" } },
        email: { show: true, required: false, placeholder: { default: "Email" } },
        phone: { show: false, required: false, placeholder: { default: "Phone" } },
        company: { show: false, required: false, placeholder: { default: "Company" } },
        required: false,
        validation: {
          rules: [{ id: "rule1", type: "email", field: "email", params: {} }],
        },
      } as unknown as TSurveyContactInfoElement;

      const result = validateElementResponse(element, ["John", "Doe", "test@example.com", "", ""], "en");
      expect(result.valid).toBe(true);
      expect(result.errors.some((e) => e.ruleId === "__implicit_email_field__")).toBe(false);
    });
  });

  describe("field-specific validation for Address", () => {
    test("should validate specific field in address element", () => {
      const element: TSurveyElement = {
        id: "address1",
        type: TSurveyElementTypeEnum.Address,
        headline: { default: "Address" },
        addressLine1: { show: true, required: false, placeholder: { default: "Address Line 1" } },
        addressLine2: { show: false, required: false, placeholder: { default: "Address Line 2" } },
        city: { show: true, required: false, placeholder: { default: "City" } },
        state: { show: true, required: false, placeholder: { default: "State" } },
        zip: { show: true, required: false, placeholder: { default: "ZIP" } },
        country: { show: true, required: false, placeholder: { default: "Country" } },
        required: false,
        validation: {
          rules: [{ id: "rule1", type: "minLength", field: "city", params: { min: 3 } }],
        },
      } as unknown as TSurveyAddressElement;

      const result = validateElementResponse(element, ["123 Main St", "", "NY", "", "", ""], "en");
      expect(result.valid).toBe(false);
    });

    test("should validate correct field value", () => {
      const element: TSurveyElement = {
        id: "address1",
        type: TSurveyElementTypeEnum.Address,
        headline: { default: "Address" },
        addressLine1: { show: true, required: false, placeholder: { default: "Address Line 1" } },
        addressLine2: { show: false, required: false, placeholder: { default: "Address Line 2" } },
        city: { show: true, required: false, placeholder: { default: "City" } },
        state: { show: true, required: false, placeholder: { default: "State" } },
        zip: { show: true, required: false, placeholder: { default: "ZIP" } },
        country: { show: true, required: false, placeholder: { default: "Country" } },
        required: false,
        validation: {
          rules: [{ id: "rule1", type: "minLength", field: "city", params: { min: 3 } }],
        },
      } as unknown as TSurveyAddressElement;

      const result = validateElementResponse(element, ["123 Main St", "", "New York", "", "", ""], "en");
      expect(result.valid).toBe(true);
    });
  });

  describe("field-specific validation for ContactInfo", () => {
    test("should validate specific field in contact info element", () => {
      const element: TSurveyElement = {
        id: "contact1",
        type: TSurveyElementTypeEnum.ContactInfo,
        headline: { default: "Contact Info" },
        firstName: { show: true, required: false, placeholder: { default: "First Name" } },
        lastName: { show: true, required: false, placeholder: { default: "Last Name" } },
        email: { show: true, required: false, placeholder: { default: "Email" } },
        phone: { show: true, required: false, placeholder: { default: "Phone" } },
        company: { show: false, required: false, placeholder: { default: "Company" } },
        required: false,
        validation: {
          rules: [{ id: "rule1", type: "minLength", field: "firstName", params: { min: 3 } }],
        },
      } as unknown as TSurveyContactInfoElement;

      const result = validateElementResponse(
        element,
        ["Jo", "Doe", "test@example.com", "1234567890", ""],
        "en"
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("matrix element validation rules", () => {
    test("should apply validation rules when matrix is required", () => {
      const element: TSurveyElement = {
        id: "matrix1",
        type: TSurveyElementTypeEnum.Matrix,
        headline: { default: "Matrix question" },
        required: true,
        shuffleOption: "none",
        rows: [
          { id: "row1", label: { default: "Row 1" } },
          { id: "row2", label: { default: "Row 2" } },
        ],
        columns: [
          { id: "col1", label: { default: "Col 1" } },
          { id: "col2", label: { default: "Col 2" } },
        ],
        validation: {
          rules: [{ id: "rule1", type: "minRowsAnswered", params: { min: 2 } }],
        },
      } as unknown as TSurveyMatrixElement;

      // Required check passes (at least 1 row), but validation rule fails (needs 2 rows)
      const result = validateElementResponse(element, { row1: "col1" }, "en");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(1);
    });

    test("should apply validation rules when matrix is not required", () => {
      const element: TSurveyElement = {
        id: "matrix1",
        type: TSurveyElementTypeEnum.Matrix,
        headline: { default: "Matrix question" },
        required: false,
        shuffleOption: "none",
        rows: [
          { id: "row1", label: { default: "Row 1" } },
          { id: "row2", label: { default: "Row 2" } },
          { id: "row3", label: { default: "Row 3" } },
        ],
        columns: [
          { id: "col1", label: { default: "Col 1" } },
          { id: "col2", label: { default: "Col 2" } },
        ],
        validation: {
          rules: [{ id: "rule1", type: "minRowsAnswered", params: { min: 2 } }],
        },
      } as unknown as TSurveyMatrixElement;

      const result = validateElementResponse(element, { row1: "col1" }, "en");
      expect(result.valid).toBe(false);
    });

    test("should apply answerAllRows validation rule", () => {
      const element: TSurveyElement = {
        id: "matrix1",
        type: TSurveyElementTypeEnum.Matrix,
        headline: { default: "Matrix question" },
        required: false,
        shuffleOption: "none",
        rows: [
          { id: "row1", label: { default: "Row 1" } },
          { id: "row2", label: { default: "Row 2" } },
        ],
        columns: [
          { id: "col1", label: { default: "Col 1" } },
          { id: "col2", label: { default: "Col 2" } },
        ],
        validation: {
          rules: [{ id: "rule1", type: "answerAllRows", params: {} }],
        },
      } as unknown as TSurveyMatrixElement;

      // Only 1 row answered, should fail
      const result1 = validateElementResponse(element, { row1: "col1" }, "en");
      expect(result1.valid).toBe(false);

      // All rows answered, should pass
      const result2 = validateElementResponse(element, { row1: "col1", row2: "col2" }, "en");
      expect(result2.valid).toBe(true);
    });
  });

  describe("unknown validation rule type", () => {
    test("should handle unknown rule type gracefully", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        required: false,
        inputType: "text",
        charLimit: 0,
        validation: {
          rules: [{ id: "rule1", type: "unknown" as any, params: {} }],
        },
      } as unknown as TSurveyOpenTextElement;

      const result = validateElementResponse(element, "test", "en");
      expect(result.valid).toBe(true);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("slider response value type", () => {
    const buildSliderElement = (required: boolean): TSurveyElement =>
      ({
        id: "slider1",
        type: TSurveyElementTypeEnum.Slider,
        headline: { default: "Pick a value" },
        required,
        range: { min: 0, max: 100 },
        step: 5,
        showValue: true,
      }) as unknown as TSurveySliderElement;

    const wrongTypedValues: [string, TResponseDataValue][] = [
      ["a numeric string", "50"],
      ["a partially numeric string", "50junk"],
      ["a non-numeric string", "abc"],
      ["an array", ["50"]],
      ["a record", { value: "50" }],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      // The three rows below are values the generic emptiness helper classifies as "empty" because that is
      // the right reading for the text and choice contracts. For this contract they are present values of
      // the wrong type, and treating them as absent on an *optional* slider would skip the gate and every
      // injected rule, persisting a non-numeric answer.
      ["an empty string", ""],
      ["an empty array", []],
      ["an empty record", {}],
    ];

    test.each(wrongTypedValues)("should reject %s submitted for a slider", (_label, value) => {
      const result = validateElementResponse(buildSliderElement(false), value, "en");

      expect(result.valid).toBe(false);
      // The value-type gate runs before any rule, so it is always reported first. The step-grid rule the
      // evaluator injects from the element's own configuration also fails closed on a non-number, so the
      // total error count is deliberately not pinned here - the gate's identity and message are.
      expect(result.errors[0].ruleId).toBe("sliderValueType");
      expect(result.errors[0].message).toBe("errors.invalid_format");
    });

    test.each([
      ["an in-range number", 50],
      ["the minimum of the range", 0],
      ["the maximum of the range", 100],
    ])("should accept %s submitted for a slider", (_label, value) => {
      const result = validateElementResponse(buildSliderElement(false), value, "en");

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    // A configuration whose own bounds and grid admit decimals and negative values, so the rows below keep
    // proving that the numeric contract accepts those shapes while being measured against an element that
    // actually allows them rather than against the 0-100 step-5 element above.
    const buildSignedDecimalSliderElement = (): TSurveyElement =>
      ({
        id: "slider2",
        type: TSurveyElementTypeEnum.Slider,
        headline: { default: "Pick a value" },
        required: false,
        range: { min: -10, max: 10 },
        step: 2.5,
        showValue: true,
      }) as unknown as TSurveySliderElement;

    test.each([
      ["a positive decimal", 7.5],
      ["a negative number", -10],
      ["a negative decimal", -2.5],
    ])("should accept %s submitted for a signed decimal slider", (_label, value) => {
      const result = validateElementResponse(buildSignedDecimalSliderElement(), value, "en");

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("should report only the required error when a required slider has no value", () => {
      const result = validateElementResponse(buildSliderElement(true), undefined, "en");

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].ruleId).toBe("required");
    });

    test("should keep an unanswered optional slider valid", () => {
      const result = validateElementResponse(buildSliderElement(false), undefined, "en");

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    // `null` is not part of `ZResponseDataValue`, but a JSON payload can carry it and the evaluator is
    // reached directly by every response route, so absence must cover it too rather than falling through to
    // the wrong-type branch and reporting a shape error for what is really a missing answer.
    test("should treat an explicit null as absence rather than a wrong shape", () => {
      const optional = validateElementResponse(
        buildSliderElement(false),
        null as unknown as TResponseDataValue,
        "en"
      );
      expect(optional.valid).toBe(true);
      expect(optional.errors).toHaveLength(0);

      const required = validateElementResponse(
        buildSliderElement(true),
        null as unknown as TResponseDataValue,
        "en"
      );
      expect(required.valid).toBe(false);
      expect(required.errors.map((error) => error.ruleId)).toEqual(["required"]);
    });

    // The required check owns emptiness, so it must stay the single error for a required slider left
    // unanswered - the shape gate is not allowed to pile a second complaint onto the same submission.
    test.each([
      ["an empty string", ""],
      ["an empty array", []],
      ["an empty record", {}],
    ] as [string, TResponseDataValue][])(
      "should report only the required error for a required slider keyed with %s",
      (_label, value) => {
        const result = validateElementResponse(buildSliderElement(true), value, "en");

        expect(result.valid).toBe(false);
        expect(result.errors.map((error) => error.ruleId)).toEqual(["required"]);
      }
    );

    test("should reject an empty shape keyed for an optional slider through the shared server path", () => {
      const elements: TSurveyElement[] = [buildSliderElement(false)];

      for (const value of ["", [], {}] as TResponseDataValue[]) {
        const errorMap = validateBlockResponses(elements, { slider1: value }, "en");

        expect(Object.keys(errorMap)).toEqual(["slider1"]);
        expect(errorMap.slider1[0].ruleId).toBe("sliderValueType");
      }
    });

    test("should report the type error, not the required error, for a wrongly typed answer", () => {
      const result = validateElementResponse(buildSliderElement(true), "50", "en");

      expect(result.valid).toBe(false);
      const ruleIds = result.errors.map((error) => error.ruleId);
      expect(ruleIds[0]).toBe("sliderValueType");
      expect(ruleIds).not.toContain("required");
    });

    test("should not apply the numeric contract to other element types", () => {
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        required: false,
        inputType: "number",
        charLimit: 0,
      } as unknown as TSurveyOpenTextElement;

      // OpenText stores its answer as a string even for inputType "number", so string input stays valid
      const result = validateElementResponse(element, "50", "en");

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("should surface the type error through validateBlockResponses (the shared server path)", () => {
      const elements: TSurveyElement[] = [buildSliderElement(false)];
      const responses: TResponseData = { slider1: "50" };

      const errorMap = validateBlockResponses(elements, responses, "en");

      expect(Object.keys(errorMap)).toEqual(["slider1"]);
      expect(errorMap.slider1[0].ruleId).toBe("sliderValueType");
      expect(getFirstErrorMessage(errorMap, "slider1")).toBe("errors.invalid_format");
    });
  });

  describe("slider implicit range and grid rules", () => {
    const buildSlider = (
      range: { min: number; max: number },
      step: number,
      required = false
    ): TSurveyElement =>
      ({
        id: "slider1",
        type: TSurveyElementTypeEnum.Slider,
        headline: { default: "Pick a value" },
        required,
        range,
        step,
        showValue: true,
      }) as unknown as TSurveySliderElement;

    test("should accept an in-range value that sits on the step grid", () => {
      const result = validateElementResponse(buildSlider({ min: 0, max: 100 }, 5), 50, "en");

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("should reject a value above the configured maximum", () => {
      const result = validateElementResponse(buildSlider({ min: 0, max: 100 }, 5), 105, "en");

      expect(result.valid).toBe(false);
      expect(result.errors.map((error) => error.ruleId)).toEqual(["__implicit_slider_max__"]);
      expect(result.errors[0].ruleType).toBe("maxValue");
    });

    test("should reject a value below the configured minimum", () => {
      const result = validateElementResponse(buildSlider({ min: 10, max: 50 }, 5), 5, "en");

      expect(result.valid).toBe(false);
      expect(result.errors.map((error) => error.ruleId)).toEqual(["__implicit_slider_min__"]);
      expect(result.errors[0].ruleType).toBe("minValue");
    });

    test("should reject an in-range value that misses the step grid", () => {
      const result = validateElementResponse(buildSlider({ min: 0, max: 100 }, 5), 7, "en");

      expect(result.valid).toBe(false);
      expect(result.errors.map((error) => error.ruleId)).toEqual(["__implicit_slider_step__"]);
      expect(result.errors[0].ruleType).toBe("stepMultipleOf");
    });

    test("should anchor the step grid at the range minimum rather than at zero", () => {
      const element = buildSlider({ min: 10, max: 50 }, 5);

      expect(validateElementResponse(element, 15, "en").valid).toBe(true);

      const offGrid = validateElementResponse(element, 12, "en");
      expect(offGrid.valid).toBe(false);
      expect(offGrid.errors.map((error) => error.ruleId)).toEqual(["__implicit_slider_step__"]);
    });

    test("should treat zero as an answer when the range starts at zero", () => {
      const result = validateElementResponse(buildSlider({ min: 0, max: 100 }, 5, true), 0, "en");

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("should reject a required slider submitted with an empty value", () => {
      const result = validateElementResponse(buildSlider({ min: 0, max: 100 }, 5, true), "", "en");

      expect(result.valid).toBe(false);
      expect(result.errors.map((error) => error.ruleId)).toEqual(["required"]);
    });

    // A slider carries no author-configurable rules: `APPLICABLE_RULES.slider` is empty and the element
    // schema declares no `validation` field. A `validation` block on a slider therefore only ever arrives
    // from a hand-crafted payload or a draft that bypassed the schema, and honouring it would let a caller
    // replace the intrinsic bounds and grid with looser ones - or suppress them entirely - which is exactly
    // what the rules are there to prevent. The two rows below pin that such a block is discarded.
    test("should ignore a same-type rule supplied on the element and still enforce the range", () => {
      const element = {
        id: "slider1",
        type: TSurveyElementTypeEnum.Slider,
        headline: { default: "Pick a value" },
        required: false,
        range: { min: 0, max: 100 },
        step: 5,
        showValue: true,
        // A replacement `maxValue` of 1000 would admit values far outside the configured range.
        validation: {
          rules: [{ id: "injected-max", type: "maxValue", params: { max: 1000 } }],
        },
      } as unknown as TSurveySliderElement;

      const result = validateElementResponse(element, 105, "en");

      expect(result.valid).toBe(false);
      const ruleIds = result.errors.map((error) => error.ruleId);
      expect(ruleIds).toEqual(["__implicit_slider_max__"]);
      expect(ruleIds).not.toContain("injected-max");
    });

    test("should ignore an or-logic block supplied on the element and still enforce every constraint", () => {
      const element = {
        id: "slider1",
        type: TSurveyElementTypeEnum.Slider,
        headline: { default: "Pick a value" },
        required: false,
        range: { min: 0, max: 100 },
        step: 5,
        showValue: true,
        // Under "or" a single passing rule short-circuits the rest, so one trivially satisfiable rule would
        // otherwise be enough to wave through a value that is both out of range and off the grid.
        validation: {
          logic: "or",
          rules: [{ id: "always-passes", type: "minValue", params: { min: 0 } }],
        },
      } as unknown as TSurveySliderElement;

      const result = validateElementResponse(element, 107, "en");

      expect(result.valid).toBe(false);
      // AND semantics are restored, so both violated constraints are reported.
      expect(result.errors.map((error) => error.ruleId)).toEqual([
        "__implicit_slider_max__",
        "__implicit_slider_step__",
      ]);
    });

    test("should not inject the numeric rules for other element types", () => {
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        required: false,
        inputType: "text",
        charLimit: 0,
      } as unknown as TSurveyOpenTextElement;

      const result = validateElementResponse(element, "anything", "en");

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("should enforce the rules through validateBlockResponses (the shared server path)", () => {
      const elements: TSurveyElement[] = [buildSlider({ min: 0, max: 100 }, 5)];
      const responses: TResponseData = { slider1: 7 };

      const errorMap = validateBlockResponses(elements, responses, "en");

      expect(Object.keys(errorMap)).toEqual(["slider1"]);
      expect(errorMap.slider1.map((error) => error.ruleId)).toEqual(["__implicit_slider_step__"]);
    });
  });

  // The element schema guarantees a finite range and step with min < max, but the editor's draft autosave
  // path persists a survey without passing it, so at runtime a slider can reach the evaluator with a
  // configuration the injected rules cannot be derived from. Reading it unguarded would raise a TypeError
  // and surface as a generic 500; deriving no rules at all would leave the answer entirely unconstrained.
  // Every row below therefore has to be rejected, and none of them may throw.
  describe("slider configuration that cannot be trusted", () => {
    const buildMalformedSlider = (overrides: Record<string, unknown>): TSurveyElement =>
      ({
        id: "slider1",
        type: TSurveyElementTypeEnum.Slider,
        headline: { default: "Pick a value" },
        required: false,
        range: { min: 0, max: 100 },
        step: 5,
        showValue: true,
        ...overrides,
      }) as unknown as TSurveySliderElement;

    const malformedConfigurations: [string, Record<string, unknown>][] = [
      ["an absent range", { range: undefined }],
      ["a null range", { range: null }],
      ["a range left as the base schema's numeric literal", { range: 5 }],
      ["a range missing its minimum", { range: { max: 100 } }],
      ["a range missing its maximum", { range: { min: 0 } }],
      ["a non-numeric minimum", { range: { min: "0", max: 100 } }],
      ["a non-numeric maximum", { range: { min: 0, max: "100" } }],
      ["a non-finite maximum", { range: { min: 0, max: Number.POSITIVE_INFINITY } }],
      ["an inverted range", { range: { min: 100, max: 0 } }],
      ["a collapsed range", { range: { min: 50, max: 50 } }],
      ["an absent step", { step: undefined }],
      ["a non-numeric step", { step: "5" }],
      ["a non-finite step", { step: Number.NaN }],
      ["a zero step", { step: 0 }],
      ["a negative step", { step: -5 }],
    ];

    test.each(malformedConfigurations)(
      "should reject a submitted value against a slider with %s",
      (_label, overrides) => {
        const element = buildMalformedSlider(overrides);

        // A value that would be perfectly valid against the well-formed configuration.
        const result = validateElementResponse(element, 50, "en");

        expect(result.valid).toBe(false);
        expect(result.errors.map((error) => error.ruleId)).toEqual(["sliderConfiguration"]);
        expect(result.errors[0].message).toBe("errors.invalid_format");
      }
    );

    test.each(malformedConfigurations)(
      "should keep an unanswered optional slider with %s valid",
      (_label, overrides) => {
        const result = validateElementResponse(buildMalformedSlider(overrides), undefined, "en");

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }
    );

    test("should report only the required error when a required malformed slider has no value", () => {
      const element = buildMalformedSlider({ range: undefined, required: true });

      const result = validateElementResponse(element, undefined, "en");

      expect(result.valid).toBe(false);
      expect(result.errors.map((error) => error.ruleId)).toEqual(["required"]);
    });

    test("should report the shape error, not the configuration error, for a wrongly typed answer", () => {
      const element = buildMalformedSlider({ range: undefined });

      const result = validateElementResponse(element, "50", "en");

      expect(result.valid).toBe(false);
      // Exactly one structural error is reported: the shape gate is checked first and wins.
      expect(result.errors.map((error) => error.ruleId)).toEqual(["sliderValueType"]);
    });

    test("should reject through validateBlockResponses (the shared server path)", () => {
      const elements: TSurveyElement[] = [buildMalformedSlider({ step: 0 })];

      const errorMap = validateBlockResponses(elements, { slider1: 50 }, "en");

      expect(Object.keys(errorMap)).toEqual(["slider1"]);
      expect(errorMap.slider1.map((error) => error.ruleId)).toEqual(["sliderConfiguration"]);
      expect(getFirstErrorMessage(errorMap, "slider1")).toBe("errors.invalid_format");
    });

    test("should leave other element types untouched by the configuration gate", () => {
      const element: TSurveyElement = {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        required: false,
        inputType: "text",
        charLimit: 0,
      } as unknown as TSurveyOpenTextElement;

      const result = validateElementResponse(element, "anything", "en");

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

describe("validateBlockResponses", () => {
  test("should return empty error map when all elements are valid", () => {
    const elements: TSurveyElement[] = [
      {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question 1" },
        required: false,
        inputType: "text",
        charLimit: 0,
      } as TSurveyOpenTextElement,
      {
        id: "text2",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question 2" },
        required: false,
        inputType: "text",
        charLimit: 0,
      } as TSurveyOpenTextElement,
    ];

    const responses: TResponseData = {
      text1: "value1",
      text2: "value2",
    };

    const result = validateBlockResponses(elements, responses, "en");
    expect(Object.keys(result)).toHaveLength(0);
  });

  test("should return error map with invalid elements", () => {
    const elements: TSurveyElement[] = [
      {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question 1" },
        required: true,
        inputType: "text",
        charLimit: 0,
      } as TSurveyOpenTextElement,
      {
        id: "text2",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question 2" },
        required: false,
        inputType: "text",
        charLimit: 0,
      } as TSurveyOpenTextElement,
    ];

    const responses: TResponseData = {
      text1: "",
      text2: "value2",
    };

    const result = validateBlockResponses(elements, responses, "en");
    expect(Object.keys(result)).toHaveLength(1);
    const text1Errors = result.text1;
    expect(text1Errors).toBeDefined();
    expect(text1Errors?.length).toBeGreaterThan(0);
  });

  test("should handle missing responses", () => {
    const elements: TSurveyElement[] = [
      {
        id: "text1",
        type: TSurveyElementTypeEnum.OpenText,
        headline: { default: "Question" },
        required: true,
        inputType: "text",
        charLimit: 0,
      } as TSurveyOpenTextElement,
    ];

    const responses: TResponseData = {};

    const result = validateBlockResponses(elements, responses, "en");
    expect(Object.keys(result)).toHaveLength(1);
    expect(result.text1).toBeDefined();
  });
});

describe("getFirstErrorMessage", () => {
  test("should return first error message for element", () => {
    const errorMap = {
      text1: [
        { ruleId: "rule1", ruleType: "minLength" as const, message: "First error" },
        { ruleId: "rule2", ruleType: "maxLength" as const, message: "Second error" },
      ],
    };

    const message = getFirstErrorMessage(errorMap, "text1");
    expect(message).toBe("First error");
  });

  test("should return undefined when element has no errors", () => {
    const errorMap = {
      text1: [{ ruleId: "rule1", ruleType: "minLength" as const, message: "Error" }],
    };

    const message = getFirstErrorMessage(errorMap, "text2");
    expect(message).toBeUndefined();
  });

  test("should return undefined when error map is empty", () => {
    const errorMap = {};
    const message = getFirstErrorMessage(errorMap, "text1");
    expect(message).toBeUndefined();
  });
});
