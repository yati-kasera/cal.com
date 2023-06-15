import { get } from "@vercel/edge-config";
import { collectEvents } from "next-collect/server";
import type { NextMiddleware } from "next/server";
import { NextResponse, userAgent } from "next/server";

import { orgDomainConfig } from "@calcom/features/ee/organizations/lib/orgDomains";
import { CONSOLE_URL, WEBAPP_URL, WEBSITE_URL } from "@calcom/lib/constants";
import { isIpInBanlist } from "@calcom/lib/getIP";
import { extendEventData, nextCollectBasicSettings } from "@calcom/lib/telemetry";

const middleware: NextMiddleware = async (req) => {
  const url = req.nextUrl;
  const requestHeaders = new Headers(req.headers);
  const { currentOrgDomain, isValidOrgDomain } = orgDomainConfig(req.headers.get("host") ?? "");
  const isEmbedRequest = typeof url.searchParams.get("embed") === "string";

  /**
   * We are using env variable to toggle new-booker because using flags would be an unnecessary delay for booking pages
   * Also, we can't easily identify the booker page requests here(to just fetch the flags for those requests)
   */
  // Enable New Booker for All but embed Requests
  if (process.env.NEW_BOOKER_ENABLED_FOR_NON_EMBED === "1" && !isEmbedRequest) {
    req.cookies.set("new-booker-enabled", "1");
    requestHeaders.set("new-booker-enabled", "1");
  }

  // Enable New Booker for Embed Requests
  if (process.env.NEW_BOOKER_ENABLED_FOR_EMBED === "1" && isEmbedRequest) {
    req.cookies.set("new-booker-enabled", "1");
    requestHeaders.set("new-booker-enabled", "1");
  }

  // Make sure we are in the presence of an organization
  if (isValidOrgDomain && url.pathname === "/") {
    // In the presence of an organization, cover its profile page at "/"
    // rewrites for org profile page using team profile page
    url.pathname = `/org/${currentOrgDomain}`;
    return NextResponse.rewrite(url);
  }

  if (isIpInBanlist(req) && url.pathname !== "/api/nope") {
    // DDOS Prevention: Immediately end request with no response - Avoids a redirect as well initiated by NextAuth on invalid callback
    req.nextUrl.pathname = "/api/nope";
    return NextResponse.redirect(req.nextUrl);
  }

  if (isIpInBanlist(req) && url.pathname !== "/api/nope") {
    // DDOS Prevention: Immediately end request with no response - Avoids a redirect as well initiated by NextAuth on invalid callback
    req.nextUrl.pathname = "/api/nope";
    return NextResponse.redirect(req.nextUrl);
  }

  if (!url.pathname.startsWith("/api")) {
    //
    // NOTE: When tRPC hits an error a 500 is returned, when this is received
    //       by the application the user is automatically redirected to /auth/login.
    //
    //     - For this reason our matchers are sufficient for an app-wide maintenance page.
    //
    try {
      // Check whether the maintenance page should be shown
      const isInMaintenanceMode = await get<boolean>("isInMaintenanceMode");
      // If is in maintenance mode, point the url pathname to the maintenance page
      if (isInMaintenanceMode) {
        req.nextUrl.pathname = `/maintenance`;
        return NextResponse.rewrite(req.nextUrl);
      }
    } catch (error) {
      // show the default page if EDGE_CONFIG env var is missing,
      // but log the error to the console
      // console.error(error);
    }
  }

  if (["/api/collect-events", "/api/auth"].some((p) => url.pathname.startsWith(p))) {
    const callbackUrl = url.searchParams.get("callbackUrl");
    const { isBot } = userAgent(req);

    if (
      isBot ||
      (callbackUrl && ![CONSOLE_URL, WEBAPP_URL, WEBSITE_URL].some((u) => callbackUrl.startsWith(u))) ||
      isIpInBanlist(req)
    ) {
      // DDOS Prevention: Immediately end request with no response - Avoids a redirect as well initiated by NextAuth on invalid callback
      req.nextUrl.pathname = "/api/nope";
      return NextResponse.redirect(req.nextUrl);
    }
  }

  // Ensure that embed query param is there in when /embed is added.
  // query param is the way in which client side code knows that it is in embed mode.
  if (url.pathname.endsWith("/embed") && typeof url.searchParams.get("embed") !== "string") {
    url.searchParams.set("embed", "");
    return NextResponse.redirect(url);
  }

  // Don't 404 old routing_forms links
  if (url.pathname.startsWith("/apps/routing_forms")) {
    url.pathname = url.pathname.replace("/apps/routing_forms", "/apps/routing-forms");
    return NextResponse.rewrite(url);
  }

  if (url.pathname.startsWith("/api/trpc/")) {
    requestHeaders.set("x-cal-timezone", req.headers.get("x-vercel-ip-timezone") ?? "");
  }

  if (url.pathname.startsWith("/auth/login")) {
    // Use this header to actually enforce CSP, otherwise it is running in Report Only mode on all pages.
    requestHeaders.set("x-csp-enforce", "true");
  }

  if (isValidOrgDomain) {
    // Match /:slug to determine if it corresponds to org subteam slug or org user slug
    const slugs = /^\/([^/]+)(\/[^/]+)?$/.exec(url.pathname);
    // In the presence of an organization, if not team profile, a user or team is being accessed
    if (slugs) {
      const [_, teamName, eventType] = slugs;
      // Fetch the corresponding subteams for the entered organization
      const getSubteams = await fetch(`${WEBAPP_URL}/api/organizations/${currentOrgDomain}/subteams`);
      if (getSubteams.ok) {
        const data = await getSubteams.json();
        // Treat entered slug as a team if found in the subteams fetched
        if (data.slugs.includes(teamName)) {
          // Rewriting towards /team/:slug to bring up the team profile within the org
          url.pathname = `/team/${teamName}${eventType ?? ""}`;
          return NextResponse.rewrite(url);
        }
      }
    }
  }

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
};

export const config = {
  matcher: [
    "/:path*",
    "/api/collect-events/:path*",
    "/api/auth/:path*",
    "/apps/routing_forms/:path*",
    "/:path*/embed",
    "/api/trpc/:path*",
    "/auth/login",
  ],
};

export default collectEvents({
  middleware,
  ...nextCollectBasicSettings,
  cookieName: "__clnds",
  extend: extendEventData,
});
