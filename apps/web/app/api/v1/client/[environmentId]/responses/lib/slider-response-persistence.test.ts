import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { ZResponse, ZResponseInput } from "@formbricks/types/responses";
import type { TResponseData } from "@formbricks/types/responses";
import type { TSurveyBlock } from "@formbricks/types/surveys/blocks";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import type { TSurveySliderElement } from "@formbricks/types/surveys/elements";
import { getOrganizationByEnvironmentId } from "@/lib/organization/service";
import { validateResponseData } from "@/modules/api/lib/validation";
import { evaluateResponseQuotas } from "@/modules/ee/quotas/lib/evaluation-service";
import { createResponseWithQuotaEvaluation } from "./response";

/**
 * Persistence-boundary coverage for a Slider answer.
 *
 * The feature's acceptance criteria require that a valid in-range, on-grid value of `50` "persists as a
 * number". `slider-element.test.ts` in `packages/surveys` proves the engine accepts it, and
 * `validation-integration.test.ts` proves the server-side gate accepts it, but neither reaches storage: both
 * stop at a schema parse of an in-memory object, so neither could tell a numeric answer from a numeric-looking
 * string once it is written and read back again. A slider answer is the only numeric single-value answer this
 * platform stores, so nothing else in the suite would notice if it were stringified on the way through.
 *
 * This suite closes that gap by driving the real ingress-to-storage path in the order the route drives it:
 *
 *   1. `ZResponseInput` parses the request body, exactly as
 *      `app/api/v1/client/[environmentId]/responses/route.ts` does before it looks at anything else.
 *   2. `validateResponseData` applies the server-side gate every response write route delegates to.
 *   3. `createResponseWithQuotaEvaluation` runs unmocked, and with it `createResponse`, `validateInputs`
 *      against `ZResponseInput` a second time, `calculateTtcTotal`, and `buildPrismaResponseData` - the
 *      function that decides what shape the row actually takes.
 *   4. The row that comes back is read through `ZResponse`, the contract every reader of a response uses.
 *
 * Only the Prisma client and the two lookups that would otherwise need a live database and an enterprise
 * licence are substituted. The value under test is never substituted, and never handled by this file between
 * the body it is placed in and the assertions it is read back out with.
 */

