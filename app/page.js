import Script from "next/script";

/*
 * Faithful port of the Suddhalaya single-file storefront.
 *
 * The original app renders EVERYTHING imperatively: renderSite()/renderAdmin()
 * inject HTML into these empty container divs, and inline onclick="fn()" handlers
 * call ~197 global functions. To preserve that behaviour 1:1, the engine is served
 * verbatim from /public/sudhalaya.js and loaded as a classic (non-module) script,
 * so every function lands on window and the inline handlers resolve.
 *
 * These divs are intentionally left for the engine to populate — React renders them
 * once and never reconciles them again (no state here), so the injected DOM is safe.
 * suppressHydrationWarning keeps React quiet about the content the script adds.
 */
export default function Home() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <div id="siteView" suppressHydrationWarning />
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

      {/* The storefront + admin engine. afterInteractive => runs once the page is
          hydrated and the container divs above exist, then boot() takes over. */}
      <Script src="/sudhalaya.js" strategy="afterInteractive" />
    </>
  );
}
