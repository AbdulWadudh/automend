import { KeyboardIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { modifierLabel } from "@/lib/keyboard";

/**
 * Discoverability for the shortcuts.
 *
 * A shortcut nobody knows about is not a feature, so it is listed behind a visible control rather
 * than left for the keyboard to reveal — and the control itself says which key opens it.
 */
export function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const modifier = modifierLabel();

  const shortcuts = [
    { keys: [modifier, "S"], action: "Save the flow" },
    { keys: [modifier, "D"], action: "Duplicate the selected step" },
    { keys: ["Delete"], action: "Delete the selected step" },
    { keys: ["Esc"], action: "Clear the selection" },
    { keys: ["?"], action: "Show this list" },
  ];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
          <KeyboardIcon />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 p-3">
        <p className="px-1 pb-2 font-medium text-sm">Keyboard shortcuts</p>

        <dl className="space-y-1">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.action} className="flex items-center justify-between gap-3 rounded-lg px-1 py-1.5">
              <dt className="text-muted-foreground text-xs">{shortcut.action}</dt>
              <dd className="flex shrink-0 items-center gap-1">
                {shortcut.keys.map((key) => (
                  <kbd
                    key={key}
                    className="rounded-md bg-muted px-1.5 py-0.5 font-medium font-sans text-[0.6875rem] text-foreground ring-1 ring-foreground/10"
                  >
                    {key}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
