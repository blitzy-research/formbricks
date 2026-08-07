/**
 * Unit tests for the request proxy, focused on the opaque-origin boundary it enforces.
 *
 * Server Actions are protected against cross-site request forgery by comparing `Origin` with the host, but
 * the framework skips that comparison for the literal value `null` - it reads an opaque origin as *no*
 * origin and dispatches the action anyway, even though a request from a *named* foreign origin is correctly
 * aborted. The proxy therefore refuses an unsafe request to an authenticated route that declares an opaque
 * origin, before the action can be decoded.
 *
 * The guard has to be narrow, and most of these tests exist to pin that narrowness: an opaque origin is
 * legitimate on the client API (the embedded survey SDK is loaded into arbitrary documents) and on any safe
 * method, so only the intersection of "unsafe method", "authenticated route" and "opaque origin" is refused.
 *
 * Coverage:
 *  1. Opaque origin + unsafe method + authenticated route -> 403
 *  2. Every unsafe method is covered, not just POST
 *  3. All three authenticated route prefixes are covered
 *  4. Same-origin and named-foreign-origin requests are passed through unchanged
 *  5. Safe methods are passed through, even with an opaque origin
 *  6. The API surface and the respondent survey routes are passed through, even with an opaque origin
 *  7. An absent `Origin` is passed through
 *  8. The pre-existing auth redirect, callback-url validation and request-id behaviour still work
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared before the proxy module is imported
// ---------------------------------------------------------------------------

vi.mock("@formbricks/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

// The shared test setup stands `WEBAPP_URL` up as a bare label, and the login redirect this module builds
// has to be an absolute URL for the framework to accept it, so it is given one here. `WEBAPP_URL` is the only
// constant this module reads.
vi.mock("@/lib/constants", () => ({ WEBAPP_URL: "http://localhost:3000" }));

// The public-domain split is a separate concern; keeping it off isolates the origin boundary.
vi.mock("@/app/middleware/domain-utils", () => ({
  isPublicDomainConfigured: vi.fn().mockReturnValue(false),
  isRequestFromPublicDomain: vi.fn().mockReturnValue(false),
}));

const { getToken } = await import("next-auth/jwt");
const { proxy } = await import("./proxy");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EDITOR_PATH = "/environments/cm0000000000000000000env/surveys/cm0000000000000000survey/edit";

/** Builds a request for the proxy. `origin` of `null` means the header is omitted entirely. */
const buildRequest = (
  path: string,
  { method = "POST", origin }: { method?: string; origin?: string } = {}
): NextRequest => {
  const headers = new Headers();
  if (origin !== undefined) headers.set("origin", origin);
  return new NextRequest(`http://localhost:3000${path}`, { method, headers });
};

/**
 * Whether the proxy let the request continue.
 *
 * A pass-through is `NextResponse.next()`, which the framework marks with `x-middleware-next`; every
 * rejection is an ordinary response without it.
 */
const wasPassedThrough = (response: Response): boolean => response.headers.get("x-middleware-next") === "1";

