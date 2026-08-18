/**
 * The Operations page — the way into the two operator consoles.
 *
 * It exists because the alternative was HTTP Basic auth, and Basic auth is answered by the *browser's*
 * own credential dialog: an operating-system box drawn over a themed product, which no stylesheet can
 * reach, which cannot say what is being asked for or what it grants, and which offers nothing when you
 * get it wrong. So the operator password is asked for here, on a real page, and exchanged for the
 * cookie the dashboard checks.
 *
 * Both consoles read across *every* workspace, which is why this page leads with saying so rather than
 * burying it: the person clicking through is about to see other tenants' data, and that should be a
 * decision rather than a surprise.
 *
 * A console this deployment has not configured is listed as unconfigured rather than hidden — the same
 * treatment the connections page gives a connector whose credentials are unset, and for the same
 * reason: an operator can see what configuring it would add.
 */

import { config } from "@automend/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  DatabaseIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  LayersIcon,
  LockIcon,
  ShieldAlertIcon,
  UnlockIcon,
} from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconAction } from "@/components/ui/tooltip";
import { fetchOpsConsoles, lockQueueDashboard, operationsQueryKeys, unlockQueueDashboard } from "@/lib/operations-api";

const { opsPassword } = config.validation;

/** Shown wherever a console cannot be reached, so the reason is the variable to go and set. */
function NotConfigured({ variables }: { variables: string }) {
  return (
    <CardContent className="text-muted-foreground text-xs">
      Not configured on this deployment. Set <span className="font-mono">{variables}</span> to enable it.
    </CardContent>
  );
}

/**
 * The operator password form.
 *
 * Paste is deliberately not interfered with and the field is `current-password`, so a password manager
 * can fill it — a console guarded by something nobody can store is a console guarded by something
 * short. The reveal toggle sits *inside* the field rather than beside it, so it cannot displace the
 * controls around it when the row changes.
 */
function UnlockForm() {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const helpId = useId();
  const errorId = useId();
  const [password, setPassword] = useState("");
  const [isRevealed, setIsRevealed] = useState(false);

  const unlock = useMutation({
    mutationFn: () => unlockQueueDashboard(password),
    onSuccess: async () => {
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: operationsQueryKeys.consoles() });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.length > 0 && !unlock.isPending) {
      unlock.mutate();
    }
  }

  return (
    <CardContent>
      <form onSubmit={handleSubmit} className="max-w-sm space-y-3">
        <div className="space-y-2">
          <Label htmlFor={fieldId}>Operator password</Label>

          <div className="relative">
            <Input
              id={fieldId}
              type={isRevealed ? "text" : "password"}
              value={password}
              autoComplete="current-password"
              maxLength={opsPassword.maxLength}
              aria-invalid={unlock.isError || undefined}
              aria-describedby={unlock.isError ? `${helpId} ${errorId}` : helpId}
              onChange={(event) => setPassword(event.target.value)}
              className="pr-9"
            />

            <IconAction
              type="button"
              label={isRevealed ? "Hide password" : "Show password"}
              onClick={() => setIsRevealed((revealed) => !revealed)}
              className="absolute top-1/2 right-1 -translate-y-1/2"
            >
              {isRevealed ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
            </IconAction>
          </div>

          <p id={helpId} className="text-muted-foreground text-xs">
            Set on the server as <span className="font-mono">OPS_DASHBOARD_PASSWORD</span>. It is not your account
            password, and it lapses after {config.ops.queueDashboard.session.maxAgeSeconds / 3600} hours.
          </p>

          {unlock.isError && (
            // role="alert" so it is announced, and beside the field it belongs to rather than at the
            // top of the page — there is only one field, and it is the one that was wrong.
            <p id={errorId} role="alert" className="flex items-start gap-1.5 text-destructive text-sm">
              <ShieldAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{unlock.error.message}. Check the value on the server, then try again.</span>
            </p>
          )}
        </div>

        <Button type="submit" size="sm" disabled={password.length === 0 || unlock.isPending}>
          {unlock.isPending ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
    </CardContent>
  );
}

function QueueConsoleCard({ available, unlocked }: { available: boolean; unlocked: boolean }) {
  const queryClient = useQueryClient();

  const lock = useMutation({
    mutationFn: lockQueueDashboard,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: operationsQueryKeys.consoles() });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayersIcon aria-hidden="true" className="size-4" />
          Queues
        </CardTitle>
        <CardDescription>
          Which jobs are waiting, which failed and why, and retrying one once the cause is fixed. Retries and removals
          take effect immediately.
        </CardDescription>

        <CardAction className="flex items-center gap-2">
          {!available ? (
            <span className="text-muted-foreground text-xs">Not configured</span>
          ) : unlocked ? (
            <>
              <Button size="sm" variant="outline" disabled={lock.isPending} onClick={() => lock.mutate()}>
                {lock.isPending ? "Locking…" : "Lock"}
              </Button>
              {/* A plain anchor, not a router Link: the dashboard is served by the API on this origin,
                  not by the SPA's router, so a client-side navigation would resolve to nothing. */}
              <Button size="sm" asChild>
                <a href={config.http.routes.queueDashboard} target="_blank" rel="noreferrer">
                  Open queues
                  <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
                </a>
              </Button>
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <LockIcon aria-hidden="true" className="size-3.5" />
              Locked
            </span>
          )}
        </CardAction>
      </CardHeader>

      {!available && <NotConfigured variables="OPS_DASHBOARD_USER and OPS_DASHBOARD_PASSWORD" />}

      {available && unlocked && (
        <CardContent className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <UnlockIcon aria-hidden="true" className="size-3.5" />
          Unlocked in this browser.
        </CardContent>
      )}

      {available && !unlocked && <UnlockForm />}
    </Card>
  );
}

