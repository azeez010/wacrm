import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

// --- Scenario knobs the mock reads -----------------------------------------
// `mockUser`         - what getUser() resolves to (a refreshed session ⇒ user,
//                      or null for the logged-out path).
// `refreshedCookies` - cookies Supabase writes via setAll() during getUser(),
//                      i.e. the freshly *rotated* auth token. The whole point
//                      of the test is that these must survive onto whatever
//                      response the middleware returns - including redirects.
let mockUser: { id: string } | null = null;
let refreshedCookies: Array<{
  name: string;
  value: string;
  options: Record<string, unknown>;
}> = [];

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { setAll: (c: typeof refreshedCookies) => void };
    },
  ) => ({
    auth: {
      // Mirrors real auth-js: an expired access token is transparently
      // refreshed inside getUser(), which rotates the refresh token and
      // pushes the new cookies through setAll() before resolving.
      getUser: async () => {
        if (refreshedCookies.length) opts.cookies.setAll(refreshedCookies);
        return { data: { user: mockUser } };
      },
    },
  }),
}));

// Imported after the mock is registered.
const { middleware } = await import("./middleware");

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mockUser = null;
  refreshedCookies = [];
});

afterEach(() => vi.clearAllMocks());

const ROTATED = {
  name: "sb-test-auth-token",
  value: "rotated-refresh-token",
  options: { path: "/", httpOnly: true },
};

describe("middleware, refreshed auth cookies survive redirects", () => {
  it("carries the rotated token when redirecting a signed-in user off /login", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login"),
    );

    // Redirect to /dashboard…
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
    // …and the rotated cookie MUST ride along, otherwise the browser keeps
    // replaying the now-consumed refresh token and the session wedges until
    // the user manually clears cookies.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("carries the rotated token when redirecting an unauth user to /login", async () => {
    mockUser = null;
    // Even on the logged-out path getUser() may emit cookie writes (e.g.
    // clearing a dead session); those must not be dropped on the redirect.
    refreshedCookies = [{ ...ROTATED, value: "cleared" }];

    const res = await middleware(
      new NextRequest("https://app.test/dashboard"),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.cookies.get(ROTATED.name)?.value).toBe("cleared");
  });

  it("redirects a signed-in user with an invite token to /join/<token>", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login?invite=abc123"),
    );

    expect(res.headers.get("location")).toContain("/join/abc123");
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("passes through (no redirect) for a signed-in user on a protected page", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/dashboard"),
    );

    // No redirect - the normal NextResponse.next() already carries cookies.
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });
});

describe("middleware, every dashboard route requires a session", () => {
  // Read the route group rather than hard-coding a list, so a new page added
  // under src/app/(dashboard)/ fails here until it is added to
  // protectedPaths. /flows, /agents and /notifications were missed that way
  // and rendered a broken page to signed-out visitors instead of redirecting.
  const dashboardRoutes = readdirSync(join(__dirname, "app", "(dashboard)"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `/${entry.name}`);

  it("finds the dashboard route group", () => {
    expect(dashboardRoutes).toContain("/dashboard");
  });

  it.each(dashboardRoutes)("redirects a signed-out visitor from %s to /login", async (route) => {
    mockUser = null;

    const res = await middleware(new NextRequest(`https://app.test${route}`));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });
});

describe("middleware, path-based language on the landing page", () => {
  it("serves / and /<locale> through next-intl (no login redirect, language set)", async () => {
    for (const path of ["/", "/fr", "/ko"]) {
      const res = await middleware(new NextRequest(`https://app.test${path}`));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
    const fr = await middleware(new NextRequest("https://app.test/fr"));
    expect(fr.headers.get("x-middleware-request-x-next-intl-locale")).toBe("fr");
  });

  it("redirects the explicit default-language prefix to the bare URL", async () => {
    const res = await middleware(new NextRequest("https://app.test/en"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/");
  });

  it("leaves non-landing paths (even under a language prefix) to the normal flow", async () => {
    mockUser = null;
    const res = await middleware(new NextRequest("https://app.test/fr/dashboard"));
    // Not a protected path as written, so it passes through untouched.
    expect(res.headers.get("x-middleware-request-x-next-intl-locale")).toBeNull();
  });
});

describe("middleware, referral cookie", () => {
  it("remembers ?ref= on a public page and leaves other requests alone", async () => {
    const withRef = await middleware(new NextRequest("https://app.test/?ref=AMAKA"));
    expect(withRef.cookies.get("ogadesk_ref")?.value).toBe("AMAKA");
    const without = await middleware(new NextRequest("https://app.test/"));
    expect(without.cookies.get("ogadesk_ref")).toBeUndefined();
  });
});

describe("middleware, localized blog, changelog and help", () => {
  it("serves /<lang>/blog from the one blog route and tells next-intl the language", async () => {
    const res = await middleware(new NextRequest("https://app.test/fr/blog/page/2"));
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://app.test/blog/page/2");
    expect(res.headers.get("x-middleware-request-x-next-intl-locale")).toBe("fr");
  });

  it("pins an unprefixed URL to the default language whatever the cookie says", async () => {
    const res = await middleware(new NextRequest("https://app.test/help/getting-started", { headers: { cookie: "NEXT_LOCALE=ko" } }));
    expect(res.headers.get("x-middleware-request-x-next-intl-locale")).toBe("en");
  });

  it("redirects the explicit default-language prefix to the bare URL", async () => {
    const res = await middleware(new NextRequest("https://app.test/en/changelog"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://app.test/changelog");
  });
});
