import { config } from "@automend/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient, signOut } from "@/lib/auth-client";

const { routes } = config.webClient;

/** `data-status="active"` is set by the router on the link matching the current route. */
const sections = [
  { to: routes.flows, label: "Flows" },
  { to: routes.connections, label: "Connections" },
];

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
              <Link
                to={section.to}
                className="rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 data-[status=active]:bg-muted data-[status=active]:text-foreground"
              >
                {section.label}
              </Link>
            </li>
          ))}
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
