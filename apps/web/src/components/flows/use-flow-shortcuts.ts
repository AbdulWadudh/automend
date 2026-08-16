import { useEffect } from "react";
import { hasCommandModifier, isTypingTarget } from "@/lib/keyboard";

export type FlowShortcutHandlers = {
  onSave: () => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onClearSelection: () => void;
  onToggleShortcuts: () => void;
};

/**
 * The builder's keyboard shortcuts.
 *
 * Bound to the document rather than to the canvas, because the canvas loses focus the moment
 * anything else is clicked and a shortcut that only works sometimes is worse than none. Keystrokes
 * aimed at a field are left alone — see `isTypingTarget`.
 */
export function useFlowShortcuts(handlers: FlowShortcutHandlers): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) {
        return;
      }

      if (hasCommandModifier(event) && event.key.toLowerCase() === "s") {
        // The browser's "save page" is never what someone wants inside an editor.
        event.preventDefault();
        handlers.onSave();
        return;
      }

      if (hasCommandModifier(event) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        handlers.onDuplicateSelected();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        handlers.onDeleteSelected();
        return;
      }

      if (event.key === "Escape") {
        handlers.onClearSelection();
        return;
      }

      if (event.key === "?") {
        handlers.onToggleShortcuts();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handlers]);
}
