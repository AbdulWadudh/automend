import type { KitCatalogue } from "@automend/kit-framework";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { iconForMember } from "@/lib/flow-kinds";
import { type ActionChoice, listActionChoices } from "@/lib/kits-api";

/** Where the author let go of the connection, in pixels within the canvas. */
export type PickerAnchor = { x: number; y: number };

export type StepPickerProps = {
  anchor: PickerAnchor | undefined;
  /** Undefined while it loads. The menu says so rather than opening empty. */
  catalogue: KitCatalogue | undefined;
  onPick: (choice: ActionChoice) => void;
  onDismiss: () => void;
};

/**
 * The menu that opens where a connection was dropped on empty canvas.
 *
 * Dragging a line out and releasing it is the author saying "something happens after this" — so the next thing
 * they see should be what that something can be. Picking from here creates the node already connected and
 * already selected, which is the difference between one gesture and four.
 *
 * Anchored to a point rather than to a trigger element, because the thing being pointed at is a coordinate on a
 * canvas.
 *
 * The list is the catalogue, grouped by kit. It used to be four hardcoded entries with hardcoded copy; now the
 * words are the kit author's, so a kit added tomorrow appears here with no change to this file.
 */
export function StepPicker({ anchor, catalogue, onPick, onDismiss }: StepPickerProps) {
  const choices = catalogue ? listActionChoices(catalogue) : undefined;

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
        // Focus stays on the canvas; the list is reachable by Tab and dismissed with Escape, but stealing focus
        // here would fight the pointer gesture that just opened it.
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="max-h-80 overflow-y-auto"
      >
        <p className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">Add a step</p>

        {choices === undefined && (
          <p className="px-2 py-2 text-muted-foreground text-xs" aria-live="polite">
            Loading the available steps…
          </p>
        )}

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
              // Offered disabled rather than hidden: an author who knows the platform supports Gmail should find
              // out *why* they cannot use it, not fail to find it at all.
              disabled={!choice.available}
              onClick={() => onPick(choice)}
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
  );
}
