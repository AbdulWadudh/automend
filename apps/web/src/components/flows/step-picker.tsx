import { config, type FlowStepKind } from "@automend/shared";
import { GlobeIcon, MailIcon, ScrollTextIcon, TimerIcon } from "lucide-react";
import type { ComponentType } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { STEP_KIND_LABELS } from "@/lib/flow-kinds";

const STEP_ICONS: Record<FlowStepKind, ComponentType<{ className?: string }>> = {
  "http-request": GlobeIcon,
  "send-email": MailIcon,
  delay: TimerIcon,
  log: ScrollTextIcon,
};

const STEP_DESCRIPTIONS: Record<FlowStepKind, string> = {
  "http-request": "Call a URL and continue",
  "send-email": "Send a message through a connection",
  delay: "Pause before the next step",
  log: "Write a line to the run log",
};

/** Where the author let go of the connection, in pixels within the canvas. */
export type PickerAnchor = { x: number; y: number };

export type StepPickerProps = {
  anchor: PickerAnchor | undefined;
  onPick: (kind: FlowStepKind) => void;
  onDismiss: () => void;
};

/**
 * The menu that opens where a connection was dropped on empty canvas.
 *
 * Dragging a line out and releasing it is the author saying "something happens after this" — so
 * the next thing they see should be what that something can be. Picking from here creates the node
 * already connected and already selected, which is the difference between one gesture and four.
 *
 * Anchored to a point rather than to a trigger element, because the thing being pointed at is a
 * coordinate on a canvas.
 */
export function StepPicker({ anchor, onPick, onDismiss }: StepPickerProps) {
  return (
    <Popover
      open={anchor !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          onDismiss();
        }
      }}
    >
      <PopoverAnchor asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{ left: anchor?.x ?? 0, top: anchor?.y ?? 0 }}
        />
      </PopoverAnchor>

      <PopoverContent
        // Focus stays on the canvas; the list is reachable by Tab and dismissed with Escape, but
        // stealing focus here would fight the pointer gesture that just opened it.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <p className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">Add a step</p>

        {config.flows.stepKinds.map((kind) => {
          const Icon = STEP_ICONS[kind];

          return (
            <button
              key={kind}
              type="button"
              onClick={() => onPick(kind)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-sm">{STEP_KIND_LABELS[kind]}</span>
                <span className="block truncate text-muted-foreground text-xs">{STEP_DESCRIPTIONS[kind]}</span>
              </span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
