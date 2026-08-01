import { z } from "zod";

// Field types for field-specific validation (address and contact info elements)
export const ZAddressField = z.enum(["addressLine1", "addressLine2", "city", "state", "zip", "country"]);
export type TAddressField = z.infer<typeof ZAddressField>;

export const ZContactInfoField = z.enum(["firstName", "lastName", "email", "phone", "company"]);
export type TContactInfoField = z.infer<typeof ZContactInfoField>;

// Union type for all possible field types
export const ZValidationRuleField = z.union([ZAddressField, ZContactInfoField]);
export type TValidationRuleField = z.infer<typeof ZValidationRuleField>;

// Validation rule type enum - extensible for future rule types
export const ZValidationRuleType = z.enum([
  // Text/OpenText rules
  "minLength",
  "maxLength",
  "pattern",
  "email",
  "url",
  "phone",
  "equals",
  "doesNotEqual",
  "contains",
  "doesNotContain",

  // Numeric rules
  "minValue",
  "maxValue",
  "isGreaterThan",
  "isLessThan",
  "stepMultipleOf",

  // Selection rules (MultiSelect)
  "minSelections",
  "maxSelections",

  // Ranking rules
  "minRanked",
  "rankAll",

  // Matrix rules
  "minRowsAnswered",
  "answerAllRows",

  // Date rules
  "isLaterThan",
  "isEarlierThan",
  "isBetween",
  "isNotBetween",

  // File upload rules
  "fileExtensionIs",
  "fileExtensionIsNot",
]);

export type TValidationRuleType = z.infer<typeof ZValidationRuleType>;

// Rule params - union for type-safe params per rule type (type is now at rule level)
export const ZValidationRuleParamsMinLength = z.object({
  min: z.number().min(0),
});

export const ZValidationRuleParamsMaxLength = z.object({
  max: z.number().min(1),
});

export const ZValidationRuleParamsPattern = z.object({
  pattern: z.string().min(1),
  flags: z.string().optional(),
});

// Use strict() to prevent these empty objects from matching any object in unions
// Without strict(), z.object({}) is non-strict and accepts extra properties, defeating union discrimination
export const ZValidationRuleParamsEmail = z.object({}).strict();

export const ZValidationRuleParamsUrl = z.object({}).strict();

export const ZValidationRuleParamsPhone = z.object({}).strict();

export const ZValidationRuleParamsMinValue = z.object({
  min: z.number(),
});

export const ZValidationRuleParamsMaxValue = z.object({
  max: z.number(),
});

// `offset` anchors the `step` grid at a non-zero origin - min=10/step=5 accepts 15 but rejects 12 - and
// defaults to 0 when omitted. Both fields are constrained here because a grid is only defined for a finite,
// strictly positive step and a finite origin; the validator then fails closed on params it cannot evaluate,
// while the owning element schema still reports the single author-facing "Step must be greater than zero".
export const ZValidationRuleParamsStepMultipleOf = z.object({
  step: z.number().finite().positive(),
  offset: z.number().finite().optional(),
});

export const ZValidationRuleParamsMinSelections = z.object({
  min: z.number().min(1),
});

export const ZValidationRuleParamsMaxSelections = z.object({
  max: z.number().min(1),
});

export const ZValidationRuleParamsEquals = z.object({
  value: z.string(),
});

export const ZValidationRuleParamsDoesNotEqual = z.object({
  value: z.string(),
});

export const ZValidationRuleParamsContains = z.object({
  value: z.string(),
});

export const ZValidationRuleParamsDoesNotContain = z.object({
  value: z.string(),
});

export const ZValidationRuleParamsIsGreaterThan = z.object({
  min: z.number(),
});

export const ZValidationRuleParamsIsLessThan = z.object({
  max: z.number(),
});

export const ZValidationRuleParamsIsLaterThan = z.object({
  date: z.string(), // YYYY-MM-DD format
});

export const ZValidationRuleParamsIsEarlierThan = z.object({
  date: z.string(), // YYYY-MM-DD format
});

