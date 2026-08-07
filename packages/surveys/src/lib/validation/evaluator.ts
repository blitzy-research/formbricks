import type { TFunction } from "i18next";
import type { TResponseData, TResponseDataValue } from "@formbricks/types/responses";
// Imported from `constants` rather than through the `elements` re-export on purpose: `elements` evaluates
// every Zod schema in the survey type system at module load, which would put the whole of Zod into the
// respondent bundle. `constants` is the deliberately dependency-free half of the same source of truth.
import { parseSurveySliderConfiguration } from "@formbricks/types/surveys/constants";
import type { TSurveySliderConfiguration } from "@formbricks/types/surveys/constants";
import type { TSurveyElement } from "@formbricks/types/surveys/elements";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import type {
  TAddressField,
  TContactInfoField,
  TValidationError,
  TValidationErrorMap,
  TValidationResult,
  TValidationRule,
} from "@formbricks/types/surveys/validation-rules";
import { getLocalizedValue, getTranslations } from "@/lib/i18n";
import { validators } from "./validators";

/**
 * Check if a value is empty
 */
const isEmpty = (value: TResponseDataValue): boolean => {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0)
  );
};

/**
 * Create a required field error
 *
 * `ruleId: "required"` is what identifies this verdict; no rule produced it. The `ruleType` beside it is
 * carried unchanged for every element type, deliberately outside the structural categories - see
 * `VALIDATION_STRUCTURAL_ERROR_TYPES` in `@formbricks/types/surveys/validation-rules` for why.
 */
const createRequiredError = (t: TFunction): TValidationError => {
  return {
    ruleId: "required",
    ruleType: "minLength", // Structural field only - required is not a validation rule
    message: t("errors.please_fill_out_this_field"),
  } as TValidationError;
};

/**
 * Get field label for address/contact info elements
 */
const getFieldLabel = (
  element: TSurveyElement,
  field: TAddressField | TContactInfoField | undefined,
  languageCode: string
): string | undefined => {
  if (!field) return undefined;

  if (element.type === TSurveyElementTypeEnum.Address && "addressLine1" in element) {
    const fieldConfig = element[field as TAddressField];
    if (fieldConfig && "placeholder" in fieldConfig) {
      return getLocalizedValue(fieldConfig.placeholder, languageCode);
    }
  }

  if (element.type === TSurveyElementTypeEnum.ContactInfo && "firstName" in element) {
    const fieldConfig = element[field as TContactInfoField];
    if (fieldConfig && "placeholder" in fieldConfig) {
      return getLocalizedValue(fieldConfig.placeholder, languageCode);
    }
  }

  return undefined;
};

/**
 * Get default error message from rule or validator
 */
const getDefaultErrorMessage = (
  rule: TValidationRule,
  element: TSurveyElement,
  languageCode: string,
  t: TFunction
): string => {
  const validator = validators[rule.type];
  if (!validator) {
    return t("errors.invalid_format");
  }

  const baseMessage = validator.getDefaultMessage(rule.params, element, t);

  // For field-specific validation, prepend the field name
  if (rule.field) {
    const fieldLabel = getFieldLabel(element, rule.field, languageCode);
    if (fieldLabel) {
      return `${fieldLabel}: ${baseMessage}`;
    }
  }

  return baseMessage;
};

/**
 * Validate required field for ranking elements
 */
const validateRequiredRanking = (value: TResponseDataValue, t: TFunction): TValidationError | null => {
  const isValueArray = Array.isArray(value);
  const atLeastOneRanked = isValueArray && value.length >= 1;
  if (isEmpty(value) || !atLeastOneRanked) {
    return createRequiredError(t);
  }
  return null;
};

/**
 * Validate required field for matrix elements
 * Required means: at least 1 row must be answered
 */
