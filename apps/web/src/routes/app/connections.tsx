import { type ConnectorId, config } from "@automend/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlugIcon } from "lucide-react";
import { useEffect } from "react";
import { ConnectionCard } from "@/components/connections/connection-card";
import { ConnectorCard } from "@/components/connections/connector-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CONNECTED_PARAM } from "@/lib/connect-oauth";
import {
  connectionQueryKeys,
  createOAuthConnection,
  fetchConnectorCatalogue,
  listConnections,
} from "@/lib/connections-api";

const { routes } = config.webClient;

/** Shaped like the card it stands in for, so nothing moves when the real ones arrive. */
function CardSkeleton() {
  return (
    <div className="rounded-xl border p-5">
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
      <Skeleton className="mt-6 h-3 w-full" />
    </div>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
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
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="animate-in fade-in duration-200 mx-auto w-full max-w-6xl space-y-8 px-4 pt-6 pb-10 sm:px-6 sm:pt-8">
        <div className="space-y-1">
          <h1 className="font-semibold text-2xl tracking-tight">Connections</h1>
          <p className="max-w-2xl text-muted-foreground">
            The services this workspace can act through. Flows use these credentials; they belong to the workspace, not
            to whoever set them up.
          </p>
        </div>

        {record.isError && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive text-sm">
            {record.error.message}
          </p>
        )}

        <section className="space-y-3">
          <h2 className="font-medium text-sm">Connected</h2>

          {connections.isPending && (
            <CardGrid>
              <span className="sr-only">Loading your connections…</span>
              {Array.from({ length: 3 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity to key by.
                <CardSkeleton key={index} />
              ))}
            </CardGrid>
          )}

          {connections.isError && (
            <div className="space-y-2">
              <p role="alert" className="text-destructive text-sm">
                {connections.error.message}
              </p>
              <Button size="sm" variant="outline" onClick={() => void connections.refetch()}>
                Try again
              </Button>
            </div>
          )}

          {connections.data?.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
              <PlugIcon className="size-8 text-muted-foreground" aria-hidden />
              <div className="space-y-1">
                <p className="font-medium">Nothing connected yet</p>
                <p className="max-w-sm text-muted-foreground text-sm">
                  Connect a service below and its credentials become available to every flow in this workspace.
                </p>
              </div>
            </div>
          )}

          {connections.data && connections.data.length > 0 && (
            <CardGrid>
              {connections.data.map((connection) => (
                <ConnectionCard key={connection.id} connection={connection} label={labelFor(connection.providerId)} />
              ))}
            </CardGrid>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="font-medium text-sm">Available</h2>

          {catalogue.isPending && (
            <CardGrid>
              <span className="sr-only">Loading the catalogue…</span>
              {Array.from({ length: 4 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity to key by.
                <CardSkeleton key={index} />
              ))}
            </CardGrid>
          )}

          <CardGrid>
            {catalogue.data?.map((connector) => (
              <ConnectorCard
                key={connector.id}
                connector={connector}
                connectedCount={
                  connections.data?.filter((connection) => connection.providerId === connector.id).length ?? 0
                }
              />
            ))}
          </CardGrid>
        </section>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/app/connections")({
  validateSearch: (search: Record<string, unknown>): { connected?: string } =>
    typeof search[CONNECTED_PARAM] === "string" ? { connected: search[CONNECTED_PARAM] } : {},
  component: ConnectionsPage,
});
