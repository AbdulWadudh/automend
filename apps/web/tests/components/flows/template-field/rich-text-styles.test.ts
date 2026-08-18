/**
 * What is composed in the rich field is what gets sent.
 *
 * These exist because of a real report: a body written with one blank line between paragraphs arrived in Gmail
 * with roughly three. Lexical writes the editor theme's *class names* into its HTML export, and a class name is
 * worth nothing once the body leaves this app — an email client has no Tailwind, so `class="mb-1"` is dropped
 * and the client's own paragraph margin (~16px top *and* bottom) applies instead.
 *
 * The first test is the one that matters: it pairs the theme with its inline translation, so a class added to
 * one and forgotten in the other fails here rather than in somebody's inbox.
 */

import { describe, expect, test } from "bun:test";
import {
  EDITOR_THEME,
  EMAIL_CLASS_STYLES,
  listStyleClasses,
  toEmailSafeHtml,
} from "../../../../src/components/flows/template-field/rich-text-styles";

/** The classes the editor actually applies, which the translation below has to cover exactly. */
const themeClasses = () => listStyleClasses(EDITOR_THEME);

describe("the theme and its email translation stay paired", () => {
  test("every class the editor applies has an entry", () => {
    const missing = themeClasses().filter((name) => !(name in EMAIL_CLASS_STYLES));

    // An entry may be deliberately empty — `last:mb-0` has nothing to say outside the editor. What must not
    // happen is a class nobody considered, which is the difference this asserts.
    expect(missing).toEqual([]);
  });

  test("the theme is not empty, so the check above cannot pass vacuously", () => {
    expect(themeClasses().length).toBeGreaterThan(0);
    expect(EDITOR_THEME.paragraph.length).toBeGreaterThan(0);
  });

  test("no entry exists for a class the theme does not apply", () => {
    // Dead entries are how the map drifts into fiction. Every key should be traceable to the theme.
    const applied = new Set(themeClasses());

    expect(Object.keys(EMAIL_CLASS_STYLES).filter((name) => !applied.has(name))).toEqual([]);
  });
});

