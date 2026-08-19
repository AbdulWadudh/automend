import type { KitCatalogue } from "@automend/kit-framework";
// Aliased: React Flow exports its own `Connection` — an edge being drawn — and the two would collide.
import { config, type FlowDefinition, type Connection as StoredConnection } from "@automend/shared";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { addStep, connectNodes, disconnect, findNode, moveNode } from "@/lib/flow-editor";
import { accentForKit, describeNode } from "@/lib/flow-kinds";
import {
  type ActionChoice,
  buildDefaultInput,
  findActionTarget,
  findKitEntry,
  findTriggerTarget,
  pickDefaultConnection,
} from "@/lib/kits-api";
import { type FlowCanvasNode, flowNodeTypes } from "./flow-node";
import { type PickerAnchor, StepPicker } from "./step-picker";

import "@xyflow/react/dist/style.css";

const { canvas } = config.flows;

/** A connection dragged out and released on empty canvas, waiting for a step to be chosen. */
type PendingConnection = {
  sourceId: string;
  /** Where the node will be created, in canvas coordinates. */
  position: { x: number; y: number };
  /** Where the menu opens, in pixels within the canvas element. */
  anchor: PickerAnchor;
};

/**
 * The definition, as boxes on a canvas.
 *
 * Each node's summary comes from the catalogue — the kit author's own words for what it does — so the canvas and
 * the inspector cannot describe the same step differently. When the catalogue has not arrived yet, or names a
 * kit this deployment no longer has, `describeNode` falls back to the stored `kit.action`: less friendly, and
 * far better than a node that renders blank.
 */
function toCanvasNodes(
  definition: FlowDefinition,
  selectedNodeId: string | undefined,
  catalogue: KitCatalogue | undefined,
): FlowCanvasNode[] {
  const { trigger } = definition;
  const triggerTarget = catalogue ? findTriggerTarget(catalogue, trigger.kitId, trigger.triggerName) : undefined;

  const triggerNode: FlowCanvasNode = {
    id: trigger.id,
    type: "trigger",
    position: trigger.position,
    selected: trigger.id === selectedNodeId,
    data: {
      name: trigger.name,
      kitId: trigger.kitId,
      member: trigger.triggerName,
      summary: describeNode({
        kitId: trigger.kitId,
        name: trigger.triggerName,
        kitName: triggerTarget?.kit.displayName,
        displayName: triggerTarget?.displayName,
      }),
      // Colour marks a kit; this is the same information as words, for anyone the colour does not reach.
      badge: `Trigger: ${triggerTarget?.displayName ?? trigger.triggerName}`,
    },
  };

  const steps: FlowCanvasNode[] = definition.steps.map((step) => {
    const target = catalogue ? findActionTarget(catalogue, step.kitId, step.actionName) : undefined;

    return {
      id: step.id,
      type: "step" as const,
      position: step.position,
      selected: step.id === selectedNodeId,
      data: {
        name: step.name,
        kitId: step.kitId,
        member: step.actionName,
        summary: describeNode({
          kitId: step.kitId,
          name: step.actionName,
          kitName: target?.kit.displayName,
          displayName: target?.displayName,
        }),
        badge: `Step: ${target?.displayName ?? step.actionName}`,
      },
    };
  });

  return [triggerNode, ...steps];
}

/** An edge takes the colour of the node it leaves, so a branch is followable by eye. */
function edgeStroke(definition: FlowDefinition, sourceId: string): string {
  if (definition.trigger.id === sourceId) {
    return accentForKit(definition.trigger.kitId).stroke;
  }

  const step = definition.steps.find((candidate) => candidate.id === sourceId);

  return step ? accentForKit(step.kitId).stroke : "currentColor";
}

function toCanvasEdges(definition: FlowDefinition): Edge[] {
  return definition.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    animated: true,
    style: { stroke: edgeStroke(definition, edge.source), strokeWidth: 2 },
  }));
}

export type FlowCanvasProps = {
  definition: FlowDefinition;
  selectedNodeId: string | undefined;
  /** Undefined until it loads. The canvas draws either way; only the wording is less specific. */
  catalogue: KitCatalogue | undefined;
  connections: readonly StoredConnection[];
  onChange: (definition: FlowDefinition) => void;
  onSelect: (nodeId: string | undefined) => void;
};

/**
 * The canvas.
 *
 * React Flow keeps its own node and edge state so dragging stays smooth, and the definition is
 * only updated at the points where something has actually been decided: a node dropped, an edge
 * drawn, an edge removed. Everything in between is presentation.
 */
