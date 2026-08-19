import type { KitCatalogue, KitCatalogueEntry } from "@automend/kit-framework";
import {
  buildWebhookPath,
  type Connection,
  config,
  type FlowDefinition,
  readTriggerText,
  type TemplateVariable,
} from "@automend/shared";
import { Link } from "@tanstack/react-router";
import { CheckIcon, CopyIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  findNode,
  isTrigger,
  removeStep,
  renameNode,
  setStepAction,
  setStepConnection,
  setStepContinueOnFailure,
  setStepInput,
  setTriggerAction,
  setTriggerConnection,
  setTriggerInput,
} from "@/lib/flow-editor";
import {
  type ActionChoice,
  buildDefaultInput,
  describeConnection,
  findActionTarget,
  findKitEntry,
  findTriggerSummary,
  findTriggerTarget,
  listActionChoices,
  listTriggerChoices,
  listUsableConnections,
  pickDefaultConnection,
} from "@/lib/kits-api";
import { PropertyFields } from "./property-field";

const { validation } = config;
const { routes } = config.webClient;

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {/* Persistent helper text rather than a placeholder, which disappears exactly when it is needed. */}
      {hint && <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p>}
    </div>
  );
}

/** Amber rather than red: something needs attention, but nothing is broken. */
function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-node-amber/10 px-3 py-2.5 text-node-amber text-xs leading-relaxed">{children}</p>;
}

/**
 * The address this flow actually listens on, ready to paste into whatever will call it.
 *
 * Read-only and built from the flow's id, because it is not a preference — it is where the API routes. Shown in
 * full, and treated as a credential: anyone holding it can start this flow, which is what the warning
 * underneath says.
 */
