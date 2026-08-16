import { config, type TemplateVariable } from "@automend/shared";
import { ListItemNode, ListNode } from "@lexical/list";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { LexicalTypeaheadMenuPlugin, MenuOption, type MenuTextMatch } from "@lexical/react/LexicalTypeaheadMenuPlugin";
import type { LexicalEditor } from "lexical";
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { RichToolbar } from "./rich-toolbar";
import { $buildPlainContent, $buildRichContent, $readPlainContent, $readRichContent } from "./template-content";
import { $createVariableNode, VariableNode } from "./variable-node";

const { templates } = config.flows;

/**
 * Matches a half-typed `{{` at the caret, which is what opens the menu.
 *
 * Anchored to the end because a trigger is only a trigger where the caret is — `{{` earlier in the
 * line is a variable already written, not an invitation to pick another.
 */
const TRIGGER_PATTERN = /\{\{([A-Za-z0-9_\-.]*)$/;

class VariableOption extends MenuOption {
  constructor(readonly variable: TemplateVariable) {
    super(variable.path);
  }
}

/**
 * Formatting is styled here rather than left to the browser's defaults, which render a list with
 * no indent inside a bordered box and italics that are hard to tell from upright text.
 */
const EDITOR_THEME = {
  paragraph: "mb-1 last:mb-0",
  text: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline underline-offset-2",
  },
  list: {
    ul: "list-disc pl-5",
    ol: "list-decimal pl-5",
    listitem: "mb-0.5",
  },
};

export type TemplateFieldProps = {
  id?: string;
  value: string;
  variables: TemplateVariable[];
  multiline?: boolean;
  /**
   * Formatting, for fields that are *written* rather than filled in — an email body. The value is
   * then HTML with `{{tokens}}` in it rather than plain text; a subject line or a URL stays plain,
   * because bold in either is meaningless.
   */
  rich?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
};

/**
 * A text field whose values can name data the flow received.
 *
 * Typing `{{` opens the list of variables the last delivery contained; picking one drops in a chip.
 * Everything else behaves like an ordinary field, because most of what goes in these boxes is
 * ordinary text.
 */
export function TemplateField({
  id,
  value,
  variables,
  multiline = false,
  rich = false,
  placeholder,
  onChange,
}: TemplateFieldProps) {
  const [query, setQuery] = useState<string | null>(null);
  // Rich and plain differ only in which plugin owns the editable; everything else is shared.
  const TextPlugin = rich ? RichTextPlugin : PlainTextPlugin;

  const options = useMemo(() => {
    const needle = query?.toLowerCase() ?? "";

    return variables
      .filter((variable) => variable.path.toLowerCase().includes(needle))
      .slice(0, templates.maxSampleVariables)
      .map((variable) => new VariableOption(variable));
  }, [query, variables]);

  const handleChange = useCallback(
    (_editorState: unknown, editor: LexicalEditor) => {
      editor.read(() => {
        if (rich) {
          onChange($readRichContent(editor));
          return;
        }

        const text = $readPlainContent();
        // A single-line field keeps its promise even if something is pasted with newlines in it.
        onChange(multiline ? text : text.replace(/\n/g, " "));
      });
    },
    [multiline, onChange, rich],
  );

  const handleSelect = useCallback(
    (
      option: VariableOption,
      nodeToReplace: { replace: (node: VariableNode) => void } | null,
      closeMenu: () => void,
    ) => {
      nodeToReplace?.replace($createVariableNode(option.variable.path));
      closeMenu();
    },
    [],
  );

  return (
    <LexicalComposer
      initialConfig={{
        namespace: "template-field",
        nodes: [VariableNode, ListNode, ListItemNode],
        theme: EDITOR_THEME,
        editorState: (editor) => (rich ? $buildRichContent(editor, value) : $buildPlainContent(value)),
        onError: (error) => {
          throw error;
        },
      }}
    >
      <div
        className={cn(
          "relative rounded-lg border border-input bg-transparent text-sm shadow-xs transition-[color,box-shadow] dark:bg-input/30",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        )}
      >
        {rich && <RichToolbar />}

        <TextPlugin
          contentEditable={
            <ContentEditable
              id={id}
              aria-placeholder={placeholder ?? ""}
              placeholder={
                <span className="pointer-events-none absolute top-2 left-3 text-muted-foreground">{placeholder}</span>
              }
              className={cn(
                "w-full resize-none px-3 py-2 outline-none",
                multiline ? "min-h-24 whitespace-pre-wrap" : "min-h-9",
              )}
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        {rich && <ListPlugin />}
        <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
        <HistoryPlugin />

        <LexicalTypeaheadMenuPlugin<VariableOption>
          options={options}
          onQueryChange={setQuery}
          onSelectOption={handleSelect}
          triggerFn={(text): MenuTextMatch | null => {
            const match = TRIGGER_PATTERN.exec(text);

            if (!match) {
              return null;
            }

            return {
              leadOffset: match.index,
              matchingString: match[1] ?? "",
              replaceableString: match[0],
            };
          }}
          /**
           * The first argument is the plugin's *own* anchor — an element it creates and keeps
           * positioned at the caret. The menu is portaled **into** it.
           *
           * Rendering it anywhere else is not merely misplaced: portaling into a node that React
           * owns and Lexical also mutates makes the two disagree about the DOM, and unmounting the
           * menu then throws "The node to be removed is not a child of this node".
           */
          menuRenderFn={(anchorElementRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) =>
            anchorElementRef.current
              ? createPortal(
                  <ul className="max-h-64 w-64 overflow-y-auto rounded-xl bg-popover p-1 shadow-xl ring-1 ring-foreground/10">
                    {options.length === 0 ? (
                      // An empty menu with no explanation reads as broken. It is almost always the
                      // same cause: nothing has been delivered yet, so there are no field names.
                      <li className="px-2 py-2 text-muted-foreground text-xs leading-relaxed">
                        No data yet. Send a test request to this flow's webhook and its fields appear here.
                      </li>
                    ) : (
                      options.map((option, index) => (
                        <li key={option.key}>
                          <button
                            type="button"
                            ref={option.setRefElement}
                            className={cn(
                              "flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left",
                              index === selectedIndex ? "bg-accent text-accent-foreground" : "",
                            )}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            onClick={() => selectOptionAndCleanUp(option)}
                          >
                            <span className="font-medium text-xs">{option.variable.label}</span>
                            <span className="truncate text-muted-foreground text-xs">{option.variable.preview}</span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>,
                  anchorElementRef.current,
                )
              : null
          }
        />
      </div>
    </LexicalComposer>
  );
}