const validateRequiredMatrix = (
  value: TResponseDataValue,
  element: TSurveyElement,
  t: TFunction
): TValidationError | null => {
  if (isEmpty(value)) {
    return createRequiredError(t);
  }
  if (typeof value === "object" && !Array.isArray(value) && value !== null && "rows" in element) {
    const answeredRows = Object.values(value).filter((v) => v !== "" && v !== null && v !== undefined).length;
    // Required means at least 1 row must be answered
    if (answeredRows === 0) {
      return createRequiredError(t);
    }
  }
  return null;
};

/**
 * Check required field validation
 */
const checkRequiredField = (
  element: TSurveyElement,
  value: TResponseDataValue,
  t: TFunction
): TValidationError | null => {
  if (!element.required) {
    return null;
  }

  // CTA elements never block progression (informational only)
  if (element.type === TSurveyElementTypeEnum.CTA) {
    return null;
  }

  if (element.type === TSurveyElementTypeEnum.Ranking) {
    return validateRequiredRanking(value, t);
  }

  if (element.type === TSurveyElementTypeEnum.Matrix) {
    return validateRequiredMatrix(value, element, t);
  }

  if (isEmpty(value)) {
    return createRequiredError(t);
  }

  return null;
};

/**
 * Check the response value shape for elements whose answer contract is a single number.
 *
 * A slider answer is contractually exactly one number, but the transport schema `ZResponseDataValue`
 * deliberately admits strings, arrays and records for the other element types, and every response route
 * reaches this evaluator through `validateBlockResponses`. The range rules are intentionally lenient - they
 * coerce with `Number.parseFloat` and skip values they cannot parse - so a payload such as `"50"`,
 * `"50junk"` or `["50"]` posted straight to the API passes both of them. This gate answers such a payload
 * with a single error that names its shape as the reason, keeping the server authoritative over the response
 * contract while leaving the numeric rules element-agnostic and reusable. It stands independently of the
 * injected rules - the grid rule refuses a non-number as well - so the contract holds wherever the two
 * overlap and the respondent still reads one accurate reason.
 *
 * Absence is `checkRequiredField`'s business, so the caller runs this gate only when that check stayed
 * silent: an unanswered optional slider stays valid and an unanswered required slider yields exactly one
 * "required" error rather than a duplicate structural complaint.
 */
const checkSliderValueType = (
  element: TSurveyElement,
  value: TResponseDataValue,
  t: TFunction
): TValidationError | null => {
  if (element.type !== TSurveyElementTypeEnum.Slider) {
    return null;
  }

  // `undefined`, or a defensive `null`, is what counts as "no answer" here. `isEmpty` additionally treats
  // "", [] and {} as empty, which is correct for the text and choice contracts but wrong for this one: those
  // shapes are *present* values of the wrong type. Classifying them as absent would let an optional slider
  // skip this gate and pass validation carrying a non-numeric answer.
  if (value === undefined || value === null) {
    return null;
  }

  // `Number.isFinite` additionally rejects NaN and +/-Infinity, neither of which is a submittable value.
  if (typeof value === "number" && Number.isFinite(value)) {
    return null;
  }

  return {
    ruleId: "sliderValueType",
    // Not a rule verdict: no rule ran. The category says what refused the answer, so the API metadata agrees
    // with the message beside it rather than naming a rule that was never reached.
    ruleType: "valueType",
    message: t("errors.invalid_format"),
  };
};

/**
 * Read a slider's numeric configuration, or `null` when it cannot be trusted.
 *
 * The decision is `parseSurveySliderConfiguration`'s, not this function's - the same function the element
 * schema refines against and the editor panel marks its fields from. Delegating rather than restating is what
 * makes the two entry points agree BY CONSTRUCTION: a configuration an author can save is exactly one whose
 * answers can be checked, and any other is refused by both. Restated rules could drift, and either direction
 * of that drift is a defect - an author saving a slider that rejects every answer, or a slider whose answers
 * are validated against a grid the schema would not have allowed.
 *
 * The read has to be defensive because a survey saved from the editor's draft autosave path reaches
 * persistence without passing the element schema, so at runtime `range` or `step` can be absent or
 * non-numeric even though the compiled type declares them present. The parser takes `unknown` for that
 * reason, and routing every read through here keeps the rule injector free of unguarded dereferences - an
 * absent `range` would otherwise raise a TypeError and surface as a generic 500.
 */