function WebhookUrl({ flowId, path, isLive }: { flowId: string; path: string; isLive: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${buildWebhookPath(flowId, path.trim())}`;

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="webhook-url">URL</Label>
      <div className="relative">
        <p
          id="webhook-url"
          className="max-h-24 overflow-y-auto break-all rounded-lg bg-muted py-2 pr-9 pl-2.5 font-mono text-xs"
        >
          {url}
        </p>
        <IconAction
          label={copied ? "Copied" : "Copy the URL"}
          tone={copied ? "view" : "neutral"}
          className="absolute top-1 right-1"
          onClick={() => void copy()}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </IconAction>
      </div>
      {isLive ? (
        <p className="text-muted-foreground text-xs leading-relaxed">
          Accepts any method. Anyone with this URL can start the flow, so treat it like a password.
        </p>
      ) : (
        // The API routes on the saved definition, so an unsaved change has no address behind it — said here
        // rather than left to a 404 that cannot explain itself.
        <Notice>Save the flow to activate this address. Until then requests to it are refused.</Notice>
      )}
    </div>
  );
}

/**
 * The picker for what a node does, grouped by kit.
 *
 * Grouped because "which service" is the question an author asks first, and a flat list of every action across
 * every kit stops being scannable at the third kit.
 *
 * An unavailable option is shown *disabled with a reason* rather than hidden. Hiding it means an author who
 * knows Automend supports Gmail cannot find out why they cannot use it; disabling it points at the thing they
 * need to do.
 */
function KitMemberSelect<Choice extends { kitId: string; kitName: string; displayName: string; available: boolean }>({
  id,
  value,
  choices,
  isDisabled,
  disabledReason,
  onPick,
}: {
  id: string;
  value: string;
  choices: Choice[];
  isDisabled: (choice: Choice) => boolean;
  disabledReason: (choice: Choice) => string;
  onPick: (choice: Choice) => void;
}) {
  const byKit = new Map<string, Choice[]>();

  for (const choice of choices) {
    const existing = byKit.get(choice.kitName);

    if (existing) {
      existing.push(choice);
    } else {
      byKit.set(choice.kitName, [choice]);
    }
  }

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const picked = choices.find((choice) => keyOf(choice) === next);

        if (picked) {
          onPick(picked);
        }
      }}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder="Choose one" />
      </SelectTrigger>
      <SelectContent>
        {[...byKit.entries()].map(([kitName, group]) => (
          <SelectGroupBlock key={kitName} label={kitName}>
            {group.map((choice) => (
              <SelectItem key={keyOf(choice)} value={keyOf(choice)} disabled={isDisabled(choice)}>
                {choice.displayName}
                {isDisabled(choice) && (
                  <span className="ml-1.5 text-muted-foreground text-xs">— {disabledReason(choice)}</span>
                )}
              </SelectItem>
            ))}
          </SelectGroupBlock>
        ))}
      </SelectContent>
    </Select>
  );
}

/** `kitId.name` — the one spelling of the pair, so the select's value and the lookup cannot disagree. */
function keyOf(choice: { kitId: string; actionName?: string; triggerName?: string }): string {
  return `${choice.kitId}.${choice.actionName ?? choice.triggerName ?? ""}`;
}

function SelectGroupBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <p className="px-2 py-1.5 font-medium text-muted-foreground text-xs">{label}</p>
      {children}
    </>
  );
}

/** The value the select uses for "act as nobody", since a Radix item cannot carry an empty value. */
const NO_CONNECTION = "__none__";

/**
 * Which account this node acts as.
 *
 * Only rendered for a kit that needs credentials — most do not, and an empty "Connection" field on a `core.log`
 * step would be a question with no answer.
 *
 * Three states, and each is a different situation rather than a variation of one:
 *
 * - **None connected.** Not a field at all: there is nothing to choose. It says what to do and links to where.
 * - **Exactly one.** Shown, and already selected — chosen when the step was created, because making somebody pick
 *   from a list of one teaches them nothing and can only be got wrong by leaving it blank.
 * - **Several.** A real choice, labelled by the *account* rather than only the connection's name, because two
 *   Gmail connections differ by mailbox and their names are whatever somebody typed.
 */
function ConnectionField({
  kit,
  connections,
  selected,
  idPrefix,
  onChange,
}: {
  kit: KitCatalogueEntry;
  connections: readonly Connection[];
  selected: string | undefined;
  idPrefix: string;
  onChange: (connectionId: string | undefined) => void;
}) {
  if (!kit.auth) {
    return null;
  }

  const usable = listUsableConnections(connections, kit);
  const fieldId = `${idPrefix}-connection`;

  if (usable.length === 0) {
    return (
      <Notice>
        No {kit.displayName} account is connected yet, so this cannot run. Connect one under{" "}
        <Link to={routes.connections} className="underline underline-offset-2">
          Connections
        </Link>
        , then choose it here.
      </Notice>
    );
  }

  return (
    <Field label="Connection" htmlFor={fieldId} hint={`Which ${kit.displayName} account this acts as.`}>
      <Select
        value={selected ?? NO_CONNECTION}
        onValueChange={(value) => onChange(value === NO_CONNECTION ? undefined : value)}
      >
        <SelectTrigger id={fieldId} aria-invalid={selected === undefined || undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {/* Offered so a choice can be undone. A step with none saves and fails at run time, which the notice
              below the field says plainly rather than leaving to be discovered. */}
          <SelectItem value={NO_CONNECTION}>Not chosen yet</SelectItem>
          {usable.map((connection) => (
            <SelectItem key={connection.id} value={connection.id}>
              {describeConnection(connection)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export type NodeInspectorProps = {
  /** Needed for the webhook URL, which is built from the flow this node belongs to. */
  flowId: string;
  /** Derived from the last delivery, so a step offers the fields the flow actually receives. */
  variables: TemplateVariable[];
  /** The webhook path as stored, so the builder can say whether the address is live yet. */
  savedWebhookPath: string | undefined;
  definition: FlowDefinition;
  selectedNodeId: string | undefined;
  /** Undefined while it is still loading, so the panel can say so rather than rendering an empty form. */
  catalogue: KitCatalogue | undefined;
  catalogueError: Error | null;
  /** The workspace's connections, so a step can be pointed at the account it acts as. */
  connections: readonly Connection[];
  onRetryCatalogue: () => void;
  onChange: (definition: FlowDefinition) => void;
  onSelect: (nodeId: string | undefined) => void;
};

/**
 * The panel is the scroll container, not the page.
 *
 * `lg:min-h-0` alongside `lg:h-full` is what makes that true: without it the panel's flex `min-height: auto`
 * refuses to shrink below its content, the inner `overflow-y-auto` has nothing to overflow within, and the
 * overflow escapes to the document — which scrolls the canvas and the header off-screen to show a form field.
 */
const PANEL_CLASS =
  "flex w-full shrink-0 flex-col border-t bg-card/40 lg:h-full lg:min-h-0 lg:w-[26rem] lg:border-t-0 lg:border-l xl:w-[30rem]";

function Panel({ children }: { children: ReactNode }) {
  return (
    <aside className={PANEL_CLASS} aria-label="Node settings">
      {children}
    </aside>
  );
}

/**
 * Everything about the selected node, edited in place.
 *
 * The fields are rendered from the kit catalogue rather than written out per step kind. That is the whole point
 * of the kit model reaching the UI: a kit declares its properties and the form appears, so adding a service
 * never means adding a panel.
 *
 * All four states of the catalogue fetch are handled below, because three of them are reachable in normal use —
 * a slow first load, an API that is down, and a deployment with no kits configured.
 */
export function NodeInspector({
  flowId,
  variables,
  savedWebhookPath,
  definition,
  selectedNodeId,
  catalogue,
  catalogueError,
  connections,
  onRetryCatalogue,
  onChange,
  onSelect,
}: NodeInspectorProps) {
  const node = selectedNodeId ? findNode(definition, selectedNodeId) : undefined;
  // Held separately from `node` so the step-only fields below are narrowed by the type system rather than by a
  // cast that would survive the shape changing.
  const step = definition.steps.find((candidate) => candidate.id === selectedNodeId);

  if (!node || !selectedNodeId) {
    return (
      <Panel>
        <div className="space-y-3 p-6 text-sm">
          <p className="font-medium text-foreground">Nothing selected</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Choose a node to edit its settings, or drag from the dot beneath one node to the dot above another to
            connect them.
          </p>
        </div>
      </Panel>
    );
  }

  if (catalogueError) {
    return (
      <Panel>
        <div className="space-y-3 p-6 text-sm">
          <p className="font-medium text-foreground">Settings are unavailable</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            The list of available services could not be loaded, so there is nothing to build a form from. Your flow is
            untouched.
          </p>
          {/* An error that offers a way forward rather than only a diagnosis. */}
          <Button variant="secondary" size="sm" onClick={onRetryCatalogue}>
            Try again
          </Button>
        </div>
      </Panel>
    );
  }

  if (!catalogue) {
    return (
      <Panel>
        {/* Skeletons rather than a spinner: the shape of what is coming, so the panel does not jump when it
            arrives. Announced politely so a screen reader is told the wait exists. */}
        <div className="space-y-5 p-6" aria-live="polite" aria-busy="true">
          <span className="sr-only">Loading settings</span>
          {[0, 1, 2].map((row) => (
            <div key={row} className="space-y-2">
              <div className="h-3 w-20 rounded bg-muted" />
              <div className="h-9 rounded-lg bg-muted/60" />
            </div>
          ))}
        </div>
      </Panel>
    );
  }

  if (catalogue.length === 0) {
    return (
      <Panel>
        <div className="space-y-3 p-6 text-sm">
          <p className="font-medium text-foreground">No services are configured</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            This deployment has no kits installed, so there is nothing a step could do yet.
          </p>
        </div>
      </Panel>
    );
  }

  const nodeIsTrigger = isTrigger(definition, selectedNodeId);

  return (
    <Panel>
      <header className="space-y-1 border-b px-5 py-4">
        <h2 className="font-medium text-sm">{nodeIsTrigger ? "Trigger" : "Step"}</h2>
        <p className="text-muted-foreground text-xs">
          {nodeIsTrigger ? "How this flow starts." : "What this step does when it is reached."}
        </p>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <Field label="Name" htmlFor="node-name" hint="What you call this node. Only you see it.">
          <Input
            id="node-name"
            value={node.name}
            maxLength={validation.flowNodeName.maxLength}
            onChange={(event) => onChange(renameNode(definition, selectedNodeId, event.target.value))}
          />
        </Field>

        {nodeIsTrigger ? (
          <TriggerSection
            flowId={flowId}
            catalogue={catalogue}
            connections={connections}
            definition={definition}
            savedWebhookPath={savedWebhookPath}
            variables={variables}
            onChange={onChange}
          />
        ) : (
          step && (
            <StepSection
              catalogue={catalogue}
              connections={connections}
              definition={definition}
              step={step}
              variables={variables}
              onChange={onChange}
            />
          )
        )}
      </div>

      {/* Kept apart from the fields above, so a destructive action is never a mis-click away. */}
      {step && (
        <footer className="border-t px-5 py-4">
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={() => {
              onChange(removeStep(definition, selectedNodeId));
              onSelect(undefined);
            }}
          >
            <Trash2Icon data-icon="inline-start" />
            Delete step
          </Button>
        </footer>
      )}
    </Panel>
  );
}

function TriggerSection({
  flowId,
  catalogue,
  connections,
  definition,
  savedWebhookPath,
  variables,
  onChange,
}: {
  flowId: string;
  catalogue: KitCatalogue;
  connections: readonly Connection[];
  definition: FlowDefinition;
  savedWebhookPath: string | undefined;
  variables: TemplateVariable[];
  onChange: (definition: FlowDefinition) => void;
}) {
  const { trigger } = definition;
  const choices = listTriggerChoices(catalogue);
  const target = findTriggerTarget(catalogue, trigger.kitId, trigger.triggerName);
  const summary = findTriggerSummary(catalogue, trigger.kitId, trigger.triggerName);
  const path = readTriggerText(trigger, "path");

  return (
    <>
      <Field label="Starts when" htmlFor="trigger-choice">
        <KitMemberSelect
          id="trigger-choice"
          value={`${trigger.kitId}.${trigger.triggerName}`}
          choices={choices}
          // Two separate reasons a trigger cannot be used, and they need different fixes: no credentials for the
          // service, or no scheduler for this kind of trigger yet.
          isDisabled={(choice) => !choice.available || !choice.schedulable}
          disabledReason={(choice) => (choice.available ? "not scheduled yet" : "needs a connection")}
          onPick={(choice) =>
            onChange(
              setTriggerAction(definition, {
                kitId: choice.kitId,
                triggerName: choice.triggerName,
                displayName: choice.displayName,
                input: buildDefaultInput(choice.properties),
                connectionId: pickDefaultConnection(connections, findKitEntry(catalogue, choice.kitId)),
              }),
            )
          }
        />
      </Field>

      {!target && (
        <Notice>
          This flow starts on <span className="font-mono">{`${trigger.kitId}.${trigger.triggerName}`}</span>, which this
          deployment does not have. Choose another trigger to make the flow runnable again.
        </Notice>
      )}

      {summary && !summary.schedulable && (
        // Said plainly rather than left to be discovered: the flow saves, and nothing fires it.
        <Notice>
          Nothing fires this kind of trigger yet, so the flow will save but never start on its own. You can still run it
          by hand.
        </Notice>
      )}

      {target && (
        <>
          <ConnectionField
            kit={target.kit}
            connections={connections}
            selected={trigger.connectionId}
            idPrefix="trigger"
            onChange={(connectionId) => onChange(setTriggerConnection(definition, connectionId))}
          />

          <PropertyFields
            properties={target.properties}
            idPrefix="trigger"
            input={trigger.input}
            variables={variables}
            onChange={(name, value) => onChange(setTriggerInput(definition, name, value))}
          />
        </>
      )}

      {summary?.strategy === "webhook" && (
        <WebhookUrl
          flowId={flowId}
          path={path ?? ""}
          isLive={savedWebhookPath !== undefined && savedWebhookPath === path}
        />
      )}
    </>
  );
}

function StepSection({
  catalogue,
  connections,
  definition,
  step,
  variables,
  onChange,
}: {
  catalogue: KitCatalogue;
  connections: readonly Connection[];
  definition: FlowDefinition;
  step: FlowDefinition["steps"][number];
  variables: TemplateVariable[];
  onChange: (definition: FlowDefinition) => void;
}) {
  const choices = listActionChoices(catalogue);
  const target = findActionTarget(catalogue, step.kitId, step.actionName);
  /** Saveable without one — an unfinished step is a normal thing to have — but a run reaching it will fail. */
  const needsConnection =
    target?.kit.auth != null &&
    step.connectionId === undefined &&
    listUsableConnections(connections, target.kit).length > 0;

  return (
    <>
      <Field label="Does" htmlFor="step-choice">
        <KitMemberSelect
          id="step-choice"
          value={`${step.kitId}.${step.actionName}`}
          choices={choices}
          isDisabled={(choice: ActionChoice) => !choice.available}
          disabledReason={() => "needs a connection"}
          onPick={(choice: ActionChoice) =>
            onChange(
              setStepAction(definition, step.id, {
                kitId: choice.kitId,
                actionName: choice.actionName,
                displayName: choice.displayName,
                input: buildDefaultInput(choice.properties),
                connectionId: pickDefaultConnection(connections, findKitEntry(catalogue, choice.kitId)),
              }),
            )
          }
        />
      </Field>

      {!target && (
        <Notice>
          This step runs <span className="font-mono">{`${step.kitId}.${step.actionName}`}</span>, which this deployment
          does not have. Choose another action to make the flow runnable again.
        </Notice>
      )}

      {target && (
        <>
          <p className="text-muted-foreground text-xs leading-relaxed">{target.description}</p>

          <ConnectionField
            kit={target.kit}
            connections={connections}
            selected={step.connectionId}
            idPrefix={`step-${step.id}`}
            onChange={(connectionId) => onChange(setStepConnection(definition, step.id, connectionId))}
          />

          <PropertyFields
            properties={target.properties}
            idPrefix={`step-${step.id}`}
            input={step.input}
            variables={variables}
            onChange={(name, value) => onChange(setStepInput(definition, step.id, name, value))}
          />

          {needsConnection && (
            // Said while somebody is looking at the step, rather than left to a run that fails a minute later.
            <Notice>Choose a {target.kit.displayName} connection above, or this step will fail when it runs.</Notice>
          )}

          <Field
            label="If this step fails"
            htmlFor={`step-${step.id}-continue`}
            hint="By default a failure stops the run, and later steps do not happen."
          >
            <Select
              value={step.continueOnFailure ? "continue" : "stop"}
              onValueChange={(choice) => onChange(setStepContinueOnFailure(definition, step.id, choice === "continue"))}
            >
              <SelectTrigger id={`step-${step.id}-continue`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stop">Stop the run</SelectItem>
                <SelectItem value="continue">Carry on to the next step</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </>
      )}
    </>
  );
}
