import { type Connection, config } from "@automend/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, PencilIcon, RefreshCwIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ProviderIcon, tileClassForProvider } from "@/components/connections/provider-icon";
import { RevealTokenAction } from "@/components/connections/reveal-token-action";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startOAuthConnection } from "@/lib/connect-oauth";
import { connectionQueryKeys, deleteConnection, renameConnection, updateConnectionToken } from "@/lib/connections-api";
import { cn } from "@/lib/utils";

const { connectionName, connectionToken } = config.validation;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** Whichever of these the provider gave us — an email is the most recognisable, an id the last resort. */
function describeIdentity(connection: Connection): string {
  return connection.accountEmail ?? connection.accountName ?? connection.secretHint ?? connection.accountId ?? "—";
}

/** How the credential is held, which decides what can be done to it. State, so a badge rather than a chip. */
function KindBadge({ kind }: { kind: Connection["kind"] }) {
  const isOAuth = kind === "oauth";

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
      {isOAuth ? <ShieldCheckIcon className="size-3" aria-hidden /> : <KeyRoundIcon className="size-3" aria-hidden />}
      {isOAuth ? "OAuth" : "Token"}
    </span>
  );
}

export function ConnectionCard({ connection, label }: { connection: Connection; label: string }) {
  const queryClient = useQueryClient();
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  const [isReplacingToken, setIsReplacingToken] = useState(false);
  const [replacementToken, setReplacementToken] = useState("");
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  async function refreshList() {
    await queryClient.invalidateQueries({ queryKey: connectionQueryKeys.list() });
  }

  const rename = useMutation({
    mutationFn: (displayName: string) => renameConnection(connection.id, { displayName }),
    onSuccess: async () => {
      setDraftName(undefined);
      await refreshList();
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteConnection(connection.id),
    onSuccess: refreshList,
  });

  const replaceToken = useMutation({
    mutationFn: () => updateConnectionToken(connection.id, { token: replacementToken }),
    onSuccess: async () => {
      // Dropped as soon as it is stored; a secret has no reason to linger in component state.
      setReplacementToken("");
      setIsReplacingToken(false);
      await refreshList();
    },
  });

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const next = draftName?.trim() ?? "";

    if (next.length >= connectionName.minLength && next !== connection.displayName) {
      rename.mutate(next);
      return;
    }

    setDraftName(undefined);
  }

  return (
    <Card className="flex flex-col">
      <CardHeader className="gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg",
              tileClassForProvider(connection.providerId),
            )}
          >
            <ProviderIcon providerId={connection.providerId} label={label} />
          </span>

          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate font-medium text-sm">{connection.displayName}</p>
            <p className="truncate text-muted-foreground text-xs" title={describeIdentity(connection)}>
              {describeIdentity(connection)}
            </p>
          </div>

          <KindBadge kind={connection.kind} />
        </div>
      </CardHeader>

      <CardFooter className="mt-auto items-center justify-between gap-2 border-t pt-4">
        <span className="truncate text-muted-foreground text-xs">
          {label} · added {dateFormat.format(new Date(connection.createdAt))}
        </span>

        {/* Remove sits apart from the rest, because it is the one that cannot be undone by pressing again. */}
        <span className="flex shrink-0 items-center gap-0.5">
          {connection.kind === "token" ? (
            <>
              <RevealTokenAction connection={connection} />

              <IconAction label="Replace the token" tone="credential" onClick={() => setIsReplacingToken(true)}>
                <KeyRoundIcon />
              </IconAction>
            </>
          ) : (
            // Re-running the same flow: the upsert refreshes this connection in place, keeping the name
            // it was given. Choosing a *different* account at the provider adds a second connection
            // instead, which is the honest outcome — it is a different account.
            <IconAction
              label="Reauthenticate"
              tone="refresh"
              onClick={() => void startOAuthConnection(connection.providerId)}
            >
              <RefreshCwIcon />
            </IconAction>
          )}

          <IconAction label="Rename" tone="edit" onClick={() => setDraftName(connection.displayName)}>
            <PencilIcon />
          </IconAction>

          <IconAction label="Remove" tone="danger" onClick={() => setIsConfirmingDelete(true)}>
            <Trash2Icon />
          </IconAction>
        </span>
      </CardFooter>

      {/*
        Renaming and replacing a token are tasks, so they get a `Dialog`; removing is a decision, so it
        keeps the `AlertDialog` below. Inline, either of them resized the card and pushed the grid around
        it — and a field that replaces a label under the pointer is the thing that feels broken.
      */}
      <Dialog open={draftName !== undefined} onOpenChange={(open) => !open && setDraftName(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename this connection</DialogTitle>
            <DialogDescription>Only what this workspace calls it. The credential is untouched.</DialogDescription>
          </DialogHeader>

          <form onSubmit={submitRename} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${connection.id}-name`}>Name</Label>
              <Input
                id={`${connection.id}-name`}
                value={draftName ?? ""}
                maxLength={connectionName.maxLength}
                autoFocus
                onChange={(event) => setDraftName(event.target.value)}
              />
            </div>

            {rename.isError && (
              <p role="alert" className="text-destructive text-sm">
                {rename.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDraftName(undefined)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={rename.isPending || (draftName?.trim().length ?? 0) < connectionName.minLength}
              >
                {rename.isPending ? "Saving…" : "Save name"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isReplacingToken} onOpenChange={setIsReplacingToken}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace the token</DialogTitle>
            <DialogDescription>
              Every flow using "{connection.displayName}" starts using the new token on its next run.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();

              if (replacementToken.length > 0) {
                replaceToken.mutate();
              }
            }}
          >
            <div className="space-y-2">
              <Label htmlFor={`${connection.id}-token`}>New token</Label>
              <Input
                id={`${connection.id}-token`}
                type="password"
                autoComplete="off"
                autoFocus
                placeholder="Paste the new token"
                value={replacementToken}
                maxLength={connectionToken.maxLength}
                onChange={(event) => setReplacementToken(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Encrypted before it is stored, and never shown again — only its last few characters.
              </p>
            </div>

            {replaceToken.isError && (
              <p role="alert" className="text-destructive text-sm">
                {replaceToken.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setIsReplacingToken(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={replaceToken.isPending || replacementToken.length === 0}>
                {replaceToken.isPending ? "Saving…" : "Replace"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Deleting keeps its words: an icon is fine shorthand for something you can undo by pressing it
          again, and the wrong shorthand for confirming something permanent. */}
      <AlertDialog open={isConfirmingDelete} onOpenChange={setIsConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{connection.displayName}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Any flow step using this connection will fail until it is pointed at another one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            {/* The dialog's confirming action is the destructive one, so it wears the destructive
                variant. Defaulting to `default` painted a permanent removal in the brand colour —
                the same green as every safe primary action in the app. */}
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isPending ? "Removing…" : "Remove for good"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {remove.isError && (
        <p role="alert" className="px-5 pb-4 text-destructive text-xs">
          {remove.error.message}
        </p>
      )}
    </Card>
  );
}