describe("proxy", () => {
  beforeEach(() => {
    // Authenticated by default: the boundary under test is reached only by a request that carries a session,
    // and an unauthenticated one would be redirected to the login page first.
    vi.mocked(getToken).mockResolvedValue({ email: "admin@example.com" } as never);
  });

  // -------------------------------------------------------------------------
  // What the guard refuses
  // -------------------------------------------------------------------------

  test("refuses an opaque-origin Server Action request to the survey editor", async () => {
    const response = await proxy(buildRequest(EDITOR_PATH, { origin: "null" }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "Forbidden" });
    expect(wasPassedThrough(response)).toBe(false);
  });

  test("refuses it before the session is even read, so nothing downstream runs", async () => {
    // The rejection is the whole response: no action is decoded, and no handler decides anything.
    await proxy(buildRequest(EDITOR_PATH, { origin: "null" }));

    expect(getToken).not.toHaveBeenCalled();
  });

  test.each(["POST", "PUT", "PATCH", "DELETE"])("refuses an opaque-origin %s request", async (method) => {
    const response = await proxy(buildRequest(EDITOR_PATH, { method, origin: "null" }));

    expect(response.status).toBe(403);
  });

  test.each(["/environments/env-1/surveys", "/setup/organization/create", "/organizations/org-1"])(
    "refuses an opaque-origin request to %s",
    async (path) => {
      const response = await proxy(buildRequest(path, { origin: "null" }));

      expect(response.status).toBe(403);
    }
  );

  // -------------------------------------------------------------------------
  // What the guard must NOT refuse
  // -------------------------------------------------------------------------

  test("passes a same-origin Server Action request through", async () => {
    const response = await proxy(buildRequest(EDITOR_PATH, { origin: "http://localhost:3000" }));

    expect(response.status).toBe(200);
    expect(wasPassedThrough(response)).toBe(true);
  });

  test("leaves a named foreign origin to the framework's own comparison", async () => {
    // A named origin CAN be compared with the host, and the framework already aborts the action when they
    // disagree. Refusing it here as well would move that decision without improving it.
    const response = await proxy(buildRequest(EDITOR_PATH, { origin: "https://evil.example.com" }));

    expect(response.status).toBe(200);
    expect(wasPassedThrough(response)).toBe(true);
  });

  test.each(["GET", "HEAD", "OPTIONS"])(
    "passes an opaque-origin %s request through, because it changes nothing",
    async (method) => {
      const response = await proxy(buildRequest(EDITOR_PATH, { method, origin: "null" }));

      expect(response.status).toBe(200);
      expect(wasPassedThrough(response)).toBe(true);
    }
  );

  test.each([
    "/api/v1/client/cm0000000000000000000env/responses",
    "/api/v2/client/cm0000000000000000000env/responses",
    "/api/v1/client/cm0000000000000000000env/displays",
    "/api/v1/management/responses",
  ])("passes an opaque-origin POST to %s through", async (path) => {
    // The survey SDK is loaded into documents the platform does not control, so an opaque origin is a normal
    // condition there. These endpoints authenticate by key and declare their own CORS policy.
    const response = await proxy(buildRequest(path, { origin: "null" }));

    expect(response.status).toBe(200);
    expect(wasPassedThrough(response)).toBe(true);
  });

  test("passes an opaque-origin POST to a respondent survey route through", async () => {
    const response = await proxy(buildRequest("/s/cm0000000000000000survey", { origin: "null" }));

    expect(response.status).toBe(200);
    expect(wasPassedThrough(response)).toBe(true);
  });

  test("passes a request that declares no origin at all through", async () => {
    // A browser always sends `Origin` for an unsafe request, so its absence describes a non-browser caller
    // rather than a forged one.
    const response = await proxy(buildRequest(EDITOR_PATH));

    expect(response.status).toBe(200);
    expect(wasPassedThrough(response)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Pre-existing behaviour, unchanged
  // -------------------------------------------------------------------------

  test("still redirects an unauthenticated request to an authenticated route", async () => {
    vi.mocked(getToken).mockResolvedValue(null);

    const response = await proxy(buildRequest(EDITOR_PATH, { method: "GET" }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/auth/login?callbackUrl=");
  });

  test("still rejects an invalid callback url", async () => {
    const response = await proxy(
      buildRequest(`${EDITOR_PATH}?callbackUrl=https%3A%2F%2Fevil.example.com`, { method: "GET" })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Invalid callback URL" });
  });

  test("still stamps a request id onto a passed-through request", async () => {
    const response = await proxy(buildRequest("/s/cm0000000000000000survey", { method: "GET" }));

    expect(wasPassedThrough(response)).toBe(true);
    expect(response.headers.get("x-middleware-override-headers")).toContain("x-request-id");
  });
});
