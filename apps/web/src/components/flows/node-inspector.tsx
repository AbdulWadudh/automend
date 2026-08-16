import {
  buildWebhookPath,
  config,
  type FlowDefinition,
  type FlowStepConfig,
  type FlowTriggerConfig,
  type TemplateVariable,
} from "@automend/shared";
import { CheckIcon, CopyIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IconAction } from "@/components/ui/tooltip";
import {
  findNode,
  isTrigger,
  removeStep,
  renameNode,
  setStepConfig,
  setStepKind,
  setTriggerConfig,
  setTriggerKind,
} from "@/lib/flow-editor";
import { STEP_KIND_LABELS, TRIGGER_KIND_LABELS } from "@/lib/flow-kinds";
import { TemplateField } from "./template-field/template-field";

const { flows: flowConfig, validation } = config;

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

/**
 * The address this flow actually listens on, ready to paste into whatever will call it.
 *
 * Read-only and built from the flow's id, because it is not a preference — it is where the API
 * routes. Shown in full, and treated as a credential: anyone holding it can start this flow, which
 * is what the warning underneath says.
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
        // The API routes on the saved definition, so an unsaved change has no address behind it —
        // said here rather than left to a 404 that cannot explain itself.
        <p className="rounded-lg bg-node-amber/10 px-3 py-2.5 text-node-amber text-xs leading-relaxed">
          Save the flow to activate this address. Until then requests to it are refused.
        </p>
      )}
    </div>
  );
}

function TriggerFields({
  flowId,
  savedWebhookPath,
  triggerConfig,
  onChange,
}: {
  flowId: string;
  savedWebhookPath: string | undefined;
  triggerConfig: FlowTriggerConfig;
  onChange: (next: FlowTriggerConfig) => void;
}) {
  switch (triggerConfig.kind) {
    case "manual":
      return (
        <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-muted-foreground text-xs leading-relaxed">
          This flow runs only when you start it yourself.
        </p>
      );

    case "webhook":
      return (
        <>
          <Field label="Path" htmlFor="webhook-path" hint="A label for this hook. It becomes the end of the URL.">
            <Input
              id="webhook-path"
              value={triggerConfig.path}
              maxLength={validation.webhookPath.maxLength}
              onChange={(event) => onChange({ ...triggerConfig, path: event.target.value })}
            />
          </Field>

          <WebhookUrl
            flowId={flowId}
            path={triggerConfig.path}
            isLive={savedWebhookPath === triggerConfig.path.trim()}
          />
        </>
      );

    case "schedule":
      return (
        <Field label="Cron expression" htmlFor="cron" hint="Five fields: minute, hour, day, month, weekday.">
          <Input
            id="cron"
            value={triggerConfig.cron}
            maxLength={validation.cronExpression.maxLength}
            className="font-mono"
            onChange={(event) => onChange({ ...triggerConfig, cron: event.target.value })}
          />
        </Field>
      );
  }
}

function StepFields({
  stepConfig,
  variables,
  onChange,
}: {
  stepConfig: FlowStepConfig;
  variables: TemplateVariable[];
  onChange: (next: FlowStepConfig) => void;
}) {
  switch (stepConfig.kind) {
    case "http-request":
      return (
        <>
          <Field label="Method" htmlFor="http-method">
            <Select
              value={stepConfig.method}
              onValueChange={(method) => onChange({ ...stepConfig, method: method as typeof stepConfig.method })}
            >
              <SelectTrigger id="http-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {flowConfig.httpMethods.map((method) => (
                  <SelectItem key={method} value={method}>
                    {method}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="URL" htmlFor="http-url" hint="Type {{ to insert data the flow received.">
            <TemplateField
              id="http-url"
              value={stepConfig.url}
              variables={variables}
              onChange={(url) => onChange({ ...stepConfig, url })}
            />
          </Field>
        </>
      );

    case "send-email":
      return (
        <>
          <Field label="To" htmlFor="email-to" hint="Comma-separated. Type {{ to insert a variable.">
            <TemplateField
              id="email-to"
              value={stepConfig.to}
              variables={variables}
              placeholder="{{email}}, someone@example.com"
              onChange={(to) => onChange({ ...stepConfig, to })}
            />
          </Field>

          <Field label="Subject" htmlFor="email-subject">
            <TemplateField
              id="email-subject"
              value={stepConfig.subject}
              variables={variables}
              onChange={(subject) => onChange({ ...stepConfig, subject })}
            />
          </Field>

          <Field label="Body" htmlFor="email-body">
            <TemplateField
              id="email-body"
              value={stepConfig.body}
              variables={variables}
              multiline
              rich
              placeholder={"Hi {{name}}, {{message}}"}
              onChange={(body) => onChange({ ...stepConfig, body })}
            />
          </Field>

          {/* Said plainly rather than hidden: the step saves and validates, and nothing sends it. */}
          <p className="rounded-lg bg-node-amber/10 px-3 py-2.5 text-node-amber text-xs leading-relaxed">
            This step can be designed and saved, but nothing sends it yet — the execution engine is not built.
          </p>
        </>
      );

    case "delay":
      return (
        <Field label="Wait for" htmlFor="delay-duration" hint="In milliseconds, up to one hour.">
          <Input
            id="delay-duration"
            type="number"
            inputMode="numeric"
            min={flowConfig.delay.minMs}
            max={flowConfig.delay.maxMs}
            value={stepConfig.durationMs}
            className="tabular-nums"
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              onChange({ ...stepConfig, durationMs: Number.isNaN(parsed) ? flowConfig.delay.minMs : parsed });
            }}
          />
        </Field>
      );

    case "log":
      return (
        <Field label="Message" htmlFor="log-message" hint="Type {{ to insert data the flow received.">
          <TemplateField
            id="log-message"
            value={stepConfig.message}
            variables={variables}
            onChange={(message) => onChange({ ...stepConfig, message })}
          />
        </Field>
      );
  }
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
  onChange: (definition: FlowDefinition) => void;
  onSelect: (nodeId: string | undefined) => void;
};