export const ZValidationRuleParamsIsBetween = z.object({
  startDate: z.string(), // YYYY-MM-DD format
  endDate: z.string(), // YYYY-MM-DD format
});

export const ZValidationRuleParamsIsNotBetween = z.object({
  startDate: z.string(), // YYYY-MM-DD format
  endDate: z.string(), // YYYY-MM-DD format
});

export const ZValidationRuleParamsMinRanked = z.object({
  min: z.number().min(1),
});

export const ZValidationRuleParamsRankAll = z.object({}).strict();
export const ZValidationRuleParamsAnswerAllRows = z.object({}).strict();

export const ZValidationRuleParamsMinRowsAnswered = z.object({
  min: z.number().min(1),
});

// File upload rule params
export const ZValidationRuleParamsFileExtensionIs = z.object({
  extensions: z.array(z.string()).min(1),
});

export const ZValidationRuleParamsFileExtensionIsNot = z.object({
  extensions: z.array(z.string()).min(1),
});

// Union of all params types
export const ZValidationRuleParams = z.union([
  ZValidationRuleParamsMinLength,
  ZValidationRuleParamsMaxLength,
  ZValidationRuleParamsPattern,
  ZValidationRuleParamsEmail,
  ZValidationRuleParamsUrl,
  ZValidationRuleParamsPhone,
  ZValidationRuleParamsEquals,
  ZValidationRuleParamsDoesNotEqual,
  ZValidationRuleParamsContains,
  ZValidationRuleParamsDoesNotContain,
  ZValidationRuleParamsMinValue,
  ZValidationRuleParamsMaxValue,
  ZValidationRuleParamsIsGreaterThan,
  ZValidationRuleParamsIsLessThan,
  ZValidationRuleParamsMinSelections,
  ZValidationRuleParamsMaxSelections,
  ZValidationRuleParamsIsLaterThan,
  ZValidationRuleParamsIsEarlierThan,
  ZValidationRuleParamsIsBetween,
  ZValidationRuleParamsIsNotBetween,
  ZValidationRuleParamsMinRanked,
  ZValidationRuleParamsRankAll,
  ZValidationRuleParamsMinRowsAnswered,
  ZValidationRuleParamsAnswerAllRows,
  ZValidationRuleParamsFileExtensionIs,
  ZValidationRuleParamsFileExtensionIsNot,
  ZValidationRuleParamsStepMultipleOf,
]);

export type TValidationRuleParams = z.infer<typeof ZValidationRuleParams>;

