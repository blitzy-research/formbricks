import { v7 as uuidv7 } from "uuid";
import {
  TTypeformAnswer,
  TTypeformCompatiblePayload,
  TTypeformFieldDefinition,
  TTypeformVariable,
} from "@formbricks/database/zod/webhook-payload";
import { TResponse } from "@formbricks/types/responses";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import { TSurvey } from "@formbricks/types/surveys/types";
import { getElementsFromBlocks } from "@/lib/survey/utils";

// ---------------------------------------------------------------------------
// Element Type to Typeform Type Mapping
// ---------------------------------------------------------------------------

/**
 * Maps each of the 18 Formbricks element types to corresponding Typeform-compatible
 * field type string and answer type string.
 *
 * For PictureSelection the default answerType is "choice" (single-select).
 * The dynamic override to "choices" (multi-select) is handled in transformAnswer()
 * based on the element's `allowMulti` property.
 */
const ELEMENT_TYPE_TO_TYPEFORM_MAP: Record<string, { fieldType: string; answerType: string }> = {
  [TSurveyElementTypeEnum.OpenText]: { fieldType: "short_text", answerType: "text" },
  [TSurveyElementTypeEnum.MultipleChoiceSingle]: { fieldType: "multiple_choice", answerType: "choice" },
  [TSurveyElementTypeEnum.MultipleChoiceMulti]: { fieldType: "multiple_choice", answerType: "choices" },
  [TSurveyElementTypeEnum.Rating]: { fieldType: "rating", answerType: "number" },
  [TSurveyElementTypeEnum.OpinionScale]: { fieldType: "opinion_scale", answerType: "number" },
  [TSurveyElementTypeEnum.NPS]: { fieldType: "nps", answerType: "number" },
  [TSurveyElementTypeEnum.Consent]: { fieldType: "yes_no", answerType: "boolean" },
  [TSurveyElementTypeEnum.Date]: { fieldType: "date", answerType: "date" },
  [TSurveyElementTypeEnum.FileUpload]: { fieldType: "file_upload", answerType: "file_url" },
  [TSurveyElementTypeEnum.Cal]: { fieldType: "cal", answerType: "text" },
  [TSurveyElementTypeEnum.Matrix]: { fieldType: "matrix", answerType: "text" },
  [TSurveyElementTypeEnum.Address]: { fieldType: "address", answerType: "text" },
  [TSurveyElementTypeEnum.ContactInfo]: { fieldType: "contact_info", answerType: "text" },
  [TSurveyElementTypeEnum.Ranking]: { fieldType: "ranking", answerType: "choices" },
  [TSurveyElementTypeEnum.PictureSelection]: { fieldType: "picture_choice", answerType: "choice" },
  [TSurveyElementTypeEnum.Payment]: { fieldType: "payment", answerType: "payment" },
  [TSurveyElementTypeEnum.CTA]: { fieldType: "yes_no", answerType: "boolean" },
  [TSurveyElementTypeEnum.Slider]: { fieldType: "number", answerType: "number" },
};

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Builds the definition.fields array from survey elements.
 * Each element is mapped to a TTypeformFieldDefinition containing id, title, type, and ref.
 *
 * @param survey - The full TSurvey object with blocks containing elements
 * @returns Array of Typeform-compatible field definitions
 */
const buildDefinitionFields = (survey: TSurvey): TTypeformFieldDefinition[] => {
  const elements = getElementsFromBlocks(survey.blocks);
  return elements.map((element) => {
    const mapping = ELEMENT_TYPE_TO_TYPEFORM_MAP[element.type];
    const fieldType = mapping?.fieldType ?? element.type;

    // headline is a TI18nString (Record<string, string>) that always has a "default" key
    const title = element.headline?.default ?? element.headline?.[Object.keys(element.headline)[0]] ?? "";

    return {
      id: element.id,
      title,
      type: fieldType,
      ref: element.id,
    };
  });
};

/**
 * Element types whose stored answer has historically been tolerated as a numeric string.
 *
 * These three predate the slider and `computeScore` already parses a stored `"5"` for them, so the same
 * tolerance is preserved here rather than silently narrowed - a response saved before this change must keep
 * publishing the same answer. The slider is deliberately absent: its answer contract is exactly one number
 * and the shared evaluator now rejects every other shape at ingress, so a string in a slider's slot can only
 * be corruption.
 */
