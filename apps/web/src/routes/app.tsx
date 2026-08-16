import { config } from "@automend/shared";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppHeader } from "@/components/app/app-header";
import { authClient } from "@/lib/auth-client";
import { buildSignInSearch } from "@/lib/redirects";

const { routes } = config.webClient;

function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <AppHeader />
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}

export const Route = createFileRoute("/app")({
  /**
   * Checked before the page renders rather than inside it, so an unauthenticated visitor never
   * sees a flash of the app before being sent away — and lands back where they were headed once
   * they have signed in.
   *
   * This is a convenience, not the security boundary: the API authorises every request itself and
   * nothing here can be trusted by it.
   */
  beforeLoad: async ({ location }) => {
    const { data } = await authClient.getSession();

    if (!data) {
      throw redirect({ to: routes.signIn, search: buildSignInSearch(location.pathname) });
    }
  },
  component: AppLayout,
});
