import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

const MAIN_CONTENT_ID = "main-content";

/**
 * The public site: the landing page, the legal documents and the status page.
 *
 * A pathless layout, so these pages keep their own addresses (`/`, `/tos`) while the signed-in
 * app under `/app` gets a different frame entirely rather than inheriting the marketing header.
 */
function MarketingLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* Off-screen until focused, so the first Tab on any page can skip the whole nav. */}
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      <SiteHeader />

      <main id={MAIN_CONTENT_ID} className="flex-1">
        <Outlet />
      </main>

      <SiteFooter />
    </div>
  );
}

export const Route = createFileRoute("/_marketing")({
  component: MarketingLayout,
});
