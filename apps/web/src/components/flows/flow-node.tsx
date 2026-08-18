import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { accentForKit, type IconComponent, iconForMember, type NodeAccent } from "@/lib/flow-kinds";
import { cn } from "@/lib/utils";

/**
 * What a node needs to draw itself.
 *
 * The canvas resolves the kit's own words from the catalogue and passes them down as `summary`, rather than this
 * component looking anything up. A node is then renderable with no knowledge of which kits exist — which is what
 * lets a kit added tomorrow appear on the canvas without this file being touched.
 */
export type CanvasNodeData = {
  name: string;
  kitId: string;
  /** The action or trigger name, for the icon lookup where one kit does several different things. */
  member: string;
  summary: string;
  /** `Trigger: Gmail · New email`, read out by a screen reader in place of the colour. */
  badge: string;
};

export type TriggerCanvasNode = Node<CanvasNodeData, "trigger">;
export type StepCanvasNode = Node<CanvasNodeData, "step">;
export type FlowCanvasNode = TriggerCanvasNode | StepCanvasNode;

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
      icon={iconForMember(data.kitId, data.member)}
      title={data.name}
      summary={data.summary}
      accent={accentForKit(data.kitId)}
      badge={data.badge}
      selected={selected ?? false}
      hasSource
      // Nothing can run before the trigger, so there is no handle for anything to connect into.
      hasTarget={false}
    />
  );
}

export function StepNode({ data, selected }: NodeProps<StepCanvasNode>) {
  return (
    <NodeShell
      icon={iconForMember(data.kitId, data.member)}
      title={data.name}
      summary={data.summary}
      accent={accentForKit(data.kitId)}
      badge={data.badge}
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
