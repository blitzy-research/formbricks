import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";

/**
 * Notion column types every element type may be mapped onto.
 *
 * The mapping UI dereferences this map by element type without a fallback — `MappingRow` calls
 * `TYPE_MAPPING[type].includes(...)` when a pair is selected and `TYPE_MAPPING[type].join(...)` when it
 * reports an incompatible pair — while the element dropdown offers every element of the selected survey.
 * An element type absent from this map is therefore a runtime TypeError rather than a degraded experience,
 * so the `Record` is exhaustive over the element type enum: a new element type cannot compile until it
 * declares the columns it accepts.
 */
export const TYPE_MAPPING: Record<TSurveyElementTypeEnum, string[]> = {
  [TSurveyElementTypeEnum.CTA]: ["checkbox"],
  [TSurveyElementTypeEnum.MultipleChoiceMulti]: ["multi_select"],
  [TSurveyElementTypeEnum.MultipleChoiceSingle]: ["select", "status"],
  [TSurveyElementTypeEnum.OpenText]: [
    "created_by",
    "created_time",
    "email",
    "last_edited_by",
    "last_edited_time",
    "number",
    "phone_number",
    "rich_text",
    "title",
    "url",
  ],
  [TSurveyElementTypeEnum.NPS]: ["number"],
  [TSurveyElementTypeEnum.Consent]: ["checkbox"],
  [TSurveyElementTypeEnum.Rating]: ["number"],
  [TSurveyElementTypeEnum.PictureSelection]: ["url"],
  [TSurveyElementTypeEnum.FileUpload]: ["url"],
  [TSurveyElementTypeEnum.Date]: ["date"],
  [TSurveyElementTypeEnum.Address]: ["rich_text"],
  [TSurveyElementTypeEnum.Matrix]: ["rich_text"],
  [TSurveyElementTypeEnum.Cal]: ["checkbox"],
  [TSurveyElementTypeEnum.ContactInfo]: ["rich_text"],
  [TSurveyElementTypeEnum.Ranking]: ["rich_text"],
  [TSurveyElementTypeEnum.OpinionScale]: ["number"],
  [TSurveyElementTypeEnum.Payment]: ["rich_text"],
  // A slider answer is a single number, exactly like the other numeric element types above.
  [TSurveyElementTypeEnum.Slider]: ["number"],
};

export const UNSUPPORTED_TYPES_BY_NOTION = [
  "rollup",
  "created_by",
  "created_time",
  "last_edited_by",
  "last_edited_time",
];

export const ERRORS = {
  MAPPING: "Mapping Error",
  UNSUPPORTED_TYPE: "Unsupported type by Notion",
};
