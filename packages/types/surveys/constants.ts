// Element Type Enum (same as question types)
export enum TSurveyElementTypeEnum {
  FileUpload = "fileUpload",
  OpenText = "openText",
  MultipleChoiceSingle = "multipleChoiceSingle",
  MultipleChoiceMulti = "multipleChoiceMulti",
  NPS = "nps",
  CTA = "cta",
  Rating = "rating",
  Consent = "consent",
  PictureSelection = "pictureSelection",
  Cal = "cal",
  Date = "date",
  Matrix = "matrix",
  Address = "address",
  Ranking = "ranking",
  ContactInfo = "contactInfo",
  Payment = "payment",
  OpinionScale = "opinionScale",
  Slider = "slider",
}

/**
 * Largest decimal scale the `stepMultipleOf` grid test can restate exactly.
 *
 * 10 ** 309 is Infinity, so an operand needing more than this many decimal places cannot be lifted to a
 * whole-number scale and no residual can be measured against it. The limit is therefore a property of the
 * double itself and must never be raised to buy headroom: past 308 the comparison would silently start
 * passing every value, turning a fail-closed check into a fail-open one. 300 keeps a deliberate margin
 * below that cliff.
 *
 * Like `TSurveyElementTypeEnum` above, this lives in `constants.ts` rather than beside the rule's Zod
 * schemas in `validation-rules.ts` so that the respondent-facing validation bundle - which needs the value
 * but none of the schemas - does not pull Zod in with it.
 */
export const MAX_GRID_DECIMAL_SCALE = 300;

// A finite double always prints as [-]digits[.digits][e(+|-)digits] - "0.2", "1e-7", "1.5e+21" - so these
// groups describe every operand the grid test can be handed. Only the fraction and the exponent are
// captured, because they are the two parts that decide how many decimal places the value needs.
const DECIMAL_NOTATION_PATTERN = /^-?\d+(?:\.(?<fraction>\d+))?(?:e(?<exponent>[+-]\d+))?$/i;

/**
 * Number of decimal places needed to state `value` exactly, or null when it has no such representation.
 *
 * The count is taken from the shortest decimal string that round-trips back to the same double - the decimal
 * a survey author typed and a respondent sees, `0.2` rather than the binary fraction
 * 0.200000000000000011102230246251565... A negative result means a positive exponent outran the fraction,
 * i.e. the value is an integer such as 1.5e+21 and needs no decimal places at all.
 *
 * Exported because presentation code needs the same answer the grid test uses: a Slider summary derives how
 * many decimals to display from the scale of the configured step, so that a step of 0.0001 is reported at
 * the precision the author chose rather than rounded away. Deriving that from this one definition is what
 * keeps the displayed precision and the validated grid describing the same number.
 */
export const getDecimalScale = (value: number): number | null => {
  if (!Number.isFinite(value)) {
    return null;
  }

  const match = DECIMAL_NOTATION_PATTERN.exec(String(value));
  if (!match) {
    return null;
  }

  const fraction = match.groups?.fraction ?? "";
  const exponent = match.groups?.exponent ?? "0";
  return Math.max(0, fraction.length - Number(exponent));
};

/**
 * Whether the `stepMultipleOf` grid test can restate `value` exactly, i.e. whether it needs no more than
 * MAX_GRID_DECIMAL_SCALE decimal places.
 *
 * Both sides of the grid contract call this one predicate: the validator to decide whether it can judge an
 * operand at all, and the element schema to refuse publishing a configuration on which no answer could ever
 * be validated. Sharing it is what keeps "what the schema admits, the grid test can judge" true by
 * construction rather than by coincidence.
 */
export const isWithinGridDecimalScale = (value: number): boolean => {
  const scale = getDecimalScale(value);
  return scale !== null && scale <= MAX_GRID_DECIMAL_SCALE;
};
