import {
  config,
  type Flow,
  type FlowDefinition,
  flowDefinitionSchema,
  listSampleVariables,
  readTriggerText,
} from "@automend/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckIcon, CircleAlertIcon, LoaderCircleIcon, WebhookIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FlowCanvas } from "@/components/flows/flow-canvas";
import { NodeInspector } from "@/components/flows/node-inspector";
import { ShortcutsHelp } from "@/components/flows/shortcuts-help";
import { StepPalette } from "@/components/flows/step-palette";
import { useFlowShortcuts } from "@/components/flows/use-flow-shortcuts";
import { WebhookDrawer } from "@/components/flows/webhook-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { connectionQueryKeys, listConnections } from "@/lib/connections-api";
import { duplicateStep, isTrigger, removeStep } from "@/lib/flow-editor";
import { flowQueryKeys, getFlow, listDeliveries, updateFlow } from "@/lib/flows-api";
import { fetchKitCatalogue, findTriggerSummary, kitQueryKeys } from "@/lib/kits-api";

const { routes, flowIdParam } = config.webClient;
const { flowName } = config.validation;

/**
 * The first problem the definition has, phrased for the person editing it.
 *
 * The same schema runs on the API, so this is not the check that protects the database — it is
 * what stops the author reaching for Save and being told no by a server round trip.
 */
function findDefinitionProblem(definition: FlowDefinition): string | undefined {
  const result = flowDefinitionSchema.safeParse(definition);

  return result.success ? undefined : result.error.issues[0]?.message;
}

/**
 * Whether the work on screen is safe.
 *
 * A validation problem is the one state that must not read as ordinary muted text — it is the
 * reason the Save button is disabled, so it is coloured and carries an icon rather than relying on
 * colour alone. Announced politely so a screen reader hears the change without being interrupted.
 */
function SaveStatus({
  isSaving,
  problem,
  hasUnsavedChanges,
}: {
  isSaving: boolean;
  problem: string | undefined;
  hasUnsavedChanges: boolean;
}) {
  if (problem) {
    return (
      <span aria-live="polite" className="flex max-w-xs items-center gap-1.5 text-destructive text-xs" title={problem}>
        <CircleAlertIcon className="size-3.5 shrink-0" />
        <span className="truncate">{problem}</span>
      </span>
    );
  }

  const label = isSaving ? "Saving…" : hasUnsavedChanges ? "Unsaved changes" : "All changes saved";

  return (
    <span aria-live="polite" className="flex items-center gap-1.5 text-muted-foreground text-xs">
      {isSaving ? (
        <LoaderCircleIcon className="size-3.5 animate-spin" />
      ) : hasUnsavedChanges ? (
        <span className="size-1.5 rounded-full bg-muted-foreground" />
      ) : (
        <CheckIcon className="size-3.5" />
      )}
      {label}
    </span>
  );
}