function DatabaseConsoleCard({ url }: { url: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseIcon aria-hidden="true" className="size-4" />
          Database
        </CardTitle>
        <CardDescription>
          Drizzle Studio against this deployment's Postgres — browse and edit any table. Every row of every workspace.
        </CardDescription>

        <CardAction>
          {url ? (
            <Button size="sm" asChild>
              {/* Its own origin, so a new tab rather than replacing the app. `noreferrer` keeps this
                  app's URL out of the studio's referrer header. */}
              <a href={url} target="_blank" rel="noreferrer">
                Open studio
                <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
              </a>
            </Button>
          ) : (
            <span className="text-muted-foreground text-xs">Not configured</span>
          )}
        </CardAction>
      </CardHeader>

      {url ? (
        <CardContent className="text-muted-foreground text-xs">
          Opens in a new tab and asks for its own password — it runs as a separate service, so unlocking the queues
          above does not unlock it.
        </CardContent>
      ) : (
        <NotConfigured variables="STUDIO_URL" />
      )}
    </Card>
  );
}

function OperationsPage() {
  const consoles = useQuery({
    queryKey: operationsQueryKeys.consoles(),
    queryFn: ({ signal }) => fetchOpsConsoles(signal),
  });

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 space-y-8 overflow-y-auto px-6 py-10">
      <div className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">Operations</h1>
        <p className="text-muted-foreground">
          Tools for looking at what this deployment is doing. Each is guarded separately from your account.
        </p>
      </div>

      {/* An icon and a heading beside the border, never the border alone. */}
      <div className="flex items-start gap-3 rounded-lg bg-muted/50 px-4 py-3 ring-1 ring-foreground/10">
        <ShieldAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">These consoles are not scoped to your workspace</p>
          <p className="text-muted-foreground">
            They read across every workspace on this deployment, and both can change what they show. That is why they
            ask for an operator credential rather than accepting your session.
          </p>
        </div>
      </div>

      {consoles.isPending && <p className="text-muted-foreground text-sm">Loading…</p>}

      {consoles.isError && (
        <Card>
          <CardHeader>
            <CardTitle>Could not load the consoles</CardTitle>
            <CardDescription role="alert">{consoles.error.message}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" variant="outline" onClick={() => void consoles.refetch()} disabled={consoles.isFetching}>
              {consoles.isFetching ? "Retrying…" : "Try again"}
            </Button>
          </CardContent>
        </Card>
      )}

      {consoles.data && (
        <div className="space-y-3">
          <QueueConsoleCard available={consoles.data.queues.available} unlocked={consoles.data.queues.unlocked} />
          <DatabaseConsoleCard url={consoles.data.database.url} />
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/app/operations")({
  component: OperationsPage,
});