vi.mock("@formbricks/database", () => ({
  prisma: {
    response: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/organization/service", () => ({
  getOrganizationByEnvironmentId: vi.fn(),
}));

vi.mock("@/modules/ee/quotas/lib/evaluation-service", () => ({
  evaluateResponseQuotas: vi.fn(),
}));

vi.mock("./contact", () => ({
  getContactByUserId: vi.fn(),
}));

const ENVIRONMENT_ID = "cm5sliderenv000000000000";
const SURVEY_ID = "cm5slidersurvey000000000";
const RESPONSE_ID = "cm5sliderresponse0000000";
const SLIDER_ID = "sliderElement";

const FIXED_TIMESTAMP = new Date("2026-01-01T00:00:00.000Z");

/** The feature's reference configuration: 0 to 100 in steps of 5, required. */
const buildSliderElement = (overrides: Partial<TSurveySliderElement> = {}): TSurveySliderElement =>
  ({
    id: SLIDER_ID,
    type: TSurveyElementTypeEnum.Slider,
    headline: { default: "How likely are you to recommend us?" },
    required: true,
    range: { min: 0, max: 100 },
    step: 5,
    lowerLabel: { default: "Low" },
    upperLabel: { default: "High" },
    showValue: true,
    ...overrides,
  }) as unknown as TSurveySliderElement;

const buildBlocks = (element: TSurveySliderElement = buildSliderElement()): TSurveyBlock[] =>
  [
    {
      id: "block1",
      name: "Block 1",
      elements: [element],
    },
  ] as unknown as TSurveyBlock[];

/**
 * Every row handed to `prisma.response.create` during the current test, in order.
 *
 * Reading the argument rather than a return value is what makes the write assertions meaningful: it is the
 * literal payload the database would receive, after `buildPrismaResponseData` has had its say.
 */
let writtenRows: Prisma.ResponseCreateInput[] = [];

/**
 * Stand in for the database, and only for the database.
 *
 * The row handed back is deliberately serialized and re-parsed. `Response.data` is a `jsonb` column, so a
 * value that merely looked numeric going in - a string, a `Number` wrapper, something with a `toJSON` - would
 * come back out as a JSON string or a plain object, and the read-back assertions would catch it. Echoing the
 * captured object by reference instead would make those assertions vacuous.
 */
const stubDatabase = (): void => {
  writtenRows = [];

  vi.mocked(prisma.response.create).mockImplementation((async (args: {
    data: Prisma.ResponseCreateInput;
  }) => {
    writtenRows.push(args.data);

    const storedData = JSON.parse(JSON.stringify(args.data.data ?? {})) as TResponseData;
    const storedTtc = JSON.parse(JSON.stringify(args.data.ttc ?? {})) as Record<string, number>;

    return {
      id: RESPONSE_ID,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      surveyId: SURVEY_ID,
      finished: args.data.finished ?? false,
      data: storedData,
      meta: {},
      ttc: storedTtc,
      variables: {},
      contactAttributes: null,
      singleUseId: null,
      language: args.data.language ?? null,
      displayId: null,
      endingId: null,
      contact: null,
      tags: [],
    };
  }) as never);

  // `createResponseWithQuotaEvaluation` opens a transaction and passes the transaction client down, so the
  // capturing mock has to be reachable through it as well as through the client itself.
  vi.mocked(prisma.$transaction).mockImplementation((async (run: (tx: unknown) => Promise<unknown>) =>
    run({ response: { create: prisma.response.create } })) as never);
};

/**
 * Submit one slider answer along the route's own sequence.
 *
 * The persistence step is skipped when the server-side gate reports errors, because that is precisely what the
 * route does: it returns a 400 before `createResponseWithQuotaEvaluation` is ever reached. Preserving that
 * ordering is what lets the rejection cases assert that nothing was written at all.
 */
const submitSliderAnswer = async (answer: unknown, element: TSurveySliderElement = buildSliderElement()) => {
  const parsedInput = ZResponseInput.safeParse({
    environmentId: ENVIRONMENT_ID,
    surveyId: SURVEY_ID,
    finished: true,
    language: "en",
    data: { [SLIDER_ID]: answer },
    ttc: { [SLIDER_ID]: 4200 },
    meta: { source: "link" },
  });

  if (!parsedInput.success) {
    return { accepted: false as const, parsedInput, validationErrors: null, created: null };
  }

  const validationErrors = validateResponseData(
    buildBlocks(element),
    parsedInput.data.data,
    parsedInput.data.language ?? "en"
  );

  if (validationErrors) {
    return { accepted: false as const, parsedInput, validationErrors, created: null };
  }

  const created = await createResponseWithQuotaEvaluation(parsedInput.data);

  return { accepted: true as const, parsedInput, validationErrors, created };
};

describe("a slider answer across the response ingress and persistence boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDatabase();

    vi.mocked(getOrganizationByEnvironmentId).mockResolvedValue({
      id: "cm5sliderorg0000000000000",
      name: "Slider Org",
      billing: { plan: "free", limits: { monthly: { responses: 100, miu: 100 } } },
    } as never);

    vi.mocked(evaluateResponseQuotas).mockResolvedValue({} as never);
  });

  test("(b) the acceptance value of 50 is written and read back as a number", async () => {
    const { accepted, parsedInput, validationErrors, created } = await submitSliderAnswer(50);

    expect(accepted).toBe(true);
    if (!parsedInput.success || created === null) {
      throw new Error("expected the acceptance value to reach persistence");
    }

    // The ingress schema is the first place a numeric answer could quietly become a string, because
    // `ZResponseDataValue` admits both. It does not coerce.
    expect(parsedInput.data.data[SLIDER_ID]).toBe(50);
    expect(typeof parsedInput.data.data[SLIDER_ID]).toBe("number");

    // The server-side gate accepts it, so the route would proceed to write rather than return a 400.
    expect(validationErrors).toBeNull();

    // What the database actually receives, after `buildPrismaResponseData`.
    expect(writtenRows).toHaveLength(1);
    const writtenData = writtenRows[0].data as TResponseData;

    expect(writtenData[SLIDER_ID]).toBe(50);
    expect(typeof writtenData[SLIDER_ID]).toBe("number");
    expect(writtenData[SLIDER_ID]).not.toBe("50");

    // What a reader gets back, after the JSON round-trip the column performs.
    expect(created.data[SLIDER_ID]).toBe(50);
    expect(typeof created.data[SLIDER_ID]).toBe("number");

    // And the row satisfies the response contract every consumer parses with, still as a number.
    const persisted = ZResponse.parse(created);

    expect(persisted.data[SLIDER_ID]).toBe(50);
    expect(typeof persisted.data[SLIDER_ID]).toBe("number");
  });

  test("an answer of 0 at the range minimum persists as the number 0 rather than being dropped", async () => {
    const { created } = await submitSliderAnswer(0);

    if (created === null) {
      throw new Error("expected the minimum to reach persistence");
    }

    // A falsy answer is the case a write path is most likely to lose, and the slider's minimum is routinely 0.
    // The key has to survive as well as the value: an omitted key reads back as an unanswered element.
    const writtenData = writtenRows[0].data as TResponseData;

    expect(Object.keys(writtenData)).toContain(SLIDER_ID);
    expect(writtenData[SLIDER_ID]).toBe(0);
    expect(typeof writtenData[SLIDER_ID]).toBe("number");

    expect(created.data[SLIDER_ID]).toBe(0);
    expect(typeof created.data[SLIDER_ID]).toBe("number");
    expect(ZResponse.parse(created).data[SLIDER_ID]).toBe(0);
  });

  test("a fine-grid answer persists at full precision, unrounded and unformatted", async () => {
    const fineSlider = buildSliderElement({ range: { min: 0, max: 0.001 }, step: 0.0001 });

    const { created } = await submitSliderAnswer(0.0003, fineSlider);

    if (created === null) {
      throw new Error("expected the fine-grid value to reach persistence");
    }

    // Nothing along the write path may round a slider answer to a display precision: the stored value is the
    // input to the summary aggregation, which computes its own precision from the element's configuration.
    expect((writtenRows[0].data as TResponseData)[SLIDER_ID]).toBe(0.0003);
    expect(created.data[SLIDER_ID]).toBe(0.0003);
    expect(typeof created.data[SLIDER_ID]).toBe("number");
  });

  test("a numeric string is refused by the server gate and never written", async () => {
    const { accepted, validationErrors } = await submitSliderAnswer("50");

    expect(accepted).toBe(false);
    // The ingress schema admits a string answer, because other element types submit strings. The refusal is
    // the slider's own type gate, and it happens before the write.
    expect(validationErrors?.[SLIDER_ID][0].ruleId).toBe("sliderValueType");
    expect(validationErrors?.[SLIDER_ID][0].ruleType).toBe("valueType");
    expect(prisma.response.create).not.toHaveBeenCalled();
    expect(writtenRows).toHaveLength(0);
  });

  test("(c) an out-of-range value and an off-grid value are both refused before any write", async () => {
    const outOfRange = await submitSliderAnswer(105);

    expect(outOfRange.accepted).toBe(false);
    expect(outOfRange.validationErrors?.[SLIDER_ID][0].ruleType).toBe("maxValue");

    const offGrid = await submitSliderAnswer(7);

    expect(offGrid.accepted).toBe(false);
    expect(offGrid.validationErrors?.[SLIDER_ID][0].ruleType).toBe("stepMultipleOf");

    expect(prisma.response.create).not.toHaveBeenCalled();
    expect(writtenRows).toHaveLength(0);
  });

  test("(d) a required slider whose key is present with no value is refused before any write", async () => {
    const { accepted, validationErrors } = await submitSliderAnswer("");

    expect(accepted).toBe(false);
    expect(validationErrors?.[SLIDER_ID]).toBeDefined();
    expect(prisma.response.create).not.toHaveBeenCalled();
    expect(writtenRows).toHaveLength(0);
  });
});