const readSliderConfig = (element: TSurveyElement): TSurveySliderConfiguration | null => {
  if (element.type !== TSurveyElementTypeEnum.Slider) {
    return null;
  }

  const result = parseSurveySliderConfiguration(element);
  return result.valid ? result.configuration : null;
};

/**
 * Reject a submitted slider value whose element configuration cannot be trusted.
 *
 * Without this the three intrinsic rules simply would not be injected for a malformed slider, leaving the
 * answer unconstrained: a value outside any intended range and off any intended grid would pass response
 * validation. Failing closed keeps the server authoritative even for a survey whose element definition is
 * incomplete, and does so with a validation error rather than the TypeError an unguarded configuration read
 * would raise.
 */
const checkSliderConfiguration = (
  element: TSurveyElement,
  value: TResponseDataValue,
  t: TFunction
): TValidationError | null => {
  if (element.type !== TSurveyElementTypeEnum.Slider) {
    return null;
  }

  // Absence is `checkRequiredField`'s business: an unanswered optional slider stays valid even when the
  // element itself is a half-finished draft, exactly as it does for every other element type.
  if (value === undefined || value === null) {
    return null;
  }

  if (readSliderConfig(element) !== null) {
    return null;
  }

  return {
    ruleId: "sliderConfiguration",
    // The element's own definition is what failed here, not the respondent's answer and not a rule.
    ruleType: "elementConfiguration",
    message: t("errors.invalid_format"),
  };
};

/**
 * Add implicit validation rules for OpenText elements based on inputType
 */
const addImplicitOpenTextRules = (element: TSurveyElement, rules: TValidationRule[]): TValidationRule[] => {
  if (element.type !== TSurveyElementTypeEnum.OpenText || !("inputType" in element)) {
    return rules;
  }

  const inputType = element.inputType;
  const hasRule = (type: string) => rules.some((r) => r.type === type);

  if (inputType === "email" && !hasRule("email")) {
    rules.push({
      id: "__implicit_email__",
      type: "email",
      params: {},
    } as TValidationRule);
  } else if (inputType === "url" && !hasRule("url")) {
    rules.push({
      id: "__implicit_url__",
      type: "url",
      params: {},
    } as TValidationRule);
  } else if (inputType === "phone" && !hasRule("phone")) {
    rules.push({
      id: "__implicit_phone__",
      type: "phone",
      params: {},
    } as TValidationRule);
  }

  return rules;
};

/**
 * Add implicit validation rules for ContactInfo elements
 */
const addImplicitContactInfoRules = (
  element: TSurveyElement,
  rules: TValidationRule[]
): TValidationRule[] => {
  if (element.type !== TSurveyElementTypeEnum.ContactInfo) {
    return rules;
  }

  const contactInfoElement = element;
  const hasFieldRule = (type: string, field: string) =>
    rules.some((r) => r.type === type && r.field === field);

  if (contactInfoElement.email?.show && !hasFieldRule("email", "email")) {
    rules.push({
      id: "__implicit_email_field__",
      type: "email",
      field: "email",
      params: {},
    } as TValidationRule);
  }

  if (contactInfoElement.phone?.show && !hasFieldRule("phone", "phone")) {
    rules.push({
      id: "__implicit_phone_field__",
      type: "phone",
      field: "phone",
      params: {},
    } as TValidationRule);
  }

  return rules;
};

