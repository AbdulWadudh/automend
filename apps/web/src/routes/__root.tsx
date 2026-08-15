import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
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

function RootLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <nav className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-4">
          <Link to="/" className="font-semibold tracking-tight">
            Automend
          </Link>
          <span className="text-muted-foreground text-sm">Workflow automation platform</span>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <Outlet />
      </main>

      <Suspense fallback={null}>
        <RouterDevtools position="bottom-right" />
      </Suspense>
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});
