/**
 * Unit tests for the error contract of GET /api/v1/management/responses.
 *
 * The collection endpoint accepts `surveyId` from the query string and hands it straight to the survey
 * lookup, which validates its input and throws a `ValidationError` for anything that is not a cuid2. That
 * error used to escape the handler and be reported by the wrapper's catch-all as HTTP 500 - telling the
 * caller the server had failed when in fact their query string had, and diverging from the v2 collection,
 * which answers the same input with a validation error. These tests pin the mapping in place.
 *
 * The handler is exercised directly: the wrapper that normally surrounds it owns authentication, rate
 * limiting and audit logging, none of which this contract depends on, so it is replaced with a pass-through
 * (see the mock below) and the handler is called with the authentication it would have been given.
 *
 * Coverage:
 *  1. Malformed `surveyId` -> 400 `bad_request`, no internal detail
 *  2. SQL-metacharacter `surveyId` -> 400 `bad_request`
 *  3. A well-formed but unknown `surveyId` -> 404 (unchanged)
 *  4. A survey in another environment -> 401 (unchanged)
 *  5. A valid `surveyId` -> 200 with that survey's responses (unchanged)
 *  6. No `surveyId` -> 200 with every permitted environment's responses (unchanged)
 *  7. A `DatabaseError` from the lookup -> 400 (unchanged)
 *  8. Any other error -> rethrown to the wrapper (unchanged)
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DatabaseError, ValidationError } from "@formbricks/types/errors";
import { getSurvey } from "@/lib/survey/service";
import { hasPermission } from "@/modules/organization/settings/api-keys/lib/utils";
import { getResponses, getResponsesByEnvironmentIds } from "./lib/response";

// ---------------------------------------------------------------------------
// Mocks — declared before the route module is imported
// ---------------------------------------------------------------------------

vi.mock("@formbricks/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Pass-through wrapper, so the handler under test is the exported `GET`. The real wrapper adds
// authentication, rate limiting and audit logging around this handler; the error contract asserted here is
// the handler's own, and reproducing that surrounding machinery would test the wrapper instead.
vi.mock("@/app/lib/api/with-api-logging", () => ({
  withV1ApiWrapper: ({ handler }: { handler: unknown }) => handler,
}));

vi.mock("@/lib/survey/service", () => ({ getSurvey: vi.fn() }));

vi.mock("./lib/response", () => ({
  getResponses: vi.fn(),
  getResponsesByEnvironmentIds: vi.fn(),
  createResponseWithQuotaEvaluation: vi.fn(),
}));

vi.mock("@/modules/organization/settings/api-keys/lib/utils", () => ({ hasPermission: vi.fn() }));

vi.mock("@/modules/storage/utils", () => ({
  resolveStorageUrlsInObject: (value: unknown) => value,
  validateFileUploads: vi.fn().mockReturnValue(true),
}));

vi.mock("@/app/lib/pipelines", () => ({ sendToPipeline: vi.fn() }));

// Imported after the mocks so the pass-through wrapper is the one the module uses.
const { GET } = await import("./route");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The handler shape the pass-through wrapper leaves behind. */
type Handler = (params: {
  req: NextRequest;
  authentication: { environmentPermissions: { environmentId: string }[] };
}) => Promise<{ response: Response }>;

const ENVIRONMENT_ID = "cm0000000000000000000env";
const SURVEY_ID = "cm0000000000000000survey";

const authentication = { environmentPermissions: [{ environmentId: ENVIRONMENT_ID }] };

/** Calls the collection handler with the given query string. */
const callGet = async (query: string): Promise<Response> => {
  const req = new NextRequest(`http://localhost:3000/api/v1/management/responses${query}`);
  const { response } = await (GET as unknown as Handler)({ req, authentication });
  return response;
};

const buildResponse = (id: string) => ({
  id,
  surveyId: SURVEY_ID,
  data: { elementId: 42 },
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});

describe("GET /api/v1/management/responses", () => {
  beforeEach(() => {
    vi.mocked(hasPermission).mockReturnValue(true);
  });

  test("answers a malformed surveyId with a bad request rather than a server error", async () => {
    // The survey lookup validates its own input, so a non-cuid2 id never reaches the database. Reporting it
    // as a server error blamed the server for the caller's query string.
    vi.mocked(getSurvey).mockRejectedValue(new ValidationError("Validation failed: Invalid cuid2"));

    const response = await callGet("?surveyId=not-a-cuid&limit=10");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("bad_request");
    expect(body.message).toBe("Validation failed: Invalid cuid2");
    // Nothing internal travels with it - no stack, no query, no connection detail.
    expect(JSON.stringify(body)).not.toMatch(/prisma|postgres|stack|at Object\./i);
  });

  test("answers a surveyId carrying SQL metacharacters the same way", async () => {
    vi.mocked(getSurvey).mockRejectedValue(new ValidationError("Validation failed: Invalid cuid2"));

    const response = await callGet("?surveyId=%27%20OR%201%3D1%20--&limit=10");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("bad_request");
    // The id is validated before any query is built, so it is never interpolated anywhere.
    expect(getResponses).not.toHaveBeenCalled();
  });

  test("still answers a well-formed but unknown surveyId with not found", async () => {
    vi.mocked(getSurvey).mockResolvedValue(null);

    const response = await callGet(`?surveyId=${SURVEY_ID}`);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe("not_found");
  });

  test("still refuses a survey the key has no permission for", async () => {
    vi.mocked(getSurvey).mockResolvedValue({ id: SURVEY_ID, environmentId: "other-environment" } as never);
    vi.mocked(hasPermission).mockReturnValue(false);

    const response = await callGet(`?surveyId=${SURVEY_ID}`);

    expect(response.status).toBe(401);
    expect(getResponses).not.toHaveBeenCalled();
  });

  test("still returns the responses of a valid survey", async () => {
    vi.mocked(getSurvey).mockResolvedValue({ id: SURVEY_ID, environmentId: ENVIRONMENT_ID } as never);
    vi.mocked(getResponses).mockResolvedValue([buildResponse("response-1")] as never);

    const response = await callGet(`?surveyId=${SURVEY_ID}&limit=10&skip=5`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("response-1");
    expect(getResponses).toHaveBeenCalledWith(SURVEY_ID, 10, 5);
  });

  test("still returns every permitted environment's responses when no surveyId is given", async () => {
    vi.mocked(getResponsesByEnvironmentIds).mockResolvedValue([buildResponse("response-2")] as never);

    const response = await callGet("");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(getResponsesByEnvironmentIds).toHaveBeenCalledWith([ENVIRONMENT_ID], undefined, undefined);
    expect(getSurvey).not.toHaveBeenCalled();
  });

  test("still answers a database error with a bad request", async () => {
    vi.mocked(getSurvey).mockRejectedValue(new DatabaseError("relation does not exist"));

    const response = await callGet(`?surveyId=${SURVEY_ID}`);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe("relation does not exist");
  });

  test("still lets an unrecognised error reach the wrapper", async () => {
    // Anything the handler cannot classify stays a server error, reported once by the wrapper.
    vi.mocked(getSurvey).mockRejectedValue(new Error("boom"));

    await expect(callGet(`?surveyId=${SURVEY_ID}`)).rejects.toThrow("boom");
  });
});