/**
 * Add implicit validation rules for Slider elements
 *
 * A slider's bounds and step grid are intrinsic to its own configuration, so they are derived from the
 * element here and enforced by the ordinary rule engine.
 *
 * `offset` anchors grid alignment at `range.min` rather than at zero, so a 10-50 range with a step of 5
 * accepts 10, 15 and 20 while rejecting 12.
 *
 * All three rules are appended unconditionally: a slider has no author-configurable rules, so nothing can
 * suppress a constraint the schema promises.
 *
 * No rule carries a `field`, so `getFieldValue` passes the element's whole value - the single numeric
 * answer - into each validator.
 */
const addImplicitSliderRules = (element: TSurveyElement, rules: TValidationRule[]): TValidationRule[] => {
  // Returns null for every other element type as well, so this doubles as the type guard. A slider whose
  // configuration cannot be trusted yields no rules; `checkSliderConfiguration` rejects its answers instead.
  const config = readSliderConfig(element);
  if (config === null) {
    return rules;
  }

  rules.push(
    {
      id: "__implicit_slider_min__",
      type: "minValue",
      params: { min: config.min },
    } as TValidationRule,
    {
      id: "__implicit_slider_max__",
      type: "maxValue",
      params: { max: config.max },
    } as TValidationRule,
    {
      id: "__implicit_slider_step__",
      type: "stepMultipleOf",
      params: { step: config.step, offset: config.min },
    } as TValidationRule
  );

  return rules;
};

/**
 * Get field value for address/contact info elements
 */
const getFieldValue = (
  rule: TValidationRule,
  element: TSurveyElement,
  elementValue: TResponseDataValue
): TResponseDataValue => {
  if (!rule.field) {
    return elementValue;
  }

  if (element.type === TSurveyElementTypeEnum.Address && Array.isArray(elementValue)) {
    const addressFieldOrder: TAddressField[] = [
      "addressLine1",
      "addressLine2",
      "city",
      "state",
      "zip",
      "country",
    ];
    const fieldIndex = addressFieldOrder.indexOf(rule.field as TAddressField);
    if (fieldIndex >= 0 && fieldIndex < elementValue.length) {
      return elementValue[fieldIndex] ?? "";
    }
  }

  if (element.type === TSurveyElementTypeEnum.ContactInfo && Array.isArray(elementValue)) {
    const contactFieldOrder: TContactInfoField[] = ["firstName", "lastName", "email", "phone", "company"];
    const fieldIndex = contactFieldOrder.indexOf(rule.field as TContactInfoField);
    if (fieldIndex >= 0 && fieldIndex < elementValue.length) {
      return elementValue[fieldIndex] ?? "";
    }
  }

  return "";
};

/**
 * Execute validation rules with OR logic
 */
const executeOrLogic = (
  rules: TValidationRule[],
  element: TSurveyElement,
  value: TResponseDataValue,
  languageCode: string,
  initialErrors: TValidationError[],
  t: TFunction
): TValidationResult => {
  const ruleResults: TValidationError[] = [];

  for (const rule of rules) {
    const validator = validators[rule.type];
    if (!validator) {
      console.warn(`Unknown validation rule type: ${rule.type}`);
      continue;
    }

    const valueToValidate = getFieldValue(rule, element, value);
    const checkResult = validator.check(valueToValidate, rule.params, element);

    if (checkResult.valid) {
      return { valid: initialErrors.length === 0, errors: initialErrors };
    }

    const message = getDefaultErrorMessage(rule, element, languageCode, t);
    ruleResults.push({
      ruleId: rule.id,
      ruleType: rule.type,
      message,
    });
  }

  if (ruleResults.length === 0) {
    return { valid: initialErrors.length === 0, errors: initialErrors };
  }

  return { valid: false, errors: [...initialErrors, ...ruleResults] };
};

/**
 * Execute validation rules with AND logic
 */