// Extract specific param types for validators
export type TValidationRuleParamsMinLength = z.infer<typeof ZValidationRuleParamsMinLength>;
export type TValidationRuleParamsMaxLength = z.infer<typeof ZValidationRuleParamsMaxLength>;
export type TValidationRuleParamsPattern = z.infer<typeof ZValidationRuleParamsPattern>;
export type TValidationRuleParamsEmail = z.infer<typeof ZValidationRuleParamsEmail>;
export type TValidationRuleParamsUrl = z.infer<typeof ZValidationRuleParamsUrl>;
export type TValidationRuleParamsPhone = z.infer<typeof ZValidationRuleParamsPhone>;
export type TValidationRuleParamsMinValue = z.infer<typeof ZValidationRuleParamsMinValue>;
export type TValidationRuleParamsMaxValue = z.infer<typeof ZValidationRuleParamsMaxValue>;
export type TValidationRuleParamsMinSelections = z.infer<typeof ZValidationRuleParamsMinSelections>;
export type TValidationRuleParamsMaxSelections = z.infer<typeof ZValidationRuleParamsMaxSelections>;
export type TValidationRuleParamsEquals = z.infer<typeof ZValidationRuleParamsEquals>;
export type TValidationRuleParamsDoesNotEqual = z.infer<typeof ZValidationRuleParamsDoesNotEqual>;
export type TValidationRuleParamsContains = z.infer<typeof ZValidationRuleParamsContains>;
export type TValidationRuleParamsDoesNotContain = z.infer<typeof ZValidationRuleParamsDoesNotContain>;
export type TValidationRuleParamsIsGreaterThan = z.infer<typeof ZValidationRuleParamsIsGreaterThan>;
export type TValidationRuleParamsIsLessThan = z.infer<typeof ZValidationRuleParamsIsLessThan>;
export type TValidationRuleParamsIsLaterThan = z.infer<typeof ZValidationRuleParamsIsLaterThan>;
export type TValidationRuleParamsIsEarlierThan = z.infer<typeof ZValidationRuleParamsIsEarlierThan>;
export type TValidationRuleParamsIsBetween = z.infer<typeof ZValidationRuleParamsIsBetween>;
export type TValidationRuleParamsIsNotBetween = z.infer<typeof ZValidationRuleParamsIsNotBetween>;
export type TValidationRuleParamsMinRanked = z.infer<typeof ZValidationRuleParamsMinRanked>;
export type TValidationRuleParamsRankAll = z.infer<typeof ZValidationRuleParamsRankAll>;
export type TValidationRuleParamsMinRowsAnswered = z.infer<typeof ZValidationRuleParamsMinRowsAnswered>;
export type TValidationRuleParamsAnswerAllRows = z.infer<typeof ZValidationRuleParamsAnswerAllRows>;
export type TValidationRuleParamsFileExtensionIs = z.infer<typeof ZValidationRuleParamsFileExtensionIs>;
export type TValidationRuleParamsFileExtensionIsNot = z.infer<typeof ZValidationRuleParamsFileExtensionIsNot>;
export type TValidationRuleParamsStepMultipleOf = z.infer<typeof ZValidationRuleParamsStepMultipleOf>;

// Validation rule stored on element - discriminated union with type at top level
// Field property is optional and used for address/contact info elements to target specific sub-fields
export const ZValidationRule = z.object({
  id: z.string(),
  type: ZValidationRuleType,
  params: ZValidationRuleParams,
  field: ZValidationRuleField.optional(),
});

export type TValidationRule = z.infer<typeof ZValidationRule>;

// Array of validation rules.
// `params` is a plain (non-discriminated) union, so on its own it only proves that the params match
// *some* rule type - `{ type: "stepMultipleOf", params: { min: 1 } }` satisfies it through the minValue
// member, and the grid validator would then receive a cast object carrying no `step` at all. Grid
// alignment is a security constraint (it is what rejects off-grid values posted straight to the response
// endpoints), so the type/params pairing is verified here and fails closed instead of reaching the
// validator as an unchecked cast. Only `stepMultipleOf` is coupled: every other rule type keeps its
// existing behaviour byte-for-byte.
// The explicit annotation is required rather than stylistic: refining this schema widens its inferred
// type past the compiler's serialization limit, which surfaces as TS7056 in `js.ts` (that module embeds
// the survey schemas). Annotating the export keeps the emitted type compact.
export const ZValidationRules: z.ZodType<TValidationRule[], z.ZodTypeDef, TValidationRule[]> = z
  .array(ZValidationRule)
  .superRefine((rules, ctx) => {
    rules.forEach((rule, index) => {
      if (rule.type !== "stepMultipleOf") {
        return;
      }

      if (!ZValidationRuleParamsStepMultipleOf.safeParse(rule.params).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "stepMultipleOf requires a finite positive step and, when present, a finite offset",
          path: [index, "params"],
        });
      }
    });
  });

export type TValidationRules = z.infer<typeof ZValidationRules>;

// Applicable rules per element type - const arrays for type inference (must be defined before types)
const OPEN_TEXT_RULES = [
  "minLength",
  "maxLength",
  "pattern",
  "email",
  "url",
  "phone",
  "equals",
  "doesNotEqual",
  "contains",
  "doesNotContain",
  "minValue",
  "maxValue",
  "isGreaterThan",
  "isLessThan",
] as const;

