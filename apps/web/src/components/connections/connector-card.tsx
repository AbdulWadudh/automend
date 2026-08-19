import { type ConnectorCatalogueEntry, config } from "@automend/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleSlashIcon, PlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ProviderIcon, tileClassForProvider } from "@/components/connections/provider-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startOAuthConnection } from "@/lib/connect-oauth";
import { connectionQueryKeys, createTokenConnection } from "@/lib/connections-api";
import { cn } from "@/lib/utils";

const { connectionName, connectionToken } = config.validation;

/**
 * What a connector will be allowed to do, one permission per tag.
 *
 * Tags rather than a comma-joined string: a scope is a value, and a row of them wraps at the value
 * boundary instead of mid-URL. They are plain spans, because none of them is something to press.
 */
function ScopeTags({ scopes }: { scopes: readonly string[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs">Asks for</p>
      <ul className="flex flex-wrap gap-1">
        {scopes.map((scope) => (
          <li
            key={scope}
            className="max-w-full truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground"
            title={scope}
          >
            {scope}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ConnectorCard({
  connector,
  connectedCount,
}: {
  connector: ConnectorCatalogueEntry;
  connectedCount: number;
}) {
  const queryClient = useQueryClient();
  const [isAddingToken, setIsAddingToken] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState("");

  const addToken = useMutation({
    mutationFn: () => createTokenConnection({ providerId: connector.id, displayName: displayName.trim(), token }),
    onSuccess: async () => {
      // Cleared immediately: the secret has no reason to stay in a React state tree once stored.
      setToken("");
      setDisplayName("");
      setIsAddingToken(false);
      await queryClient.invalidateQueries({ queryKey: connectionQueryKeys.list() });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (displayName.trim().length >= connectionName.minLength && token.length > 0) {
      addToken.mutate();
    }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader className="gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg",
              tileClassForProvider(connector.id),
            )}
          >
            <ProviderIcon providerId={connector.id} label={connector.label} />
          </span>

          <div className="min-w-0 flex-1 space-y-0.5">
            <CardTitle className="text-base leading-snug">{connector.label}</CardTitle>
            <CardDescription className="line-clamp-2">{connector.summary}</CardDescription>
          </div>

          {connectedCount > 0 && (
            <span className="shrink-0 rounded-full bg-node-emerald/15 px-2 py-0.5 font-medium text-node-emerald text-xs tabular-nums">
              {connectedCount} connected
            </span>
          )}
        </div>
      </CardHeader>

      {connector.scopes.length > 0 && (
        <CardContent className="flex-1">
          <ScopeTags scopes={connector.scopes} />
        </CardContent>
      )}

      <CardFooter className="mt-auto justify-end border-t pt-4">
        {connector.available ? (
          connector.kind === "token" ? (
            <Button size="sm" variant="outline" onClick={() => setIsAddingToken(true)}>
              <PlusIcon />
              Add token
            </Button>
          ) : (
            // A workspace can connect the same service more than once — a personal mailbox and a shared
            // one are different accounts — so this stays available after the first.
            <Button size="sm" variant="outline" onClick={() => void startOAuthConnection(connector.id)}>
              <PlusIcon />
              {connectedCount === 0 ? "Connect" : "Connect another"}
            </Button>
          )
        ) : (
          // Listed rather than hidden, so an operator can see what configuring it would add. The icon is
          // what says "unavailable" — the muted tint on its own would not.
          <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
            <CircleSlashIcon className="size-3.5" aria-hidden />
            Not configured
          </span>
        )}
      </CardFooter>

      {/*
        A modal rather than the card growing a form inside it.
        
        Inline, the form doubled the card's height and shoved every card after it down the grid — and a
        two-field form with a secret in it deserves the focus trap and the escape route a modal gives it
        anyway. The card stays the size it was.
      */}
      <Dialog open={isAddingToken} onOpenChange={setIsAddingToken}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a {connector.label} token</DialogTitle>
            <DialogDescription>{connector.summary}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${connector.id}-name`}>Name</Label>
              <Input
                id={`${connector.id}-name`}
                value={displayName}
                maxLength={connectionName.maxLength}
                placeholder="Billing API"
                autoFocus
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">What this workspace calls it, so two are told apart.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${connector.id}-token`}>Token</Label>
              <Input
                id={`${connector.id}-token`}
                type="password"
                autoComplete="off"
                value={token}
                maxLength={connectionToken.maxLength}
                onChange={(event) => setToken(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Encrypted before it is stored, and never shown again — only its last few characters.
              </p>
            </div>

            {addToken.isError && (
              <p role="alert" className="text-destructive text-sm">
                {addToken.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setIsAddingToken(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  addToken.isPending || displayName.trim().length < connectionName.minLength || token.length === 0
                }
              >
                {addToken.isPending ? "Saving…" : "Save connection"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
