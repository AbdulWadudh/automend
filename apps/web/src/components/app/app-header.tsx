import { config } from "@automend/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient, signOut } from "@/lib/auth-client";
import { fetchOpsConsoles, operationsQueryKeys } from "@/lib/operations-api";

const { routes } = config.webClient;

const NAV_LINK_CLASS =
  "rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 data-[status=active]:bg-muted data-[status=active]:text-foreground";

/** `data-status="active"` is set by the router on the link matching the current route. */
const sections = [
  { to: routes.flows, label: "Flows" },
  { to: routes.runs, label: "Runs" },
  { to: routes.connections, label: "Connections" },
];

/**
 * The Operations link, present only on a deployment that has an operator console.
 *
 * Asked of the API rather than assumed, because both consoles are optional: a deployment that
 * configured neither would otherwise carry a permanent nav item leading to two "Not configured" cards.
 * The query is shared with the page itself, so arriving there costs no second request.
 */
function OperationsLink() {
  const consoles = useQuery({
    queryKey: operationsQueryKeys.consoles(),
    queryFn: ({ signal }) => fetchOpsConsoles(signal),
    // A failure here is not worth a retry or an error state — the nav item simply does not appear.
    retry: false,
  });

  if (!consoles.data?.queues.available && !consoles.data?.database.available) {
    return null;
  }

  return (
    <li>
      <Link to={routes.operations} className={NAV_LINK_CLASS}>
        Operations
      </Link>
    </li>
  );
}

/**
 * The workspace the flows on screen belong to.
 *
 * Read-only for now: an account has exactly one workspace until invitations exist, and a switcher
 * with nothing to switch to is just furniture. The name still earns its place — it is the tenant
 * every query is scoped by, so seeing it is how you know which data you are looking at.
 */
function WorkspaceName() {
  const { data: session } = authClient.useSession();
  const { data: workspaces } = authClient.useListOrganizations();

  const activeId = session?.session.activeOrganizationId;
  const workspace = workspaces?.find((candidate) => candidate.id === activeId) ?? workspaces?.[0];

  if (!workspace) {
    return null;
  }

  return (
    <span className="hidden truncate text-muted-foreground text-sm sm:inline" title={workspace.name}>
      {workspace.name}
    </span>
  );
}

export function AppHeader() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    await signOut();
    // Flow data is tenant-scoped, so it must not survive into whoever signs in next on this device.
    queryClient.clear();
    await navigate({ to: routes.signIn });
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
      <nav aria-label="Application" className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-6">
        <Link
          to={routes.flows}
          className="flex items-center gap-2.5 rounded-sm font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
        >
          <img src="/logo.webp" alt="" width={32} height={20} className="h-5 w-auto" />
          {config.company.productName}
        </Link>

        <span aria-hidden="true" className="text-muted-foreground/40">
          /
        </span>
        <WorkspaceName />

        <ul className="flex items-center gap-1 text-sm">
          {sections.map((section) => (
            <li key={section.to}>
              <Link to={section.to} className={NAV_LINK_CLASS}>
                {section.label}
              </Link>
            </li>
          ))}
          <OperationsLink />
        </ul>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-muted-foreground text-sm md:inline">{session?.user.email}</span>
          <Button variant="ghost" size="sm" onClick={handleSignOut} disabled={isSigningOut}>
            Sign out
          </Button>
        </div>
      </nav>
    </header>
  );
}
