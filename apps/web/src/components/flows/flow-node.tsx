import type { FlowStepConfig, FlowTriggerConfig } from "@automend/shared";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { ClockIcon, GlobeIcon, MailIcon, ScrollTextIcon, TimerIcon, WebhookIcon, ZapIcon } from "lucide-react";
import type { ComponentType } from "react";
import {
  describeStep,
  describeTrigger,
  type NodeAccent,
  STEP_ACCENTS,
  STEP_KIND_LABELS,
  TRIGGER_ACCENTS,
  TRIGGER_KIND_LABELS,
} from "@/lib/flow-kinds";
import { cn } from "@/lib/utils";

export type TriggerNodeData = { name: string; config: FlowTriggerConfig };
export type StepNodeData = { name: string; config: FlowStepConfig };

export type TriggerCanvasNode = Node<TriggerNodeData, "trigger">;
export type StepCanvasNode = Node<StepNodeData, "step">;
export type FlowCanvasNode = TriggerCanvasNode | StepCanvasNode;

type IconComponent = ComponentType<{ className?: string }>;

const TRIGGER_ICONS: Record<FlowTriggerConfig["kind"], IconComponent> = {
  manual: ZapIcon,
  webhook: WebhookIcon,
  schedule: ClockIcon,
};

const STEP_ICONS: Record<FlowStepConfig["kind"], IconComponent> = {
  "http-request": GlobeIcon,
  "send-email": MailIcon,
  delay: TimerIcon,
  log: ScrollTextIcon,
};

/**
 * One box on the canvas.
 *
 * Both node types share this shell so a flow reads as a single sequence; the trigger differs only
 * in its accent and in having no inbound handle — nothing can run before it starts.
 */
function NodeShell({
  icon: Icon,
  title,
  summary,
  accent,
  badge,
  selected,
  hasSource,
  hasTarget,
}: {
  icon: IconComponent;
  title: string;
  summary: string;
  accent: NodeAccent;
  badge: string;
  selected: boolean;
  hasSource: boolean;
  hasTarget: boolean;
}) {
  return (
    <div
      className={cn(
        "group w-64 rounded-xl bg-card px-3.5 py-3 text-left ring-1 transition-all duration-150",
        // Only shadow and ring animate: transform would blur the text at fractional canvas zooms.
        selected
          ? cn("shadow-lg ring-2", accent.ring)
          : "shadow-sm ring-foreground/10 hover:shadow-md hover:ring-foreground/25",
      )}
    >
      {hasTarget && <Handle type="target" position={Position.Top} className={cn(HANDLE_CLASS, accent.handle)} />}

      <div className="flex items-start gap-2.5">
        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", accent.chip)}>
          <Icon className="size-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm leading-snug">{title}</span>
          <span className="block truncate text-muted-foreground text-xs leading-relaxed">{summary}</span>
        </span>
      </div>

      {/* Names the kind in words as well as colour, since colour alone carries no meaning. */}
      <span className="sr-only">{badge}</span>

      {hasSource && <Handle type="source" position={Position.Bottom} className={cn(HANDLE_CLASS, accent.handle)} />}
    </div>
  );
}

/**
 * Bigger than it looks: the visible dot is small so it does not crowd the node, but the hit area
 * is what a pointer actually has to find, and a 6px drag target is a fiddly one. It takes the
 * node's accent on hover, so the connection affordance is discoverable rather than something you
 * have to already know about.
 */
const HANDLE_CLASS = "!size-3 !border-2 !border-background !bg-muted-foreground transition-colors";

export function TriggerNode({ data, selected }: NodeProps<TriggerCanvasNode>) {
  return (
    <NodeShell
      icon={TRIGGER_ICONS[data.config.kind]}
      title={data.name}
      summary={describeTrigger(data.config)}
      accent={TRIGGER_ACCENTS[data.config.kind]}
      badge={`Trigger: ${TRIGGER_KIND_LABELS[data.config.kind]}`}
      selected={selected ?? false}
      hasSource
      hasTarget={false}
    />
  );
}

export function StepNode({ data, selected }: NodeProps<StepCanvasNode>) {
  return (
    <NodeShell
      icon={STEP_ICONS[data.config.kind]}
      title={data.name}
      summary={describeStep(data.config)}
      accent={STEP_ACCENTS[data.config.kind]}
      badge={`Step: ${STEP_KIND_LABELS[data.config.kind]}`}
      selected={selected ?? false}
      hasSource
      hasTarget
    />
  );
}

export const flowNodeTypes = {
  trigger: TriggerNode,
  step: StepNode,
};
