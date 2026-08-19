import { config } from "@automend/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { GaugeIcon, HistoryIcon, PlugIcon, WorkflowIcon } from "lucide-react";
import type { ComponentType } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { fetchOpsConsoles, operationsQueryKeys } from "@/lib/operations-api";

const { routes } = config.webClient;

type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

/** What the product is for, in the order somebody works: build a flow, watch it run, connect what it needs. */
const WORKSPACE_NAV: NavItem[] = [
  { to: routes.flows, label: "Flows", icon: WorkflowIcon },
  { to: routes.runs, label: "Runs", icon: HistoryIcon },
  { to: routes.connections, label: "Connections", icon: PlugIcon },
];

function useIsActive(): (to: string) => boolean {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  // A flow's own page keeps Flows lit, so the sidebar still says where you are two levels down.
  return (to: string) => pathname === to || pathname.startsWith(`${to}/`);
}

function NavLinks({ items }: { items: NavItem[] }) {
  const isActive = useIsActive();

  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.to}>
          <SidebarMenuButton asChild isActive={isActive(item.to)} tooltip={item.label}>
            <Link to={item.to}>
              <item.icon />
              <span>{item.label}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

/**
 * Operations, present only on a deployment that has an operator console.
 *
 * Asked of the API rather than assumed, because both consoles are optional: a deployment that configured
 * neither would otherwise carry a permanent nav item leading to two "Not configured" cards.
 */
function OperationsGroup() {
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
    <SidebarGroup>
      <SidebarGroupLabel>Operating</SidebarGroupLabel>
      <SidebarGroupContent>
        <NavLinks items={[{ to: routes.operations, label: "Operations", icon: GaugeIcon }]} />
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * The workspace every query on screen is scoped by.
 *
 * Read-only for now: an account has one workspace until invitations exist, and a switcher with nothing to
 * switch to is furniture. The name still earns its place — it is how you know whose data you are looking at.
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
    <p
      className="truncate px-2 text-muted-foreground text-xs group-data-[collapsible=icon]:hidden"
      title={workspace.name}
    >
      {workspace.name}
    </p>
  );
}

/** Two letters from the name, or the first of the email — enough to tell two accounts apart at 24px. */
function buildInitials(name: string | undefined, email: string | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);

  if (words.length > 0) {
    return words
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("");
  }

  return (email?.[0] ?? "?").toUpperCase();
}

export function AppSidebar() {
  const isActive = useIsActive();
  const { data: session } = authClient.useSession();

  const email = session?.user.email;
  const name = session?.user.name || email || "Signed in";
  const image = session?.user.image ?? undefined;
  const initials = buildInitials(session?.user.name, email);
  const isProfileActive = isActive(routes.profile);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-2">
        <Link
          to={routes.flows}
          className="flex items-center gap-2.5 rounded-lg px-2 py-1 font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        >
          <img src="/logo.webp" alt="" width={32} height={20} className="h-5 w-auto shrink-0" />
          <span className="truncate group-data-[collapsible=icon]:hidden">{config.company.productName}</span>
        </Link>
        <WorkspaceName />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavLinks items={WORKSPACE_NAV} />
          </SidebarGroupContent>
        </SidebarGroup>

        <OperationsGroup />
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isProfileActive} tooltip={email ?? "Profile"} size="lg">
              <Link to={routes.profile}>
                <Avatar className="size-6 rounded-md">
                  {image && <AvatarImage src={image} alt="" />}
                  <AvatarFallback className="rounded-md text-[0.625rem]">{initials}</AvatarFallback>
                </Avatar>
                <span className="grid min-w-0 flex-1 text-left leading-tight">
                  <span className="truncate font-medium text-sm">{name}</span>
                  <span className="truncate text-muted-foreground text-xs">{email}</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