function FlowBuilder({ flow }: { flow: Flow }) {
  const queryClient = useQueryClient();

  const [name, setName] = useState(flow.name);
  const [definition, setDefinition] = useState<FlowDefinition>(flow.definition);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [isShowingShortcuts, setIsShowingShortcuts] = useState(false);
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    JSON.stringify({ name: flow.name, definition: flow.definition }),
  );

  // Another tab, or a reload, can bring a newer version of the flow than the one this component
  // started with; adopting it is better than silently editing a stale copy.
  useEffect(() => {
    setName(flow.name);
    setDefinition(flow.definition);
    setSavedSnapshot(JSON.stringify({ name: flow.name, definition: flow.definition }));
  }, [flow]);

  const save = useMutation({
    mutationFn: () => updateFlow(flow.id, { name: name.trim(), definition }),
    onSuccess: async (updated) => {
      setSavedSnapshot(JSON.stringify({ name: updated.name, definition: updated.definition }));
      queryClient.setQueryData(flowQueryKeys.detail(flow.id), updated);
      await queryClient.invalidateQueries({ queryKey: flowQueryKeys.lists() });
    },
  });

  /**
   * The kit catalogue: what a step or trigger can be, and what fields each one has.
   *
   * Fetched once and kept, because it only changes when the API is redeployed. Every builder surface reads from
   * it — the canvas for a node's summary, the picker for the list, the inspector for the form — so a single
   * query feeds all three rather than each fetching its own.
   */
  const catalogueQuery = useQuery({
    queryKey: kitQueryKeys.catalogue(),
    queryFn: ({ signal }) => fetchKitCatalogue(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const catalogue = catalogueQuery.data;

  /**
   * The workspace's connections, so a step can be pointed at the account it acts as.
   *
   * Loaded here rather than inside the inspector because the palette and the canvas need them too: a step that
   * needs a connection is given one the moment it is created, when there is only one it could be. Deciding that
   * when the panel opens instead would mean looking at a node changed the flow.
   */
  const connectionsQuery = useQuery({
    queryKey: connectionQueryKeys.list(),
    queryFn: ({ signal }) => listConnections(signal),
  });

  const connections = connectionsQuery.data ?? [];

  /**
   * Whether the trigger listens on a URL, and if so at which path.
   *
   * `draft` and `saved` are two different things, and conflating them is what made a freshly switched trigger
   * answer 404: the draft decides whether the builder *offers* webhook tooling, the saved definition decides
   * whether an address actually exists, because that is what the API routes on.
   *
   * "Is this a webhook trigger" comes from the catalogue's `strategy` rather than from a hardcoded kit id, so a
   * second kit that also listens on a URL gets the same tooling without this file changing.
   */
  const isWebhookTrigger = (candidate: FlowDefinition) =>
    catalogue !== undefined &&
    findTriggerSummary(catalogue, candidate.trigger.kitId, candidate.trigger.triggerName)?.strategy === "webhook";

  const draftWebhookPath = isWebhookTrigger(definition) ? readTriggerText(definition.trigger, "path") : undefined;
  const savedWebhookPath = isWebhookTrigger(flow.definition)
    ? readTriggerText(flow.definition.trigger, "path")
    : undefined;

  /**
   * The variables a step can name, taken from the most recent delivery.
   *
   * Derived from data the flow actually received rather than from a schema someone declared: the
   * field names in the last payload are, by definition, the ones that will be there next time.
   */
  const deliveries = useQuery({
    queryKey: flowQueryKeys.deliveries(flow.id),
    queryFn: ({ signal }) => listDeliveries(flow.id, signal),
    enabled: savedWebhookPath !== undefined,
  });

  /**
   * What a `{{variable}}` in this flow may refer to, derived from the last request it received.
   *
   * Two things here are load-bearing, and getting either wrong makes every chip the picker inserts
   * unresolvable at run time:
   *
   * - the paths are prefixed with `trigger`, because that is where the run context puts the trigger's
   *   output. A path taken straight from the body — `{{email}}` — resolves to nothing, and the literal
   *   travels on to whatever the step talks to.
   * - the *whole* delivery is offered, not just its body, so `{{trigger.method}}` and the headers are
   *   reachable as well. The engine already resolves them; only the picker did not say so.
   *
   * `body` is listed first because it is what anybody is looking for, and the picker keeps insertion
   * order.
   */
  const variables = useMemo(() => {
    const latest = deliveries.data?.[0];

    if (!latest) {
      return [];
    }

    let body: unknown;

    try {
      body = latest.body === null ? null : JSON.parse(latest.body);
    } catch {
      // A delivery that is not JSON offers no named fields inside it. That is a fact about the payload
      // rather than an error worth showing, and the request's own metadata is still worth offering.
      body = null;
    }

    return listSampleVariables(
      { body, method: latest.method, path: latest.path, query: latest.query, headers: latest.headers },
      config.flows.templates.triggerVariablePrefix,
    );
  }, [deliveries.data]);

  const problem = findDefinitionProblem(definition);
  const hasUnsavedChanges = JSON.stringify({ name, definition }) !== savedSnapshot;
  const canSave = hasUnsavedChanges && !problem && name.trim().length >= flowName.minLength && !save.isPending;

  useFlowShortcuts({
    onSave: () => {
      if (canSave) {
        save.mutate();
      }
    },
    onDeleteSelected: () => {
      // The trigger is not deletable: a flow without one could never start.
      if (selectedNodeId && !isTrigger(definition, selectedNodeId)) {
        setDefinition(removeStep(definition, selectedNodeId));
        setSelectedNodeId(undefined);
      }
    },
    onDuplicateSelected: () => {
      if (!selectedNodeId) {
        return;
      }

      const duplicated = duplicateStep(definition, selectedNodeId);

      if (duplicated) {
        setDefinition(duplicated.definition);
        setSelectedNodeId(duplicated.stepId);
      }
    },
    onClearSelection: () => setSelectedNodeId(undefined),
    onToggleShortcuts: () => setIsShowingShortcuts((showing) => !showing),
  });

  return (
    // `min-h-0` so the row below can shrink and hand its overflow to the panels inside it, rather than growing and
    // pushing the whole page taller.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <Link to={routes.flows} className="text-muted-foreground text-sm hover:text-foreground">
          ← Flows
        </Link>

        <Input
          aria-label="Flow name"
          value={name}
          maxLength={flowName.maxLength}
          onChange={(event) => setName(event.target.value)}
          className="h-8 w-full max-w-xs"
        />

        <StepPalette
          definition={definition}
          catalogue={catalogue}
          connections={connections}
          onChange={setDefinition}
          onSelect={setSelectedNodeId}
        />

        {draftWebhookPath !== undefined && (
          <Button variant="outline" size="sm" onClick={() => setIsTestingWebhook((testing) => !testing)}>
            <WebhookIcon data-icon="inline-start" />
            {isTestingWebhook ? "Hide test" : "Test webhook"}
          </Button>
        )}

        <div className="ml-auto flex items-center gap-3">
          <SaveStatus isSaving={save.isPending} problem={problem} hasUnsavedChanges={hasUnsavedChanges} />
          <ShortcutsHelp open={isShowingShortcuts} onOpenChange={setIsShowingShortcuts} />
          <Button size="sm" disabled={!canSave} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>

      {save.isError && (
        <p role="alert" className="border-b bg-destructive/10 px-6 py-2 text-destructive text-sm">
          {save.error.message}
        </p>
      )}

      {/* Each child owns its own scrolling. Below `lg` the three stack and this column scrolls between them,
          because a 26rem panel beside a canvas on a phone is not a layout. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="h-[60vh] flex-1 lg:h-auto lg:min-h-0">
          <FlowCanvas
            definition={definition}
            selectedNodeId={selectedNodeId}
            catalogue={catalogue}
            connections={connections}
            onChange={setDefinition}
            onSelect={setSelectedNodeId}
          />
        </div>

        <NodeInspector
          flowId={flow.id}
          variables={variables}
          savedWebhookPath={savedWebhookPath}
          definition={definition}
          selectedNodeId={selectedNodeId}
          catalogue={catalogue}
          catalogueError={catalogueQuery.error}
          connections={connections}
          onRetryCatalogue={() => void catalogueQuery.refetch()}
          onChange={setDefinition}
          onSelect={setSelectedNodeId}
        />

        {draftWebhookPath !== undefined && (
          <WebhookDrawer
            flowId={flow.id}
            savedPath={savedWebhookPath}
            open={isTestingWebhook}
            onOpenChange={setIsTestingWebhook}
          />
        )}
      </div>
    </div>
  );
}

function FlowBuilderPage() {
  const { [flowIdParam]: flowId } = Route.useParams();

  const flow = useQuery({
    queryKey: flowQueryKeys.detail(flowId),
    queryFn: ({ signal }) => getFlow(flowId, signal),
  });

  if (flow.isPending) {
    return <p className="px-6 py-10 text-muted-foreground">Loading…</p>;
  }

  if (flow.isError) {
    return (
      <div className="space-y-3 px-6 py-10">
        <p className="text-destructive">{flow.error.message}</p>
        <Link to={routes.flows} className="text-sm underline underline-offset-4">
          Back to flows
        </Link>
      </div>
    );
  }

  return <FlowBuilder flow={flow.data} />;
}

export const Route = createFileRoute("/app/flows/$flowId")({
  component: FlowBuilderPage,
});
