import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
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
 * Deliberately bare. Each area brings its own frame — the public site in `_marketing`, the signed-in
 * app in `app` — because a shared header that has to know which one it is in belongs to neither.
 */
function RootLayout() {
  return (
    <>
      <Outlet />

      <Suspense fallback={null}>
        <RouterDevtools position="bottom-right" />
      </Suspense>
    </>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});
