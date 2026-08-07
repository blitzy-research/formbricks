import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { logger } from "@formbricks/logger";
import { isPublicDomainConfigured, isRequestFromPublicDomain } from "@/app/middleware/domain-utils";
import { isAuthProtectedRoute, isRouteAllowedForDomain } from "@/app/middleware/endpoint-validator";
import { WEBAPP_URL } from "@/lib/constants";
import { isValidCallbackUrl } from "@/lib/utils/url";

/**
 * Methods that cannot change state, and are therefore not a request-forgery concern.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The value a browser sends as the origin of a document that has no origin of its own.
 */
const OPAQUE_ORIGIN = "null";

/**
 * Refuses a state-changing request to an authenticated route that declares an opaque origin.
 *
 * Server Actions are protected against cross-site request forgery by comparing the request's `Origin` with
 * its host, but that comparison is skipped entirely for the literal value `null`: the framework reads an
 * opaque origin as *no* origin, warns that the header is missing, and dispatches the action anyway. A
 * document with an opaque origin - one inside a sandboxed frame, or served from a `data:` URL - can
 * therefore reach an authenticated action with the session cookie attached, while the same request from a
 * *named* foreign origin is correctly aborted. Treating "cannot be compared" as "matches" is the gap this
 * closes, and it closes it ahead of action decoding, which is the only place the request can still be
 * refused as a whole.
 *
 * Deliberately narrow, because an opaque origin is not by itself illegitimate:
 * - only unsafe methods, so nothing that merely reads is affected;
 * - only routes that require a session, which is where a forged request has anything to gain and where the
 *   only non-API `POST` is a Server Action;
 * - never the API surface, whose client endpoints are called by the embedded survey SDK from arbitrary -
 *   and legitimately opaque - origins, and which authenticates by key and declares its own CORS policy;
 * - never an absent `Origin`, which a browser always sends for an unsafe request and whose absence
 *   therefore describes a non-browser caller rather than a forged one.
 */
const handleOpaqueOrigin = (request: NextRequest): Response | null => {
  if (SAFE_METHODS.has(request.method)) return null;
  if (request.headers.get("origin") !== OPAQUE_ORIGIN) return null;
  if (!isAuthProtectedRoute(request.nextUrl.pathname)) return null;

  logger.warn(
    { method: request.method, pathname: request.nextUrl.pathname },
    "Rejected a state-changing request carrying an opaque origin"
  );

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
};

const handleAuth = async (request: NextRequest): Promise<Response | null> => {
  const token = await getToken({ req: request as any });

  if (isAuthProtectedRoute(request.nextUrl.pathname) && !token) {
    const loginUrl = `${WEBAPP_URL}/auth/login?callbackUrl=${encodeURIComponent(WEBAPP_URL + request.nextUrl.pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(loginUrl);
  }

  const callbackUrl = request.nextUrl.searchParams.get("callbackUrl");

  if (callbackUrl && !isValidCallbackUrl(callbackUrl, WEBAPP_URL)) {
    return NextResponse.json({ error: "Invalid callback URL" }, { status: 400 });
  }

  if (token && callbackUrl) {
    return NextResponse.redirect(callbackUrl);
  }

  return null;
};

/**
 * Handle domain-aware routing based on PUBLIC_URL and WEBAPP_URL
 */
const handleDomainAwareRouting = (request: NextRequest): Response | null => {
  try {
    const publicDomainConfigured = isPublicDomainConfigured();

    // When PUBLIC_URL is not configured, admin domain allows all routes (backward compatibility)
    if (!publicDomainConfigured) return null;

    const isPublicDomain = isRequestFromPublicDomain(request);

    const pathname = request.nextUrl.pathname;

    // Check if the route is allowed for the current domain
    const isAllowed = isRouteAllowedForDomain(pathname, isPublicDomain);

    if (!isAllowed) {
      return new NextResponse(null, { status: 404 });
    }

    return null; // Allow the request to continue
  } catch (error) {
    logger.error(error, "Error handling domain-aware routing");
    return new NextResponse(null, { status: 404 });
  }
};

export const proxy = async (originalRequest: NextRequest) => {
  // Refuse a forged-looking request before anything else looks at it, so that the rejection is the whole
  // response rather than a decision taken inside the handler it was aimed at.
  const opaqueOriginResponse = handleOpaqueOrigin(originalRequest);
  if (opaqueOriginResponse) return opaqueOriginResponse;

  // Handle domain-aware routing first
  const domainResponse = handleDomainAwareRouting(originalRequest);
  if (domainResponse) return domainResponse;

  // Create a new Request object to override headers and add a unique request ID header
  const request = new NextRequest(originalRequest, {
    headers: new Headers(originalRequest.headers),
  });

  request.headers.set("x-request-id", uuidv4());
  request.headers.set("x-start-time", Date.now().toString());

  // Create a new NextResponse object to forward the new request with headers
  const nextResponseWithCustomHeader = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // Handle authentication
  const authResponse = await handleAuth(request);
  if (authResponse) return authResponse;

  return nextResponseWithCustomHeader;
};

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|js|css|images|fonts|icons|public|animated-bgs).*)",
  ],
};