const NUMERIC_STRING_TOLERANT_TYPES: readonly string[] = [
  TSurveyElementTypeEnum.Rating,
  TSurveyElementTypeEnum.NPS,
  TSurveyElementTypeEnum.OpinionScale,
];

/**
 * Resolves a stored response value into the finite number a numeric answer requires, or null when no such
 * number exists.
 *
 * Coercing with `Number()` was unsafe in both directions. It fabricated values the respondent never chose -
 * `Number("")` and `Number([])` are both `0`, and for a slider whose range starts at 0 that is
 * indistinguishable from a real answer - and it produced values that cannot be published, since `Number({})`
 * is `NaN`, which has no JSON representation and is rejected outright by `ZTypeformCompatiblePayload`.
 * Returning null lets the caller omit the answer instead, which is already how an unanswered question is
 * represented, so a consumer sees "no answer" rather than a plausible wrong one. That also keeps this
 * boundary in agreement with the shared response validator, whose emptiness contract counts `undefined`,
 * `null`, `""`, `[]` and `{}` as unanswered, while `definition.fields` still advertises the field.
 *
 * @param elementType - The TSurveyElementTypeEnum value string, which decides string tolerance
 * @param responseValue - The raw response value from response.data
 * @returns The finite number to publish, or null when the value is not a publishable number
 */
