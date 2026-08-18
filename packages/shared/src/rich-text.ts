/**
 * Making rich HTML survive leaving the app.
 *
 * The builder composes an email body in Lexical, and Lexical writes its *theme's class names* into the HTML it
 * exports. A class name is worth nothing at the far end: an email client has no Tailwind, so `class="mb-1"` is
 * dropped and the client's own paragraph margin — around 16px top *and* bottom — applies instead. A body written
 * with 4px gaps arrived with roughly 48px ones, and one blank line read as three.
 *
 * This lives in `shared` rather than beside the editor for one reason: bodies stored *before* the export was
 * fixed still carry those classes, and nothing will rewrite them. So the kit that sends the message applies this
 * too, at the last point before the MIME is built — which means an old flow is fixed without anybody re-saving
 * it. `shared` is the only place both the builder and a kit may import from.
 *
 * Pure string operations throughout, so this is browser-safe and testable without a DOM.
 */

/**
 * The inline declarations each theme class stands for, keyed by the class itself.
 *
 * A class mapping to `""` is one with nothing to say outside the editor, and saying so explicitly is the
 * point — it is how the test above can tell "no equivalent needed" from "nobody thought about it".
 *
 * Note that every margin is written in full (`margin: 0 0 4px`) rather than as `margin-bottom` alone. The
 * gap that surprised everybody was not the missing bottom margin; it was the *default top* margin appearing
 * once the class was ignored, so zeroing it is the load-bearing half.
 */
export const EMAIL_CLASS_STYLES: Record<string, string> = {
  "mb-1": "margin: 0 0 4px",
  /**
   * `:last-child` cannot be expressed inline, and does not need to be: a trailing 4px below the final
   * paragraph of an email is invisible. It exists in the editor so the field does not look bottom-heavy.
   */
  "last:mb-0": "",
  "font-semibold": "font-weight: 600",
  italic: "font-style: italic",
  underline: "text-decoration: underline",
  "underline-offset-2": "text-underline-offset: 2px",
  "list-disc": "list-style-type: disc",
  "list-decimal": "list-style-type: decimal",
  "pl-5": "margin: 0; padding-left: 20px",
  "mb-0.5": "margin: 0 0 2px",
};

/**
 * Every class name a theme applies, flattened out of its nested shape.
 *
 * Takes the theme rather than reading one: the theme is Tailwind, so it belongs to the editor that renders with
 * it, while this is the generic walk that lets a test hold the two side by side.
 */
export function listStyleClasses(theme: unknown): string[] {
  const classes = new Set<string>();

  function collect(value: unknown): void {
    if (typeof value === "string") {
      for (const name of value.split(/\s+/).filter((part) => part.length > 0)) {
        classes.add(name);
      }

      return;
    }

    if (value !== null && typeof value === "object") {
      for (const nested of Object.values(value)) {
        collect(nested);
      }
    }
  }

  collect(theme);

  return [...classes];
}

/** Splits a `style` attribute into its declarations, so an existing one is extended rather than replaced. */
function splitDeclarations(style: string): string[] {
  return style
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.length > 0);
}

function propertyOf(declaration: string): string {
  return (declaration.split(":")[0] ?? "").trim().toLowerCase();
}

/**
 * The declarations a class list contributes, in the order the classes appear.
 *
 * A class with no mapping contributes nothing rather than throwing. Losing a style is a cosmetic regression;
 * refusing to serialise the body would lose somebody's work, and the test is what catches the omission.
 */
function declarationsForClasses(classList: string): string[] {
  const declarations: string[] = [];

  for (const name of classList.split(/\s+/).filter((part) => part.length > 0)) {
    for (const declaration of splitDeclarations(EMAIL_CLASS_STYLES[name] ?? "")) {
      declarations.push(declaration);
    }
  }

  return declarations;
}

/**
 * Merges translated declarations under whatever the element already carried.
 *
 * The element's own `style` wins on a conflict: Lexical writes `white-space: pre-wrap` there to preserve the
 * spaces somebody typed, and alignment and indentation too. Those describe the specific content; a theme class
 * describes the default.
 */
function mergeStyles(existing: string, added: string[]): string {
  const own = splitDeclarations(existing);
  const ownProperties = new Set(own.map(propertyOf));
  const merged = [...added.filter((declaration) => !ownProperties.has(propertyOf(declaration))), ...own];

  return merged.join("; ");
}

/** Matches one attribute of an open tag, capturing the name and the quoted value. */
const ATTRIBUTE_PATTERN = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;

/** Matches an element's open tag. Void and closing tags are left alone; neither carries a theme class. */
const OPEN_TAG_PATTERN = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;

/**
 * Rewrites editor HTML into HTML an email client renders the same way the editor did.
 *
 * A string transform rather than a DOM walk, and deliberately: this input is *generated* by Lexical, not
 * authored by anybody, so its tags are well-formed and its text is escaped — `<` inside content is `&lt;`,
 * which is why matching on `<tag …>` cannot collide with the body's own text. It also means this is a pure
 * function, testable without a DOM, where `DOMParser` would only exist in the browser.
 */
export function toEmailSafeHtml(html: string): string {
  return html.replace(OPEN_TAG_PATTERN, (whole, tagName: string, attributes: string, selfClosing: string) => {
    const found = new Map<string, string>();

    for (const match of attributes.matchAll(ATTRIBUTE_PATTERN)) {
      const [, name, value] = match;

      if (name !== undefined && value !== undefined) {
        found.set(name.toLowerCase(), value);
      }
    }

    const classList = found.get("class");

    if (classList === undefined) {
      return whole;
    }

    // Dropped whatever happens next: it is an editor-only handle, and leaving it risks colliding with a
    // stylesheet at the far end that happens to use the same name.
    found.delete("class");

    const style = mergeStyles(found.get("style") ?? "", declarationsForClasses(classList));

    if (style.length > 0) {
      found.set("style", style);
    } else {
      found.delete("style");
    }

    const rendered = [...found].map(([name, value]) => ` ${name}="${value}"`).join("");

    return `<${tagName}${rendered}${selfClosing}>`;
  });
}