const MULTIPLE_CHOICE_MULTI_RULES = ["minSelections", "maxSelections"] as const;
const PICTURE_SELECTION_RULES = ["minSelections", "maxSelections"] as const;
const DATE_RULES = ["isLaterThan", "isEarlierThan", "isBetween", "isNotBetween"] as const;
const MATRIX_RULES = ["minRowsAnswered", "answerAllRows"] as const;
const RANKING_RULES = ["minRanked", "rankAll"] as const;
// Note: fileSizeAtLeast and fileSizeAtMost are not included because they cannot be validated
// from response URLs alone (responses only contain file URLs, not file metadata).
// File size validation happens client-side during upload via element.maxSizeInMB.
const FILE_UPLOAD_RULES = ["fileExtensionIs", "fileExtensionIsNot"] as const;
// Address and Contact Info can use text-based validation rules on specific fields
const ADDRESS_RULES = [
  "minLength",
  "maxLength",
  "pattern",
  "email",
  "url",
  "phone",
  "equals",
  "doesNotEqual",
  "contains",
  "doesNotContain",
] as const;
const CONTACT_INFO_RULES = [
  "minLength",
  "maxLength",
  "pattern",
  "email",
  "url",
  "phone",
  "equals",
  "doesNotEqual",
  "contains",
  "doesNotContain",
] as const;

// Applicable rules per element type
// Note: pictureSelection rules are handled dynamically in getAvailableRuleTypes based on allowMulti
export const APPLICABLE_RULES: Record<string, TValidationRuleType[]> = {
  openText: [...OPEN_TEXT_RULES],
  multipleChoiceMulti: [...MULTIPLE_CHOICE_MULTI_RULES],
  date: [...DATE_RULES],
  matrix: [...MATRIX_RULES],
  ranking: [...RANKING_RULES],
  fileUpload: [...FILE_UPLOAD_RULES],
  pictureSelection: [...PICTURE_SELECTION_RULES],
  address: [...ADDRESS_RULES],
  contactInfo: [...CONTACT_INFO_RULES],
  payment: ["minValue", "maxValue"],
  opinionScale: [],
  // Intentionally empty, mirroring opinionScale: a slider's range and step-grid constraints are
  // intrinsic to its configuration rather than author-selectable.
  slider: [],
};

// Type helper to filter validation rules by allowed types
export type TValidationRuleForElementType<T extends TValidationRuleType> = Extract<
  TValidationRule,
  { type: T }
>;

// Type helper to get validation rules array for specific element type
export type TValidationRulesForElementType<T extends readonly TValidationRuleType[]> =
  TValidationRuleForElementType<T[number]>[];

// Specific validation rule types for each element type
export type TValidationRulesForOpenText = TValidationRulesForElementType<typeof OPEN_TEXT_RULES>;
export type TValidationRulesForMultipleChoiceMulti = TValidationRulesForElementType<
  typeof MULTIPLE_CHOICE_MULTI_RULES
>;
export type TValidationRulesForDate = TValidationRulesForElementType<typeof DATE_RULES>;
export type TValidationRulesForMatrix = TValidationRulesForElementType<typeof MATRIX_RULES>;
export type TValidationRulesForRanking = TValidationRulesForElementType<typeof RANKING_RULES>;
export type TValidationRulesForFileUpload = TValidationRulesForElementType<typeof FILE_UPLOAD_RULES>;
export type TValidationRulesForAddress = TValidationRulesForElementType<typeof ADDRESS_RULES>;
export type TValidationRulesForContactInfo = TValidationRulesForElementType<typeof CONTACT_INFO_RULES>;

// Validation error returned by evaluator
export interface TValidationError {
  ruleId: string;
  ruleType: TValidationRuleType;
  message: string;
}

// Validation result for a single element
export interface TValidationResult {
  valid: boolean;
  errors: TValidationError[];
}

// Error map for block-level validation (keyed by elementId)
export type TValidationErrorMap = Record<string, TValidationError[]>;

/**
 * Result of a validator check
 */
export interface TValidatorCheckResult {
  valid: boolean;
}
