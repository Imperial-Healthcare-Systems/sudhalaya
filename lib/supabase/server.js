import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function isConfigured() {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

// Request-scoped client that carries the shopper's session via httpOnly cookies,
// so RLS sees auth.uid(). Use in Route Handlers.
export async function getServerSupabase() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return store.getAll(); },
        setAll(list) {
          try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {}
        },
      },
    }
  );
}
