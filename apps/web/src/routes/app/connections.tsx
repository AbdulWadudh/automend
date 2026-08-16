import { type Connection, type ConnectorCatalogueEntry, type ConnectorId, config } from "@automend/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  PencilIcon,
  PlugZapIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IconAction, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import {
  connectionQueryKeys,
  createOAuthConnection,
  createTokenConnection,
  deleteConnection,
  fetchConnectorCatalogue,
  listConnections,
  renameConnection,
  revealConnectionToken,
  updateConnectionToken,
} from "@/lib/connections-api";

const { routes } = config.webClient;
const { connectionName, connectionToken } = config.validation;
const CONNECTED_PARAM = "connected";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * Sends the browser to the provider to authorise the connection.
 *
 * The connector's provider id is suffixed (`slack-connector`) so it is a different registration
 * from the sign-in provider of the same name — connecting a service must not widen what signing in
 * with it is allowed to do.
 */
async function startOAuthConnection(connectorId: ConnectorId) {
  await authClient.oauth2.link({
    providerId: `${connectorId}${config.connectors.connectionProviderSuffix}`,
    callbackURL: `${routes.connections}?${CONNECTED_PARAM}=${connectorId}`,
  });
}

function ConnectorCard({ connector, connectedCount }: { connector: ConnectorCatalogueEntry; connectedCount: number }) {
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {connector.kind === "token" ? <KeyRoundIcon className="size-4" /> : <PlugZapIcon className="size-4" />}
          {connector.label}
        </CardTitle>
        <CardDescription>{connector.summary}</CardDescription>

        <CardAction>
          {connector.available ? (
            connector.kind === "token" ? (
              <Button size="sm" variant="outline" onClick={() => setIsAddingToken((adding) => !adding)}>
                {isAddingToken ? "Cancel" : "Add token"}
              </Button>
            ) : (
              // A workspace can connect the same service more than once — a personal mailbox and a
              // shared one are different accounts — so this stays available after the first.
              <Button size="sm" variant="outline" onClick={() => void startOAuthConnection(connector.id)}>
                {connectedCount === 0 ? "Connect" : "Connect another"}
              </Button>
            )
          ) : (
            // Listed rather than hidden, so an operator can see what configuring it would add.
            <span className="text-muted-foreground text-xs">Not configured</span>
          )}
        </CardAction>
      </CardHeader>

      {connector.scopes.length > 0 && (
        <CardContent className="text-muted-foreground text-xs">
          Asks for: <span className="font-mono">{connector.scopes.join(", ")}</span>
        </CardContent>
      )}

      {isAddingToken && (
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor={`${connector.id}-name`}>Name</Label>
              <Input
                id={`${connector.id}-name`}
                value={displayName}
                maxLength={connectionName.maxLength}
                placeholder="Billing API"
                onChange={(event) => setDisplayName(event.target.value)}
              />
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

            <Button type="submit" size="sm" disabled={addToken.isPending}>
              {addToken.isPending ? "Saving…" : "Save connection"}
            </Button>
          </form>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * The line under a connection's name: which service, whose account, and when.
 *
 * The address rather than the account holder's name, because the name is already the heading —
 * repeating it here would spend the line saying nothing, and the address is what distinguishes two
 * accounts belonging to the same person. The provider's own id is the last resort: it appears only
 * when the provider gave us nothing readable at all.
 */
function describeConnection(connection: Connection, label: string): string {
  const identity = connection.accountEmail ?? connection.accountName ?? connection.secretHint ?? connection.accountId;

  return [label, identity, `added ${dateFormat.format(new Date(connection.createdAt))}`].filter(Boolean).join(" · ");
}

/**
 * Shows a stored token, in a popover anchored to its own button.
 *
 * In a popover rather than inline because a revealed secret is a glance, not a change to the page:
 * expanding the row pushed every control beside it out of place, which is a poor trade for text
 * you are about to copy and dismiss.
 *
 * Closing forgets the value rather than hiding it, so the token lives in the page only while it is
 * on screen and reopening is another audited request.
 */
function RevealTokenAction({ connection }: { connection: Connection }) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const reveal = useMutation({ mutationFn: () => revealConnectionToken(connection.id) });
  const { mutate: requestToken, reset: forgetToken } = reveal;

  function handleOpenChange(open: boolean) {
    setIsOpen(open);
    setCopied(false);

    if (open) {
      requestToken();
      return;
    }

    forgetToken();
  }

  async function copyToken() {
    if (!reveal.data) {
      return;
    }

    await navigator.clipboard.writeText(reveal.data);
    setCopied(true);
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-node-cyan hover:bg-node-cyan/10 hover:text-node-cyan"
              aria-label={`View the token for ${connection.displayName}`}
            >
              {isOpen ? <EyeOffIcon /> : <EyeIcon />}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{isOpen ? "Hide the token" : "View the token"}</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" className="w-80 space-y-2 p-3">
        {reveal.isPending && <p className="text-muted-foreground text-xs">Fetching…</p>}

        {reveal.isError && (
          <p role="alert" className="text-destructive text-xs">
            {reveal.error.message}
          </p>
        )}

        {reveal.data && (
          // Copy belongs on the value, not beside it: the button is the field's own affordance,
          // pinned so it stays reachable while a long token scrolls underneath it.
          <div className="relative">
            <p className="max-h-32 overflow-y-auto break-all rounded-lg bg-muted py-2 pr-9 pl-2.5 font-mono text-xs">
              {reveal.data}
            </p>
            <IconAction
              label={copied ? "Copied" : "Copy the token"}
              tone={copied ? "view" : "neutral"}
              className="absolute top-1 right-1"
              onClick={() => void copyToken()}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </IconAction>
            <span className="sr-only" aria-live="polite">
              {copied ? "Token copied to the clipboard" : ""}
            </span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ConnectionRow({ connection, label }: { connection: Connection; label: string }) {
  const queryClient = useQueryClient();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  const [isReplacingToken, setIsReplacingToken] = useState(false);
  const [replacementToken, setReplacementToken] = useState("");

  const refreshList = () => queryClient.invalidateQueries({ queryKey: connectionQueryKeys.list() });

  const remove = useMutation({
    mutationFn: () => deleteConnection(connection.id),
    onSuccess: refreshList,
  });

  const rename = useMutation({
    mutationFn: (displayName: string) => renameConnection(connection.id, { displayName }),
    onSuccess: async () => {
      setDraftName(undefined);
      await refreshList();
    },
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
    <div className="flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        {draftName === undefined ? (
          <p className="truncate font-medium text-sm">{connection.displayName}</p>
        ) : (
          <form onSubmit={submitRename} className="flex items-center gap-1.5">
            <Input
              aria-label={`Name for ${connection.displayName}`}
              value={draftName}
              maxLength={connectionName.maxLength}
              // The field replaced the label that was just clicked, so focus belongs here.
              autoFocus
              className="h-8 max-w-xs"
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setDraftName(undefined);
                }
              }}
            />
            <Button type="submit" size="sm" disabled={rename.isPending}>
              {rename.isPending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraftName(undefined)}>
              Cancel
            </Button>
          </form>
        )}

        <p className="truncate text-muted-foreground text-xs">{describeConnection(connection, label)}</p>

        {rename.isError && (
          <p role="alert" className="text-destructive text-xs">
            {rename.error.message}
          </p>
        )}

        {isReplacingToken && (
          <form
            className="mt-2 flex flex-wrap items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();

              if (replacementToken.length > 0) {
                replaceToken.mutate();
              }
            }}
          >
            <Input
              aria-label={`New token for ${connection.displayName}`}
              type="password"
              autoComplete="off"
              autoFocus
              placeholder="Paste the new token"
              value={replacementToken}
              maxLength={connectionToken.maxLength}
              className="h-8 max-w-xs"
              onChange={(event) => setReplacementToken(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={replaceToken.isPending || replacementToken.length === 0}>
              {replaceToken.isPending ? "Saving…" : "Replace"}
            </Button>
            {replaceToken.isError && (
              <p role="alert" className="text-destructive text-xs">
                {replaceToken.error.message}
              </p>
            )}
          </form>
        )}
      </div>

      {isConfirmingDelete ? (
        // Deleting keeps its words. An icon is a fine shorthand for an action you can undo by
        // doing it again; it is the wrong shorthand for confirming something permanent.
        <span className="flex items-center gap-1.5">
          <Button variant="destructive" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? "Removing…" : "Remove for good"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setIsConfirmingDelete(false)}>
            Cancel
          </Button>
        </span>
      ) : (
        <span className="flex items-center gap-0.5">
          {connection.kind === "token" ? (
            <>
              <RevealTokenAction connection={connection} />

              <IconAction
                label={isReplacingToken ? "Cancel" : "Replace the token"}
                tone="credential"
                onClick={() => setIsReplacingToken((replacing) => !replacing)}
              >
                <KeyRoundIcon />
              </IconAction>
            </>
          ) : (
            // Re-running the same flow: the upsert refreshes this connection in place, keeping the
            // name it was given. Choosing a *different* account at the provider adds a second
            // connection instead, which is the honest outcome — it is a different account.
            <IconAction
              label="Reauthenticate"
              tone="refresh"
              onClick={() => void startOAuthConnection(connection.providerId)}
            >
              <RefreshCwIcon />
            </IconAction>
          )}

          {draftName === undefined && (
            <IconAction label="Rename" tone="edit" onClick={() => setDraftName(connection.displayName)}>
              <PencilIcon />
            </IconAction>
          )}

          <IconAction label="Remove" tone="danger" onClick={() => setIsConfirmingDelete(true)}>
            <Trash2Icon />
          </IconAction>
        </span>
      )}
    </div>
  );
}

function ConnectionsPage() {
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const catalogue = useQuery({
    queryKey: connectionQueryKeys.catalogue(),
    queryFn: ({ signal }) => fetchConnectorCatalogue(signal),
  });

  const connections = useQuery({
    queryKey: connectionQueryKeys.list(),
    queryFn: ({ signal }) => listConnections(signal),
  });

  const record = useMutation({
    mutationFn: (providerId: ConnectorId) => createOAuthConnection({ providerId }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: connectionQueryKeys.list() });
    },
  });

  /**
   * The provider has redirected back. Better-Auth holds the tokens by now; this records which
   * workspace may use them, then clears the parameter so a refresh does not repeat it.
   */
  const connected = search[CONNECTED_PARAM];
  const recordConnection = record.mutate;

  useEffect(() => {
    if (!connected) {
      return;
    }

    recordConnection(connected as ConnectorId);
    void navigate({ to: routes.connections, search: {}, replace: true });
  }, [connected, navigate, recordConnection]);

  const labelFor = (providerId: string) =>
    catalogue.data?.find((connector) => connector.id === providerId)?.label ?? providerId;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-6 py-10">
      <div className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">Connections</h1>
        <p className="text-muted-foreground">
          The services this workspace can act through. Flows use these credentials; they belong to the workspace, not to
          whoever set them up.
        </p>
      </div>

      {record.isError && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {record.error.message}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="font-medium text-sm">Connected</h2>

        {connections.isPending && <p className="text-muted-foreground text-sm">Loading…</p>}

        {connections.isError && (
          <p role="alert" className="text-destructive text-sm">
            {connections.error.message}
          </p>
        )}

        {connections.data?.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Nothing connected yet</CardTitle>
              <CardDescription>Connect a service below and its credentials become available to flows.</CardDescription>
            </CardHeader>
          </Card>
        )}

        {connections.data && connections.data.length > 0 && (
          <Card>
            <CardContent>
              {connections.data.map((connection) => (
                <ConnectionRow key={connection.id} connection={connection} label={labelFor(connection.providerId)} />
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-sm">Available</h2>

        {catalogue.isPending && <p className="text-muted-foreground text-sm">Loading…</p>}

        <div className="space-y-3">
          {catalogue.data?.map((connector) => (
            <ConnectorCard
              key={connector.id}
              connector={connector}
              connectedCount={
                connections.data?.filter((connection) => connection.providerId === connector.id).length ?? 0
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}

export const Route = createFileRoute("/app/connections")({
  validateSearch: (search: Record<string, unknown>): { connected?: string } =>
    typeof search[CONNECTED_PARAM] === "string" ? { connected: search[CONNECTED_PARAM] } : {},
  component: ConnectionsPage,
});
