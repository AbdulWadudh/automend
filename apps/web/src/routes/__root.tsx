import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
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

/**
 * Deliberately bare of *chrome*. Each area brings its own frame — the public site in `_marketing`, the
 * signed-in app in `app` — because a shared header that has to know which one it is in belongs to neither.
 *
 * `TooltipProvider` is context rather than chrome, and it has to be here: since `shadcn apply`, `Tooltip`
 * no longer carries its own provider, and a tooltip rendered without one throws at render.
 */
function RootLayout() {
  return (
    <TooltipProvider delayDuration={300}>
      <Outlet />
      <Toaster />
      <Suspense fallback={null}>
        <RouterDevtools position="bottom-right" />
      </Suspense>
    </TooltipProvider>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});