const executeAndLogic = (
  rules: TValidationRule[],
  element: TSurveyElement,
  value: TResponseDataValue,
  languageCode: string,
  initialErrors: TValidationError[],
  t: TFunction
): TValidationResult => {
  const errors = [...initialErrors];

  for (const rule of rules) {
    const validator = validators[rule.type];
    if (!validator) {
      console.warn(`Unknown validation rule type: ${rule.type}`);
      continue;
    }

    const valueToValidate = getFieldValue(rule, element, value);
    const checkResult = validator.check(valueToValidate, rule.params, element);

    if (!checkResult.valid) {
      const message = getDefaultErrorMessage(rule, element, languageCode, t);
      errors.push({
        ruleId: rule.id,
        ruleType: rule.type,
        message,
      });
    }
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Single entrypoint for validating an element's response value.
 * Called by block-conditional.tsx during form submission.
 *
 * @param element - The survey element being validated
 * @param value - The response value for this element
 * @param languageCode - Current language code for error messages
 * @returns Validation result with valid flag and array of errors
 */
export const validateElementResponse = (
  element: TSurveyElement,
  value: TResponseDataValue,
  languageCode: string
): TValidationResult => {
  const errors: TValidationError[] = [];
  // Always create translation function from surveys package's i18n instance
  const t: TFunction = getTranslations(languageCode);

  // Check if element is required (separate from validation rules)
  const requiredError = checkRequiredField(element, value, t);
  if (requiredError) {
    errors.push(requiredError);
  }

  // The slider's structural gates run before any rule, and whichever of the two fires ends the evaluation:
  // one mistake earns one error, and the rules would only restate it - or, on a value with no numeric
  // meaning at all, add the contradictory pair "at least {min}" and "no greater than {max}". Reached only
  // when the required check stayed silent, so an unanswered required slider still reports exactly one
  // "required" error.
  if (!requiredError) {
    const sliderError =
      checkSliderValueType(element, value, t) ?? checkSliderConfiguration(element, value, t);
    if (sliderError) {
      errors.push(sliderError);
      return { valid: false, errors };
    }
  }

  // Validation rules apply to matrix elements regardless of required status

  // Get validation rules. A slider's constraints are intrinsic rather than author-configured, so any
  // `validation` block carried by one is discarded: that is what keeps the three injected rules from being
  // replaced by a same-type rule or short-circuited by `logic: "or"`.
  const validation =
    element.type === TSurveyElementTypeEnum.Slider
      ? undefined
      : (element as TSurveyElement & { validation?: { rules?: TValidationRule[]; logic?: "and" | "or" } })
          .validation;
  let rules: TValidationRule[] = [...(validation?.rules ?? [])];

  // Add implicit rules based on element type
  rules = addImplicitOpenTextRules(element, rules);
  rules = addImplicitContactInfoRules(element, rules);
  rules = addImplicitSliderRules(element, rules);

  if (rules.length === 0) {
    return { valid: errors.length === 0, errors };
  }

  const validationLogic = validation?.logic ?? "and";

  if (validationLogic === "or") {
    return executeOrLogic(rules, element, value, languageCode, errors, t);
  }

  return executeAndLogic(rules, element, value, languageCode, errors, t);
};

/**
 * Validate all elements in a block, returning an error map.
 *
 * @param elements - Array of elements to validate
 * @param responses - Response data keyed by element ID
 * @param languageCode - Current language code for error messages
 * @returns Map of element IDs to their validation errors
 */
export const validateBlockResponses = (
  elements: TSurveyElement[],
  responses: TResponseData,
  languageCode: string
): TValidationErrorMap => {
  const errorMap: TValidationErrorMap = {};
  for (const element of elements) {
    const result = validateElementResponse(element, responses[element.id], languageCode);
    if (!result.valid) {
      errorMap[element.id] = result.errors;
    }
  }

  return errorMap;
};

/**
 * Get the first error message for an element from the error map.
 * Useful for UI components that only display one error at a time.
 *
 * @param errorMap - The validation error map
 * @param elementId - The element ID to get error for
 * @returns The first error message or undefined
 */
export const getFirstErrorMessage = (
  errorMap: TValidationErrorMap,
  elementId: string
): string | undefined => {
  const errors = errorMap[elementId];
  return errors?.[0]?.message;
};
