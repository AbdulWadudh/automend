import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { webEnv } from "@/lib/env";

export type RouterContext = {
  queryClient: QueryClient;
};

/**
 * Devtools are imported lazily and only in development, so they are never pulled into the
 * production bundle.
 */
const RouterDevtools = webEnv.isDev
  ? lazy(async () => {
      const { TanStackRouterDevtools } = await import("@tanstack/react-router-devtools");
      return { default: TanStackRouterDevtools };
    })
  : () => null;

const MAIN_CONTENT_ID = "main-content";

function RootLayout() {
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

      <Suspense fallback={null}>
        <RouterDevtools position="bottom-right" />
      </Suspense>
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});
