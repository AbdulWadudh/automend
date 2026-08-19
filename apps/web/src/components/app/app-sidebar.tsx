import { config } from "@automend/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ChevronLeftIcon,
  ChevronsUpDownIcon,
  GaugeIcon,
  HistoryIcon,
  LogOutIcon,
  MoonIcon,
  PlugIcon,
  UserRoundIcon,
  WorkflowIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconAction } from "@/components/ui/icon-action";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { authClient, signOut } from "@/lib/auth-client";
import { fetchOpsConsoles, operationsQueryKeys } from "@/lib/operations-api";
import { resolveTheme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

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
    <SidebarMenu className="group-data-[collapsible=icon]:items-center">
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

/**
 * Dark mode as a switch, which is a binary control over a setting that has three values.
 *
 * Flipping it writes `light` or `dark` explicitly, so the switch and the surface can never disagree
 * about what is on. What a switch cannot express is `system`, and that choice stays on the profile
 * page — a machine that changes at sunset is a real thing to want, and a switch has nowhere to put it.
 */
function DarkModeRow() {
  const { open } = useSidebar();
  const { theme, setTheme } = useTheme();
  const isDark = resolveTheme(theme) === "dark";

  const control = (
    <Switch id="sidebar-dark-mode" checked={isDark} onCheckedChange={(next) => setTheme(next ? "dark" : "light")} />
  );

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <MoonIcon className="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" aria-hidden />

      {/*
        `sr-only` rather than removed: the switch keeps the label that names it, so it is still "Dark mode"
        to a screen reader when the rail is too narrow to print the words.
      */}
      <label htmlFor="sidebar-dark-mode" className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:sr-only">
        Dark mode
      </label>

      {/* And a tooltip while the words are hidden, so a pointer and a keyboard can both find out what it is. */}
      {open ? (
        control
      ) : (
        <Tooltip>
          {/*
            The span is not a wrapper for layout — it is there to take the trigger's `data-state`.
            `asChild` on the switch itself overwrites the `checked`/`unchecked` that colours the track.
          */}
          <TooltipTrigger asChild>
            <span className="inline-flex">{control}</span>
          </TooltipTrigger>
          <TooltipContent side="right">Dark mode</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * One control, rendered twice — beside the logo when the panel is open, on the rail's edge when it is not.
 *
 * Shared rather than written out at both sites because the label and the arrow's direction are the whole
 * behaviour, and two copies of that is two chances for the chevron to point the wrong way.
 *
 * Neither copy sets its own size or radius. It is a `Button`, so it wears `rounded-md` like every other
 * control here — `rounded-full` in this codebase is for dots, badges, avatars and the switch track, never
 * for something you press. The edge copy adds only a border and a surface, because it is the one sitting
 * on a line and needs to read as being on top of it.
 */
function MenuToggle({ open, onToggle, className }: { open: boolean; onToggle: () => void; className: string }) {
  return (
    <IconAction
      label={open ? "Collapse the menu" : "Expand the menu"}
      aria-expanded={open}
      onClick={onToggle}
      className={className}
    >
      {/* Points the way it will move, rather than naming a state it is not in. */}
      <ChevronLeftIcon className={cn("motion-safe:transition-transform", !open && "rotate-180")} />
    </IconAction>
  );
}

export function AppSidebar() {
  const { open, toggleSidebar } = useSidebar();
  const isActive = useIsActive();
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

  const email = session?.user.email;
  const name = session?.user.name || email || "Signed in";
  const image = session?.user.image ?? undefined;
  const initials = buildInitials(session?.user.name, email);
  const isProfileActive = isActive(routes.profile);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-2">
        <div className="flex items-center gap-1">
          <Link
            to={routes.flows}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1 font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          >
            {/*
              `max-w-none` because Preflight gives every image `max-width: 100%`, and inside the collapsed
              rail the box around it is narrower than the mark: the width clamps, the height class holds,
              and the logo comes out squashed. The intrinsic pixel dimensions are on the element so the
              browser knows the real aspect ratio and reserves the right box before the file arrives.
            */}
            <img
              src="/logo.webp"
              alt=""
              width={379}
              height={237}
              className="h-6 w-auto max-w-none shrink-0 group-data-[collapsible=icon]:h-5"
            />
            <span className="truncate group-data-[collapsible=icon]:hidden">{config.company.productName}</span>
          </Link>

          {/* Beside the logo while the panel is wide enough to hold both. */}
          <MenuToggle
            open={open}
            onToggle={toggleSidebar}
            className="relative shrink-0 after:absolute after:-inset-2 group-data-[collapsible=icon]:hidden"
          />
        </div>

        <WorkspaceName />
      </SidebarHeader>

      {/*
        The collapsed rail's copy, straddling the edge instead of sitting inside it.
        
        At 3rem there is no room beside the logo, and a control that moves a boundary reads well *on* the
        boundary: `right-0` puts it at the rail's own edge and `translate-x-1/2` carries half of it across.
        `top-5.5` with `-translate-y-1/2` centres it on the logo row — 8px of header padding, 4px of link
        padding and half of a 20px mark.

        Outside `SidebarHeader` on purpose: the header is padded, so anchoring to it would put the button on
        the padding edge rather than on the line. It positions against the sidebar container instead, which
        is already `fixed` and therefore the nearest positioned ancestor.
      */}
      <MenuToggle
        open={open}
        onToggle={toggleSidebar}
        className="absolute top-5.5 right-0 z-20 hidden -translate-y-1/2 translate-x-1/2 border bg-sidebar shadow-sm after:absolute after:-inset-2 group-data-[collapsible=icon]:inline-flex"
      />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavLinks items={WORKSPACE_NAV} />
          </SidebarGroupContent>
        </SidebarGroup>

        <OperationsGroup />
      </SidebarContent>

      {/*
        No separator: `SidebarFooter` already sits against the sidebar's own edge, and a rule above it
        collapses to a stub floating beside the icon rail once the sidebar is narrow.
      */}
      <SidebarFooter>
        <DarkModeRow />

        <SidebarMenu className="group-data-[collapsible=icon]:items-center">
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton isActive={isProfileActive} tooltip={email ?? "Account"} size="lg">
                  <Avatar className="size-6 rounded-md">
                    {image && <AvatarImage src={image} alt="" />}
                    <AvatarFallback className="rounded-md text-[0.625rem]">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="grid min-w-0 flex-1 text-left leading-tight">
                    <span className="truncate font-medium text-sm">{name}</span>
                    <span className="truncate text-muted-foreground text-xs">{email}</span>
                  </span>
                  <ChevronsUpDownIcon className="ml-auto size-4 shrink-0 opacity-60" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>

              {/* To the side rather than above: the footer is at the bottom, so a menu opening upward
                  would cover the navigation somebody just came from. */}
              <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-56">
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground text-xs">
                  {email}
                </DropdownMenuLabel>

                <DropdownMenuItem asChild>
                  <Link to={routes.profile}>
                    <UserRoundIcon />
                    Profile
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem onSelect={handleSignOut} disabled={isSigningOut}>
                  <LogOutIcon />
                  {isSigningOut ? "Signing out…" : "Sign out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
