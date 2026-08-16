import { toTemplateToken } from "@automend/shared";
import type { DOMExportOutput, EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from "lexical";
import { $applyNodeReplacement, DecoratorNode } from "lexical";
import type { JSX } from "react";

export type SerializedVariableNode = Spread<{ path: string }, SerializedLexicalNode>;

/**
 * A variable, drawn as a pill and stored as `{{path}}`.
 *
 * The whole design rests on `getTextContent`: it returns the token, so the editor's plain text is
 * *already* the template string the flow definition stores. There is no separate serializer to
 * write, and therefore none to drift — what you read out of the editor is exactly what the API
 * renders.
 *
 * A decorator rather than a styled `TextNode` because a chip must behave as one indivisible thing:
 * a caret cannot land inside it and backspace removes the whole variable, not the last brace of a
 * token that would then be silently malformed.
 */
export class VariableNode extends DecoratorNode<JSX.Element> {
  __path: string;

  static override getType(): string {
    return "variable";
  }

  static override clone(node: VariableNode): VariableNode {
    return new VariableNode(node.__path, node.__key);
  }

  constructor(path: string, key?: NodeKey) {
    super(key);
    this.__path = path;
  }

  /** What the flow stores, and what `$getRoot().getTextContent()` therefore produces. */
  override getTextContent(): string {
    return toTemplateToken(this.__path);
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "inline-block align-baseline";
    return dom;
  }

  override updateDOM(): false {
    return false;
  }

  /** Copying a variable out of the editor yields the token, not the label. */
  override exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.textContent = this.getTextContent();
    return { element };
  }

  override isInline(): true {
    return true;
  }

  static override importJSON(serialized: SerializedVariableNode): VariableNode {
    return $createVariableNode(serialized.path);
  }

  override exportJSON(): SerializedVariableNode {
    return { ...super.exportJSON(), path: this.__path };
  }

  override decorate(_editor: unknown, _config: EditorConfig): JSX.Element {
    return (
      <span
        // `title` carries the full path, since a deep one is shortened to its last segment.
        title={this.__path}
        className="mx-px rounded bg-node-violet/15 px-1 py-px font-medium text-[0.6875rem] text-node-violet"
      >
        {this.__path.split(".").at(-1)}
      </span>
    );
  }
}

export function $createVariableNode(path: string): VariableNode {
  return $applyNodeReplacement(new VariableNode(path));
}

export function $isVariableNode(node: LexicalNode | null | undefined): node is VariableNode {
  return node instanceof VariableNode;
}
