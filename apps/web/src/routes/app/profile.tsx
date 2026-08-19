import { config } from "@automend/shared";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckIcon, LaptopIcon, LogOutIcon, MoonIcon, SunIcon } from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient, signOut } from "@/lib/auth-client";
import { type Theme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const { routes } = config.webClient;

const THEME_CHOICES: {
  value: Theme;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { value: "system", label: "System", description: "Follow this device", icon: LaptopIcon },
  { value: "light", label: "Light", description: "Always light", icon: SunIcon },
  { value: "dark", label: "Dark", description: "Always dark", icon: MoonIcon },
];

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="break-all font-medium text-sm">{value}</dd>
    </div>
  );
}

function Appearance() {
  const { theme, setTheme } = useTheme();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Applies to this browser, and is remembered on this device.</CardDescription>
      </CardHeader>

      <CardContent>
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="sr-only">Theme</legend>

          {THEME_CHOICES.map((choice) => {
            const isSelected = theme === choice.value;

            return (
              <button
                key={choice.value}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setTheme(choice.value)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl px-3 py-3 text-left transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
                  isSelected
                    ? "bg-muted text-foreground ring-2 ring-ring"
                    : "text-muted-foreground ring-1 ring-foreground/10 hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <span className="flex w-full items-center gap-2">
                  <choice.icon className="size-4 shrink-0" />
                  <span className="font-medium text-sm">{choice.label}</span>
                  {/* A tick as well as the highlight: the selection must not be carried by colour alone. */}
                  {isSelected && <CheckIcon className="ml-auto size-4 shrink-0" />}
                </span>
                <span className="text-xs">{choice.description}</span>
              </button>
            );
          })}
        </fieldset>
      </CardContent>
    </Card>
  );
}

function ProfilePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const { data: workspaces } = authClient.useListOrganizations();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const activeId = session?.session.activeOrganizationId;
  const workspace = workspaces?.find((candidate) => candidate.id === activeId) ?? workspaces?.[0];

  async function handleSignOut() {
    setIsSigningOut(true);
    await signOut();
    // Flow data is tenant-scoped, so it must not survive into whoever signs in next on this device.
    queryClient.clear();
    await navigate({ to: routes.signIn });
  }

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 space-y-8 overflow-y-auto px-6 py-10">
      <div className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">Profile</h1>
        <p className="text-muted-foreground">Your account, and how this app looks on this device.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Read-only for now — changing these is not built yet.</CardDescription>
        </CardHeader>

        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Detail label="Name" value={session?.user.name || "—"} />
            <Detail label="Email" value={session?.user.email ?? "—"} />
            <Detail label="Workspace" value={workspace?.name ?? "—"} />
          </dl>
        </CardContent>
      </Card>

      <Appearance />

      {/* Kept away from everything above: signing out is the one control here with a consequence. */}
      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>Signing out clears this workspace's data from this browser.</CardDescription>
        </CardHeader>

        <CardContent>
          <Button variant="outline" disabled={isSigningOut} onClick={handleSignOut}>
            <LogOutIcon data-icon="inline-start" />
            {isSigningOut ? "Signing out…" : "Sign out"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute("/app/profile")({
  component: ProfilePage,
});