const resolveNumericAnswer = (elementType: string, responseValue: unknown): number | null => {
  if (typeof responseValue === "number") {
    // Rejects NaN and +/-Infinity, neither of which a respondent can select or a payload can carry.
    return Number.isFinite(responseValue) ? responseValue : null;
  }

  if (typeof responseValue === "string" && NUMERIC_STRING_TOLERANT_TYPES.includes(elementType)) {
    const trimmed = responseValue.trim();
    // An empty or whitespace-only string is an absent answer, not the zero `Number("")` would have produced.
    if (trimmed === "") {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // Arrays, records, booleans and non-numeric strings have no numeric reading at all.
  return null;
};

/**
 * Transforms a single response data value into a Typeform-compatible answer object.
 * Returns null if the response value is undefined/null (question was not answered),
 * if the element type has no known mapping, or if a numeric answer cannot be resolved
 * to a finite number.
 *
 * Handles all 18 element types including:
 * - text types: openText, cal, matrix, address, contactInfo
 * - number types: rating, opinionScale, nps, slider
 * - boolean types: consent ("accepted" → true), cta ("clicked" → true)
 * - choice: multipleChoiceSingle, pictureSelection (single)
 * - choices: multipleChoiceMulti, ranking, pictureSelection (multi)
 * - date: date
 * - file_url: fileUpload
 * - payment: payment
 *
 * @param elementId - The element/question ID
 * @param elementType - The TSurveyElementTypeEnum value string
 * @param responseValue - The raw response value from response.data
 * @param element - The full element object for accessing type-specific properties
 * @returns TTypeformAnswer or null if value is absent / type is unmapped / number is not finite
 */
const transformAnswer = (
  elementId: string,
  elementType: string,
  responseValue: unknown,
  element: Record<string, unknown>
): TTypeformAnswer | null => {
  if (responseValue === undefined || responseValue === null) {
    return null;
  }

  const mapping = ELEMENT_TYPE_TO_TYPEFORM_MAP[elementType];
  if (!mapping) {
    return null;
  }

  const fieldType = mapping.fieldType;
  let answerType = mapping.answerType;

  // Dynamic override for PictureSelection: multi-select uses "choices" instead of "choice"
  if (
    elementType === TSurveyElementTypeEnum.PictureSelection &&
    (element as Record<string, unknown>).allowMulti === true
  ) {
    answerType = "choices";
  }

  const baseAnswer: TTypeformAnswer = {
    field: {
      id: elementId,
      type: fieldType,
      ref: elementId,
    },
    type: answerType as TTypeformAnswer["type"],
  };

  // Populate the type-specific value field based on the resolved answerType
  switch (answerType) {
    case "text": {
      // Applies to: openText, cal, matrix, address, contactInfo
      // Matrix responses are Record<string, string> — stringify for flat text representation
      if (typeof responseValue === "object" && !Array.isArray(responseValue)) {
        baseAnswer.text = JSON.stringify(responseValue);
      } else {
        baseAnswer.text = String(responseValue);
      }
      break;
    }

    case "number": {
      // Applies to: rating, opinionScale, nps, slider
      const numericAnswer = resolveNumericAnswer(elementType, responseValue);
      if (numericAnswer === null) {
        // Omit the whole answer rather than publish a fabricated or unrepresentable one. This matches how an
        // unanswered question is already reported, so no consumer has to distinguish a new failure mode.
        return null;
      }

      baseAnswer.number = numericAnswer;
      break;
    }

    case "boolean": {
      // Applies to: consent ("accepted" → true), cta ("clicked" → true)
      // Any other value is treated as false
      baseAnswer.boolean = responseValue === "accepted" || responseValue === "clicked";
      break;
    }

    case "choice": {
      // Applies to: multipleChoiceSingle, pictureSelection (single select)
      // PictureSelection single may return an array with one element
      if (Array.isArray(responseValue)) {
        baseAnswer.choice = { label: String(responseValue[0] ?? "") };
      } else {
        baseAnswer.choice = { label: String(responseValue) };
      }
      break;
    }

    case "choices": {
      // Applies to: multipleChoiceMulti, ranking, pictureSelection (multi select)
      if (Array.isArray(responseValue)) {
        baseAnswer.choices = { labels: responseValue.map(String) };
      } else {
        baseAnswer.choices = { labels: [String(responseValue)] };
      }
      break;
    }

    case "date": {
      // Applies to: date element — value is an ISO date string
      baseAnswer.date = String(responseValue);
      break;
    }

    case "file_url": {
      // Applies to: fileUpload — response is a string[] of URLs
      // Use the first URL; fallback to empty string if array is empty
      if (Array.isArray(responseValue)) {
        baseAnswer.file_url = responseValue[0] ? String(responseValue[0]) : "";
      } else {
        baseAnswer.file_url = String(responseValue);
      }
      break;
    }

    case "payment": {
      // Applies to: payment element — response is { status, amount, currency }
      // Extract structured payment data; fall back to defaults for missing fields
      if (typeof responseValue === "object" && responseValue !== null && !Array.isArray(responseValue)) {
        const paymentData = responseValue as Record<string, unknown>;
        baseAnswer.payment = {
          amount: String(paymentData.amount ?? "0"),
          currency: String(paymentData.currency ?? (element as Record<string, unknown>).currency ?? "usd"),
          status: String(paymentData.status ?? "unknown"),
        };
      } else {
        baseAnswer.payment = { amount: "0", currency: "usd", status: "unknown" };
      }
      break;
    }
  }

  return baseAnswer;
};

/**
 * Extracts hidden field values from response data.
 * Hidden fields are identified by the survey's hiddenFields.fieldIds array and are
 * separated into their own object rather than appearing in the answers array.
 *
 * @param resolvedResponseData - Response data with storage URLs resolved
 * @param survey - The full TSurvey object containing hiddenFields configuration
 * @returns Key-value map of hidden field IDs to their string values
 */
const extractHiddenFields = (
  resolvedResponseData: Record<string, unknown>,
  survey: TSurvey
): Record<string, string> => {
  const hidden: Record<string, string> = {};
  const hiddenFieldIds = survey.hiddenFields?.fieldIds ?? [];

  for (const fieldId of hiddenFieldIds) {
    const value = resolvedResponseData[fieldId];
    if (value !== undefined && value !== null) {
      hidden[fieldId] = String(value);
    }
  }

  return hidden;
};

/**
 * Restructures response variables into a Typeform-compatible typed variable array.
 * Each variable receives a key (the variable name), a type discriminator ("number" or "text"),
 * and the corresponding typed value field.
 *
 * @param response - The full TResponse object containing variable values
 * @param survey - The full TSurvey object containing variable definitions
 * @returns Array of Typeform-compatible typed variable objects
 */
const buildVariables = (response: TResponse, survey: TSurvey): TTypeformVariable[] => {
  if (!survey.variables || survey.variables.length === 0) {
    return [];
  }

  return survey.variables
    .filter((variable) => response.variables[variable.id] !== undefined)
    .map((variable) => {
      const value = response.variables[variable.id];

      if (typeof value === "number") {
        return {
          key: variable.name,
          type: "number" as const,
          number: value,
        };
      }

      return {
        key: variable.name,
        type: "text" as const,
        text: String(value),
      };
    });
};

/**
 * Computes a calculated response score by summing all numeric response values
 * from rating, NPS, and opinion scale elements.
 *
 * Score computation logic:
 * 1. Iterate over all survey elements
 * 2. For numeric-type elements (Rating, NPS, OpinionScale), extract the response value
 * 3. Parse string values to numbers when needed
 * 4. Sum all valid numeric values
 *
 * @param response - The full TResponse object containing response data
 * @param survey - The full TSurvey object containing element definitions
 * @returns The computed numeric score (0 if no numeric responses exist)
 */
const computeScore = (response: TResponse, survey: TSurvey): number => {
  let score = 0;
  const elements = getElementsFromBlocks(survey.blocks);

  const numericTypes: string[] = [
    TSurveyElementTypeEnum.Rating,
    TSurveyElementTypeEnum.NPS,
    TSurveyElementTypeEnum.OpinionScale,
  ];

  for (const element of elements) {
    if (numericTypes.includes(element.type)) {
      const value = response.data[element.id];

      if (typeof value === "number") {
        score += value;
      } else if (typeof value === "string") {
        const parsed = Number(value);
        if (!isNaN(parsed)) {
          score += parsed;
        }
      }
    }
  }

  return score;
};

// ---------------------------------------------------------------------------
// Main Exported Function
// ---------------------------------------------------------------------------

/**
 * Transforms a Formbricks response into a Typeform-compatible webhook payload structure.
 *
 * This is a **PURE FUNCTION** with no side effects — no database calls, no HTTP requests,
 * no logging, no caching. This design enables easy unit testing and predictable behavior.
 *
 * The transformation performs the following steps:
 * 1. Builds a `definition.fields` array from the survey's block elements
 * 2. Converts flat response data into a typed `answers` array (one per answered element)
 * 3. Separates hidden field values into a dedicated `hidden` object
 * 4. Restructures response variables into a typed `variables` array
 * 5. Computes a calculated score from numeric response values
 * 6. Assembles the complete Typeform-compatible payload with event metadata
 *
 * @param response - The full TResponse object from the pipeline
 * @param survey - The full TSurvey object (includes blocks, hiddenFields, variables)
 * @param resolvedResponseData - Response data with storage URLs resolved via resolveStorageUrlsInObject
 * @returns TTypeformCompatiblePayload — the fully transformed webhook payload
 */
export const transformToTypeformPayload = (
  response: TResponse,
  survey: TSurvey,
  resolvedResponseData: Record<string, unknown>
): TTypeformCompatiblePayload => {
  const elements = getElementsFromBlocks(survey.blocks);
  const hiddenFieldIds = new Set(survey.hiddenFields?.fieldIds ?? []);

  // Step 1: Build definition.fields from survey elements
  const definitionFields = buildDefinitionFields(survey);

  // Step 2: Build typed answers array from response data
  // Iterate over survey elements (NOT response data keys) to ensure consistent field ordering.
  // Hidden fields are excluded from answers — they are placed in the dedicated `hidden` object.
  const answers: TTypeformAnswer[] = [];
  for (const element of elements) {
    if (hiddenFieldIds.has(element.id)) {
      continue;
    }

    const responseValue = resolvedResponseData[element.id];
    const answer = transformAnswer(
      element.id,
      element.type,
      responseValue,
      element as unknown as Record<string, unknown>
    );
    if (answer !== null) {
      answers.push(answer);
    }
  }

  // Step 3: Extract hidden fields into dedicated object
  const hidden = extractHiddenFields(resolvedResponseData, survey);

  // Step 4: Build typed variables array
  const variables = buildVariables(response, survey);

  // Step 5: Compute calculated score
  const score = computeScore(response, survey);

  // Step 6: Construct the full Typeform-compatible payload
  const payload: TTypeformCompatiblePayload = {
    event_id: uuidv7(),
    event_type: "form_response",
    form_id: survey.id,
    landed_at: new Date(response.createdAt).toISOString(),
    submitted_at: response.updatedAt
      ? new Date(response.updatedAt).toISOString()
      : new Date(response.createdAt).toISOString(),
    definition: {
      id: survey.id,
      title: survey.name,
      fields: definitionFields,
    },
    answers,
    hidden,
    variables,
    calculated: {
      score,
    },
  };

  return payload;
};
