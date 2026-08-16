/**
 * Keyboard handling shared by the builder's shortcuts.
 *
 * Kept out of the component so the two rules that actually matter — never hijack a key while
 * someone is typing, and treat Cmd on a Mac the way Ctrl is treated elsewhere — are written once
 * and can be tested without rendering anything.
 */

/** The shortcut, as it should be *displayed*: ⌘ on Apple platforms, Ctrl everywhere else. */
export function modifierLabel(platform: string = navigator.platform): string {
  return /mac|iphone|ipad/i.test(platform) ? "⌘" : "Ctrl";
}

/**
 * Whether the event carries the platform's "command" modifier.
 *
 * `metaKey` on a Mac, `ctrlKey` elsewhere — accepting either would make Ctrl+S on a Mac silently
 * do the wrong thing, since that is not a shortcut anyone there expects to fire.
 */
export function hasCommandModifier(event: KeyboardEvent, platform: string = navigator.platform): boolean {
  return /mac|iphone|ipad/i.test(platform) ? event.metaKey : event.ctrlKey;
}

const TEXT_ENTRY_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Whether the keystroke belongs to a field rather than to the page.
 *
 * Without this, Backspace deletes the selected node while the author is editing its name, and
 * every shortcut becomes a trap.
 *
 * The target is inspected by shape rather than with `instanceof HTMLElement`, so the rule can be
 * tested without a DOM — and so it still holds for an element from another document, where the
 * `instanceof` check quietly returns false.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }

  const candidate = target as { tagName?: unknown; isContentEditable?: unknown };

  if (candidate.isContentEditable === true) {
    return true;
  }

  return typeof candidate.tagName === "string" && TEXT_ENTRY_TAGS.has(candidate.tagName);
}