function FlowCanvasInner({ definition, selectedNodeId, catalogue, connections, onChange, onSelect }: FlowCanvasProps) {
  const [nodes, setNodes] = useState<FlowCanvasNode[]>(() => toCanvasNodes(definition, selectedNodeId, catalogue));
  const [edges, setEdges] = useState<Edge[]>(() => toCanvasEdges(definition));
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | undefined>(undefined);
  const { screenToFlowPosition } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  // The definition is the source of truth: whenever it changes — an added step, an undone edit,
  // a reload — the canvas is rebuilt from it rather than being patched to match.
  useEffect(() => {
    setNodes(toCanvasNodes(definition, selectedNodeId, catalogue));
    setEdges(toCanvasEdges(definition));
  }, [catalogue, definition, selectedNodeId]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowCanvasNode>[]) => {
      setNodes((current) => applyNodeChanges(changes, current));

      for (const change of changes) {
        // Committed on drop, not on every pointer move, so one drag is one edit.
        if (change.type === "position" && change.dragging === false && change.position) {
          onChange(moveNode(definition, change.id, change.position));
        }
      }
    },
    [definition, onChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      setEdges((current) => applyEdgeChanges(changes, current));

      for (const change of changes) {
        if (change.type === "remove") {
          onChange(disconnect(definition, change.id));
        }
      }
    },
    [definition, onChange],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      onChange(connectNodes(definition, connection.source, connection.target));
    },
    [definition, onChange],
  );

  /**
   * A connection released over empty canvas is a question, not a mistake: the author has said
   * "something happens after this" without saying what. So instead of snapping the line away, the
   * step menu opens where they let go, and picking from it creates the node already connected.
   */
  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      const sourceId = connectionState.fromNode?.id;

      if (connectionState.isValid || !sourceId || !findNode(definition, sourceId)) {
        return;
      }

      const bounds = wrapper.current?.getBoundingClientRect();
      const point = "changedTouches" in event ? event.changedTouches[0] : event;

      if (!bounds || !point) {
        return;
      }

      setPendingConnection({
        sourceId,
        position: screenToFlowPosition({ x: point.clientX, y: point.clientY }),
        anchor: { x: point.clientX - bounds.left, y: point.clientY - bounds.top },
      });
    },
    [definition, screenToFlowPosition],
  );

  const handlePick = useCallback(
    (choice: ActionChoice) => {
      if (!pendingConnection) {
        return;
      }

      const { definition: next, stepId } = addStep(
        definition,
        {
          kitId: choice.kitId,
          actionName: choice.actionName,
          displayName: choice.displayName,
          input: buildDefaultInput(choice.properties),
          connectionId: pickDefaultConnection(
            connections,
            catalogue ? findKitEntry(catalogue, choice.kitId) : undefined,
          ),
        },
        {
          position: pendingConnection.position,
          connectFrom: pendingConnection.sourceId,
        },
      );

      setPendingConnection(undefined);
      onChange(next);
      // Selected immediately, so its settings are already open in the inspector.
      onSelect(stepId);
    },
    [catalogue, connections, definition, onChange, onSelect, pendingConnection],
  );

  return (
    <div ref={wrapper} className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={flowNodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(undefined)}
        minZoom={canvas.minZoom}
        maxZoom={canvas.maxZoom}
        fitView
        fitViewOptions={{ padding: canvas.fitViewPadding, maxZoom: canvas.fitViewMaxZoom }}
        proOptions={{ hideAttribution: false }}
        // React Flow ships its own light and dark themes for the controls, edges and attribution.
        // The app renders dark throughout (`<html class="dark">`), so it is told which to use rather
        // than left on the light default, which is where the mismatched white panels came from.
        colorMode="dark"
        // Deletion is handled by the builder's own shortcut, which edits the definition. Leaving
        // React Flow's key binding on as well would delete the node from the canvas only.
        deleteKeyCode={null}
        className="bg-background"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="opacity-60" />
        <Controls showInteractive={false} className="shadow-lg!" />
      </ReactFlow>

      <StepPicker
        anchor={pendingConnection?.anchor}
        catalogue={catalogue}
        onPick={handlePick}
        onDismiss={() => setPendingConnection(undefined)}
      />
    </div>
  );
}

/**
 * `useReactFlow` needs a provider above it, and the provider must not be the same component that
 * consumes it — hence the split.
 */
export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
