import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { cookieSecurity, supabaseConfig } from "./lib/config";

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`;
  const forwarded = new Headers(request.headers);
  forwarded.set("x-nonce", nonce);
  forwarded.set("Content-Security-Policy", csp);
  let response = NextResponse.next({ request: { headers: forwarded } });
  // These handlers own Auth and its deadline, including any cookie refresh.
  const verifiesSessionInHandler =
    (request.nextUrl.pathname === "/api/session" && request.method === "POST") ||
    request.nextUrl.pathname === "/api/research-export";
  if (
    !verifiesSessionInHandler &&
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_PUBLISHABLE_KEY
  ) {
    const { url, key } = supabaseConfig();
    const client = createServerClient(url, key, {
      cookieOptions: cookieSecurity(),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values, cacheHeaders) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          forwarded.set("cookie", request.cookies.toString());
          response = NextResponse.next({ request: { headers: forwarded } });
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, {
              ...options,
              ...cookieSecurity(),
            }),
          );
          Object.entries(cacheHeaders || {}).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    });
    // Refresh verified sessions for rendering. Protected pages and APIs also
    // check the profile and enforce authorization through the audited RPC.
    await client.auth.getUser();
  }
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
