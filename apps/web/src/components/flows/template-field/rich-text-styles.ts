/**
 * How the rich body looks in the editor.
 *
 * Lexical writes these class names into the HTML that `$generateHtmlFromNodes` produces, and a class name means
 * nothing once the body leaves this app: an email client has no Tailwind, so `class="mb-1"` is dropped and the
 * client's own paragraph margin — around 16px top *and* bottom — applies instead. A body composed with 4px gaps
 * arrived with roughly 48px ones, and one blank line read as three.
 *
 * The inline translation therefore lives in `@automend/shared`, where the *kit that sends the message* can apply
 * it as well — which is what fixes a body stored before any of this existed. See that module.
 *
 * The two halves are still one decision, and `tests/…/rich-text-styles.test.ts` is what keeps them paired: it
 * fails if a class is added to the theme and not to the translation, or the other way round.
 */

/**
 * Formatting is styled here rather than left to the browser's defaults, which render a list with no indent
 * inside a bordered box and italics that are hard to tell from upright text.
 */
export const EDITOR_THEME = {
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

export { EMAIL_CLASS_STYLES, listStyleClasses, toEmailSafeHtml } from "@automend/shared";
