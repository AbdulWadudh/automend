import { config, type FlowDefinition, type FlowStepKind } from "@automend/shared";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addStep } from "@/lib/flow-editor";
import { STEP_KIND_LABELS } from "@/lib/flow-kinds";

export type StepPaletteProps = {
  definition: FlowDefinition;
  onChange: (definition: FlowDefinition) => void;
  onSelect: (nodeId: string) => void;
};

/**
 * Adding a step is a click, not a drag: there is one obvious place a new step goes, and requiring
 * a drag would make the common case harder for no gain. The new node is selected immediately so
 * its settings are already open.
 */
export function StepPalette({ definition, onChange, onSelect }: StepPaletteProps) {
  const isFull = definition.steps.length >= config.flows.maxSteps;

  function handleAdd(kind: FlowStepKind) {
    const result = addStep(definition, kind);

    onChange(result.definition);
    onSelect(result.stepId);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {config.flows.stepKinds.map((kind) => (
        <Button key={kind} variant="outline" size="sm" disabled={isFull} onClick={() => handleAdd(kind)}>
          <PlusIcon data-icon="inline-start" />
          {STEP_KIND_LABELS[kind]}
        </Button>
      ))}

      {isFull && <span className="text-muted-foreground text-xs">A flow can hold {config.flows.maxSteps} steps.</span>}
    </div>
  );
}
