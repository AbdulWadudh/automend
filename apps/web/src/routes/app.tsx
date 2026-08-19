import { config } from "@automend/shared";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { buildSignInSearch } from "@/lib/redirects";

const { routes } = config.webClient;

/**
 * The app shell: a sidebar beside a region that is exactly the height of the viewport and scrolls nothing.
 *
 * `h-dvh` and `overflow-hidden` rather than the provider's own `min-h-svh`, because the two behave completely
 * differently once a page has more content than fits: `min-h-svh` lets the shell grow, which makes the
 * *document* the scroll container and takes the sidebar and the flow canvas off-screen with it.
 *
 * `min-h-0` on the inset is not decoration. A flex child's default `min-height: auto` refuses to shrink below
 * its content, so a descendant's `overflow-y-auto` has nothing to overflow *within* and silently does nothing
 * — the single most common reason a scroll container appears not to work.
 *
 * Each page below therefore owns its own scrolling: an ordinary page puts `overflow-y-auto` on its content
 * wrapper, and the flow builder gives each of its panels one.
 */
function AppLayout() {
  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
      <AppSidebar />

      <SidebarInset className="min-h-0 overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
        </header>

        <main className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/app")({
  /**
   * Checked before the page renders rather than inside it, so an unauthenticated visitor never sees a flash of
   * the app before being sent away — and lands back where they were headed once they have signed in.
   *
   * This is a convenience, not the security boundary: the API authorises every request itself and nothing here
   * can be trusted by it.
   */
  beforeLoad: async ({ location }) => {
    const { data } = await authClient.getSession();

    if (!data) {
      throw redirect({ to: routes.signIn, search: buildSignInSearch(location.pathname) });
    }
  },
  component: AppLayout,
});
