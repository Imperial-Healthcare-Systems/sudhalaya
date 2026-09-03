import Script from "next/script";
import { getAdminSupabase, hasServiceRole } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/supabase/server";

/*
 * Faithful port of the Suddhalaya single-file storefront.
 *
 * The original app renders EVERYTHING imperatively: renderSite()/renderAdmin()
 * inject HTML into these empty container divs, and inline onclick="fn()" handlers
 * call ~197 global functions. To preserve that behaviour 1:1, the engine is served
 * verbatim from /public/sudhalaya.js and loaded as a classic (non-module) script,
 * so every function lands on window and the inline handlers resolve.
 */

// Always render fresh so the injected CMS (below) is current — kills the "old logo /
// hero for ~2s, then it fixes" flash: the engine reads window.__SUDDHALAYA_CMS__ on
// its very first paint instead of the built-in defaults.
export const dynamic = "force-dynamic";

async function getInjectedCMS() {
  try {
    if (!isConfigured() || !hasServiceRole()) return null;
    const db = getAdminSupabase();
    const { data } = await db.from("app_config").select("value").eq("key", "cms").maybeSingle();
    return data?.value || null;
  } catch {
    return null; // best-effort — engine falls back to defaults + bootstrap as before
  }
}

export default async function Home() {
  const cms = await getInjectedCMS();
  const cmsJson = cms ? JSON.stringify(cms).replace(/</g, "\\u003c") : null;

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      {/* Live CMS injected server-side, in the HTML before the engine script, so the
          engine's first render already uses the admin's current logo / hero / About
          content. A plain inline <script> runs during initial parse (before the
          afterInteractive engine below), which is exactly the ordering we need. */}
      {cmsJson ? (
        // eslint-disable-next-line react/no-danger
        <script dangerouslySetInnerHTML={{ __html: `window.__SUDDHALAYA_CMS__=${cmsJson};` }} />
      ) : null}

      <div id="siteView" suppressHydrationWarning>
        {/* Branded loading splash — shows the real logo when we have it, replaced the
            moment the engine renders the storefront (no white blank, no wrong logo). */}
        <div className="boot-splash" id="bootSplash">
          <div className="boot-splash-inner">
            {cms && cms.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cms.logo} alt="Suddhalaya" style={{ maxHeight: 64, marginBottom: 8 }} />
            ) : (
              <div className="boot-logo">Suddhalaya</div>
            )}
            <div className="boot-tag">House of Purity</div>
            <div className="boot-spinner" aria-hidden="true" />
          </div>
        </div>
      </div>
      <div id="loginView" suppressHydrationWarning />
      <div id="adminView" suppressHydrationWarning />
      <div
        id="toast"
        className="toast"
        role="status"
        aria-live="polite"
        suppressHydrationWarning
      >
        <span id="toastMsg" />
      </div>

      {/* The storefront + admin engine. afterInteractive => runs after the CMS above
          is set, then boot() takes over. */}
      <Script src="/sudhalaya.js" strategy="afterInteractive" />
    </>
  );
}