const PANEL_CLASS =
  "flex w-full shrink-0 flex-col border-t bg-card/40 lg:h-full lg:w-[26rem] lg:border-t-0 lg:border-l xl:w-[30rem]";

/**
 * Everything about the selected node, edited in place.
 *
 * Changing a node's kind replaces its settings rather than merging them, which is why the fields
 * are driven by the config union: a delay genuinely has nothing in common with an HTTP request,
 * and pretending otherwise leaves stale values behind.
 */
export function NodeInspector({
  flowId,
  variables,
  savedWebhookPath,
  definition,
  selectedNodeId,
  onChange,
  onSelect,
}: NodeInspectorProps) {
  const node = selectedNodeId ? findNode(definition, selectedNodeId) : undefined;
  // Held separately from `node` so the step-only fields below are narrowed by the type system
  // rather than by a cast that would survive the union changing.
  const step = definition.steps.find((candidate) => candidate.id === selectedNodeId);

  if (!node || !selectedNodeId) {
    return (
      <aside className={PANEL_CLASS} aria-label="Node settings">
        <div className="space-y-3 p-6 text-sm">
          <p className="font-medium text-foreground">Nothing selected</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Choose a node to edit its settings, or drag from the dot beneath one node to the dot above another to
            connect them.
          </p>
        </div>
      </aside>
    );
  }

  const nodeIsTrigger = isTrigger(definition, selectedNodeId);

  return (
    <aside className={PANEL_CLASS} aria-label="Node settings">
      <header className="space-y-1 border-b px-5 py-4">
        <h2 className="font-medium text-sm">{nodeIsTrigger ? "Trigger" : "Step"}</h2>
        <p className="text-muted-foreground text-xs">
          {nodeIsTrigger ? "How this flow starts." : "What this step does when it is reached."}
        </p>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <Field label="Name" htmlFor="node-name">
          <Input
            id="node-name"
            value={node.name}
            maxLength={validation.flowNodeName.maxLength}
            onChange={(event) => onChange(renameNode(definition, selectedNodeId, event.target.value))}
          />
        </Field>

        {nodeIsTrigger ? (
          <>
            <Field label="Starts when" htmlFor="trigger-kind">
              <Select
                value={definition.trigger.config.kind}
                onValueChange={(kind) => onChange(setTriggerKind(definition, kind as FlowTriggerConfig["kind"]))}
              >
                <SelectTrigger id="trigger-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {flowConfig.triggerKinds.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {TRIGGER_KIND_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <TriggerFields
              flowId={flowId}
              savedWebhookPath={savedWebhookPath}
              triggerConfig={definition.trigger.config}
              onChange={(next) => onChange(setTriggerConfig(definition, next))}
            />
          </>
        ) : (
          step && (
            <>
              <Field label="Does" htmlFor="step-kind">
                <Select
                  value={step.config.kind}
                  onValueChange={(kind) =>
                    onChange(setStepKind(definition, selectedNodeId, kind as FlowStepConfig["kind"]))
                  }
                >
                  <SelectTrigger id="step-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {flowConfig.stepKinds.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {STEP_KIND_LABELS[kind]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <StepFields
                stepConfig={step.config}
                variables={variables}
                onChange={(next) => onChange(setStepConfig(definition, selectedNodeId, next))}
              />
            </>
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
    </aside>
  );
}
