import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Keeps the Supabase auth session alive. Without this, the short-lived access token
// is never refreshed on normal navigation/reloads, so admins & shoppers get logged
// out "randomly" once it expires. Running getUser() here rotates the token and writes
// the refreshed cookies on every matched request. (Supabase SSR recommended pattern.)
export async function middleware(request) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return response; // not configured → nothing to refresh

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Triggers a refresh if the access token is close to / past expiry, and persists
  // the rotated tokens via setAll above. Errors are non-fatal (e.g. no session).
  try { await supabase.auth.getUser(); } catch { /* no session — carry on */ }

  return response;
}

// Run on app pages and API routes, but skip static assets and the engine/image files.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sudhalaya.js|brand-logo.png|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map)$).*)",
  ],
};