describe("translating editor HTML for an email client", () => {
  test("a paragraph's class becomes an inline margin", () => {
    const html = toEmailSafeHtml('<p class="mb-1 last:mb-0">Hi</p>');

    expect(html).toBe('<p style="margin: 0 0 4px">Hi</p>');
  });

  test("the top margin is zeroed, which is the half that caused the gap", () => {
    // `mb-1` only ever set a bottom margin. The space nobody could explain was the *default top* margin
    // showing through once the class was ignored, so the translation has to write both.
    expect(toEmailSafeHtml('<p class="mb-1">Hi</p>')).toContain("margin: 0 0 4px");
  });

  test("editor-only class names do not travel", () => {
    // They mean nothing at the far end and could collide with a stylesheet that happens to reuse the name.
    expect(toEmailSafeHtml('<p class="mb-1 last:mb-0">Hi</p>')).not.toContain("class");
  });

  test("a blank line stays exactly one blank line", () => {
    const html = toEmailSafeHtml('<p class="mb-1 last:mb-0">Hi</p><p class="mb-1 last:mb-0"><br></p><p>Bye</p>');

    // One empty paragraph in, one empty paragraph out — it is a line somebody chose, so it survives, but with
    // a margin it can only be one line tall.
    expect([...html.matchAll(/<br>/g)]).toHaveLength(1);
    expect([...html.matchAll(/<p/g)]).toHaveLength(3);
  });

  test("an element's own style wins over the class it also carries", () => {
    // Lexical writes `white-space: pre-wrap` to preserve typed spaces, and alignment and indent the same way.
    // Those describe this content; a theme class describes the default.
    const html = toEmailSafeHtml('<p class="mb-1" style="margin: 12px 0; text-align: center">Hi</p>');

    expect(html).toContain("margin: 12px 0");
    expect(html).toContain("text-align: center");
    expect(html).not.toContain("margin: 0 0 4px");
  });

  test("a style it does not conflict with is kept alongside", () => {
    const html = toEmailSafeHtml('<span class="font-semibold" style="white-space: pre-wrap;">Hi</span>');

    expect(html).toContain("white-space: pre-wrap");
    expect(html).toContain("font-weight: 600");
  });

  test("each text format becomes something a mail client renders", () => {
    expect(toEmailSafeHtml('<span class="font-semibold">a</span>')).toContain("font-weight: 600");
    expect(toEmailSafeHtml('<span class="italic">a</span>')).toContain("font-style: italic");
    expect(toEmailSafeHtml('<span class="underline underline-offset-2">a</span>')).toContain(
      "text-decoration: underline",
    );
  });

  test("lists keep their marker and their indent", () => {
    // Left to an email client's defaults, a list renders with no indent and no visible marker.
    const unordered = toEmailSafeHtml('<ul class="list-disc pl-5"><li class="mb-0.5">a</li></ul>');

    expect(unordered).toContain("list-style-type: disc");
    expect(unordered).toContain("padding-left: 20px");
    expect(toEmailSafeHtml('<ol class="list-decimal pl-5"><li>a</li></ol>')).toContain("list-style-type: decimal");
  });

  test("an element with no class is left exactly as it was", () => {
    const html = '<span style="white-space: pre-wrap;">Hi </span>';

    expect(toEmailSafeHtml(html)).toBe(html);
  });

  test("a variable token survives untouched", () => {
    // The token is what the engine substitutes later. Mangling it here would break every template silently.
    expect(toEmailSafeHtml('<p class="mb-1"><span>{{trigger.body.name}}</span></p>')).toContain(
      "{{trigger.body.name}}",
    );
  });

  test("text that looks like markup is not mistaken for markup", () => {
    // Lexical escapes content, so `<` in a body arrives as `&lt;`. This asserts the transform relies on that
    // rather than on luck.
    const html = toEmailSafeHtml('<p class="mb-1">&lt;p class="mb-1"&gt;not a tag&lt;/p&gt;</p>');

    expect(html).toContain('&lt;p class="mb-1"&gt;');
    expect([...html.matchAll(/<p/g)]).toHaveLength(1);
  });

  test("plain text with no markup at all passes through", () => {
    expect(toEmailSafeHtml("Hi {{trigger.body.name}}")).toBe("Hi {{trigger.body.name}}");
  });
});

describe("the body the incident produced", () => {
  /** Exactly what was stored for the flow that arrived over-spaced, tokens and all. */
  const stored =
    '<p class="mb-1 last:mb-0"><span style="white-space: pre-wrap;">Hi </span><span>{{trigger.body.name}}</span>' +
    '<span style="white-space: pre-wrap;">,</span></p><p class="mb-1 last:mb-0"><br></p>' +
    '<p class="mb-1 last:mb-0"><span>{{trigger.body.message}}</span></p>' +
    '<p class="mb-1 last:mb-0"><span style="white-space: pre-wrap;">Regards,</span></p>' +
    '<p class="mb-1 last:mb-0"><span>{{trigger.body.from}}</span></p>';

  test("every paragraph carries a margin, so none falls back to the client's default", () => {
    const html = toEmailSafeHtml(stored);
    const paragraphs = [...html.matchAll(/<p([^>]*)>/g)].map((match) => match[1] ?? "");

    expect(paragraphs).toHaveLength(5);

    for (const attributes of paragraphs) {
      expect(attributes).toContain("margin: 0 0 4px");
      expect(attributes).not.toContain("class");
    }
  });

  test("the typed spaces and the tokens both survive", () => {
    const html = toEmailSafeHtml(stored);

    expect(html).toContain("white-space: pre-wrap");
    expect(html).toContain("{{trigger.body.name}}");
    expect(html).toContain("{{trigger.body.message}}");
    expect(html).toContain("{{trigger.body.from}}");
  });
});
