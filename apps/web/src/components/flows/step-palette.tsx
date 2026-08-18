import type { KitCatalogue } from "@automend/kit-framework";
import { type Connection, config, type FlowDefinition } from "@automend/shared";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addStep } from "@/lib/flow-editor";
import { iconForMember } from "@/lib/flow-kinds";
import {
  type ActionChoice,
  buildDefaultInput,
  findKitEntry,
  listActionChoices,
  pickDefaultConnection,
} from "@/lib/kits-api";

export type StepPaletteProps = {
  definition: FlowDefinition;
  catalogue: KitCatalogue | undefined;
  /** So a step that needs a connection arrives with one, when there is only one it could be. */
  connections: readonly Connection[];
  onChange: (definition: FlowDefinition) => void;
  onSelect: (nodeId: string) => void;
};

/**
 * Adding a step is a click, not a drag: there is one obvious place a new step goes, and requiring a drag would
 * make the common case harder for no gain. The new node is selected immediately so its settings are already open.
 *
 * A menu now rather than one button per step. With four hardcoded kinds a row of buttons fitted; with the
 * catalogue it would grow with every kit installed and stop fitting on the first narrow screen.
 */
export function StepPalette({ definition, catalogue, connections, onChange, onSelect }: StepPaletteProps) {
  const isFull = definition.steps.length >= config.flows.maxSteps;
  const choices = catalogue ? listActionChoices(catalogue) : undefined;

  function handleAdd(choice: ActionChoice) {
    const result = addStep(definition, {
      kitId: choice.kitId,
      actionName: choice.actionName,
      displayName: choice.displayName,
      input: buildDefaultInput(choice.properties),
      connectionId: pickDefaultConnection(connections, catalogue ? findKitEntry(catalogue, choice.kitId) : undefined),
    });

    onChange(result.definition);
    onSelect(result.stepId);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={isFull || choices === undefined}>
            <PlusIcon data-icon="inline-start" />
            {choices === undefined ? "Loading steps…" : "Add a step"}
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="max-h-80 w-72 overflow-y-auto">
          {choices?.length === 0 && (
            <p className="px-2 py-2 text-muted-foreground text-xs">
              This deployment has no services configured, so there is nothing to add yet.
            </p>
          )}

          {choices?.map((choice) => {
            const Icon = iconForMember(choice.kitId, choice.actionName);

            return (
              <button
                key={`${choice.kitId}.${choice.actionName}`}
                type="button"
                disabled={!choice.available}
                onClick={() => handleAdd(choice)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-sm">
                    {choice.kitName} · {choice.displayName}
                  </span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {choice.available ? choice.description : "Needs a connection before it can be used"}
                  </span>
                </span>
              </button>
            );
          })}
        </PopoverContent>
      </Popover>

      {isFull && <span className="text-muted-foreground text-xs">A flow can hold {config.flows.maxSteps} steps.</span>}
    </div>
  );
}
