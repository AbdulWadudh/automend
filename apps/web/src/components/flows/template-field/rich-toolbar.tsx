import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import { $getSelection, $isRangeSelection, FORMAT_TEXT_COMMAND, SELECTION_CHANGE_COMMAND } from "lexical";
import { BoldIcon, ItalicIcon, ListIcon, ListOrderedIcon, UnderlineIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ActiveState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  list: "bullet" | "number" | null;
};

const INITIAL_STATE: ActiveState = { bold: false, italic: false, underline: false, list: null };

/**
 * Formatting for an email body.
 *
 * The buttons reflect the selection rather than only setting it — a toolbar that cannot say whether
 * the caret is already inside bold text is a set of guesses. `SELECTION_CHANGE_COMMAND` is what
 * keeps them honest.
 */
export function RichToolbar() {
  const [editor] = useLexicalComposerContext();
  const [active, setActive] = useState<ActiveState>(INITIAL_STATE);

  const readSelection = useCallback(() => {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
      return;
    }

    const listParent = $findMatchingParent(selection.anchor.getNode(), $isListNode);

    setActive({
      bold: selection.hasFormat("bold"),
      italic: selection.hasFormat("italic"),
      underline: selection.hasFormat("underline"),
      list: listParent instanceof ListNode ? (listParent.getListType() === "number" ? "number" : "bullet") : null,
    });
  }, []);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => editorState.read(readSelection)),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          readSelection();
          return false;
        },
        1,
      ),
    );
  }, [editor, readSelection]);

  function toggleList(type: "bullet" | "number") {
    if (active.list === type) {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      return;
    }

    editor.dispatchCommand(type === "bullet" ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND, undefined);
  }

  const buttons = [
    { key: "bold", label: "Bold", icon: BoldIcon, isActive: active.bold, run: () => format("bold") },
    { key: "italic", label: "Italic", icon: ItalicIcon, isActive: active.italic, run: () => format("italic") },
    {
      key: "underline",
      label: "Underline",
      icon: UnderlineIcon,
      isActive: active.underline,
      run: () => format("underline"),
    },
    {
      key: "bullet",
      label: "Bulleted list",
      icon: ListIcon,
      isActive: active.list === "bullet",
      run: () => toggleList("bullet"),
    },
    {
      key: "number",
      label: "Numbered list",
      icon: ListOrderedIcon,
      isActive: active.list === "number",
      run: () => toggleList("number"),
    },
  ];

  function format(style: "bold" | "italic" | "underline") {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, style);
  }

  return (
    <div className="flex items-center gap-0.5 border-b px-1.5 py-1">
      {buttons.map((button) => (
        <Button
          key={button.key}
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={button.label}
          aria-pressed={button.isActive}
          title={button.label}
          className={cn(button.isActive ? "bg-muted text-foreground" : "text-muted-foreground")}
          // The editor must keep the selection the button is about to act on.
          onMouseDown={(event) => event.preventDefault()}
          onClick={button.run}
        >
          <button.icon />
        </Button>
      ))}
    </div>
  );
}
