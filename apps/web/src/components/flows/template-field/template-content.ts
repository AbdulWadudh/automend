/**
 * Turning a stored value into editor content, and back.
 *
 * Two storage shapes, because the fields differ in kind. A subject line or a URL is plain text and
 * stays plain text. An email body is written, so it is HTML — and the variables inside it are the
 * same `{{token}}` either way, which is what lets one renderer serve both.
 */

import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { $createVariableNode } from "./variable-node";

/** Matches a token anywhere in stored text, so a saved value can be rebuilt into chips. */
const TOKEN_PATTERN = /\{\{\s*([A-Za-z0-9_\-.]+)\s*\}\}/g;

/** Anything with a tag in it came from the rich editor; anything else is text someone typed. */
const LOOKS_LIKE_HTML = /<[a-z][\s\S]*>/i;

/**
 * Replaces `{{token}}` runs inside text with variable chips.
 *
 * Applied after parsing rather than during it, so it works the same whether the content came from
 * our own saved HTML, from a plain string, or from something pasted in.
 */
function $convertTokensToVariables(node: LexicalNode): void {
  if ($isElementNode(node)) {
    for (const child of node.getChildren()) {
      $convertTokensToVariables(child);
    }

    return;
  }

  if (!$isTextNode(node)) {
    return;
  }

  const text = node.getTextContent();
  const matches = [...text.matchAll(TOKEN_PATTERN)];

  if (matches.length === 0) {
    return;
  }

  const replacements: LexicalNode[] = [];
  let cursor = 0;

  for (const match of matches) {
    const path = match[1];

    if (match.index > cursor) {
      replacements.push($createTextNode(text.slice(cursor, match.index)));
    }

    if (path) {
      replacements.push($createVariableNode(path));
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    replacements.push($createTextNode(text.slice(cursor)));
  }

  // Inserted before the original is removed, so the node always has somewhere to attach.
  for (const replacement of replacements) {
    node.insertBefore(replacement);
  }

  node.remove();
}

/** Builds plain-text content: one paragraph per line, tokens as chips. */
export function $buildPlainContent(value: string): void {
  const root = $getRoot();
  root.clear();

  for (const line of value.split("\n")) {
    const paragraph = $createParagraphNode();

    if (line.length > 0) {
      paragraph.append($createTextNode(line));
    }

    root.append(paragraph);
  }

  $convertTokensToVariables(root);
}

/**
 * Builds rich content from stored HTML.
 *
 * A value with no markup in it is treated as plain text rather than parsed as HTML — that is what a
 * body written before this field became rich looks like, and dropping it would lose someone's work.
 */
export function $buildRichContent(editor: LexicalEditor, value: string): void {
  if (!LOOKS_LIKE_HTML.test(value)) {
    $buildPlainContent(value);
    return;
  }

  const dom = new DOMParser().parseFromString(value, "text/html");
  const root = $getRoot();

  root.clear();

  for (const node of $generateNodesFromDOM(editor, dom)) {
    // Anything that cannot sit at the top level is wrapped, since the root only takes elements.
    root.append($isElementNode(node) ? node : $createParagraphNode().append(node));
  }

  $convertTokensToVariables(root);
}

/**
 * Reads rich content back out as HTML.
 *
 * Variables survive because `VariableNode.exportDOM` writes the token, so the stored HTML contains
 * `{{name}}` as ordinary text — which is exactly what the renderer substitutes into later.
 */
export function $readRichContent(editor: LexicalEditor): string {
  return $generateHtmlFromNodes(editor, null);
}

export function $readPlainContent(): string {
  return $getRoot().getTextContent();
}
