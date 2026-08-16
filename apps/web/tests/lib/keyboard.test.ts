import { describe, expect, test } from "bun:test";
import { hasCommandModifier, isTypingTarget, modifierLabel } from "../../src/lib/keyboard";

/**
 * The rule worth testing is the one whose failure is invisible in review and infuriating in use:
 * a shortcut that fires while someone is typing a node's name.
 */

const MAC = "MacIntel";
const WINDOWS = "Win32";

function keyEvent(init: { metaKey?: boolean; ctrlKey?: boolean }): KeyboardEvent {
  return { metaKey: false, ctrlKey: false, ...init } as KeyboardEvent;
}

describe("the platform's command modifier", () => {
  test("is Cmd on Apple platforms and Ctrl elsewhere", () => {
    expect(hasCommandModifier(keyEvent({ metaKey: true }), MAC)).toBe(true);
    expect(hasCommandModifier(keyEvent({ ctrlKey: true }), WINDOWS)).toBe(true);
  });

  test("does not accept the other platform's modifier", () => {
    // Ctrl+S on a Mac is not a shortcut anyone expects to fire, and Cmd is not a key on Windows.
    expect(hasCommandModifier(keyEvent({ ctrlKey: true }), MAC)).toBe(false);
    expect(hasCommandModifier(keyEvent({ metaKey: true }), WINDOWS)).toBe(false);
  });

  test("is labelled the way each platform writes it", () => {
    expect(modifierLabel(MAC)).toBe("⌘");
    expect(modifierLabel(WINDOWS)).toBe("Ctrl");
  });
});

describe("keystrokes aimed at a field", () => {
  function element(tagName: string, isContentEditable = false): EventTarget {
    return { tagName, isContentEditable } as unknown as EventTarget;
  }

  test("text entry is left to the field", () => {
    // Otherwise Backspace deletes the selected node while its name is being edited.
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(isTypingTarget(element(tag))).toBe(true);
    }
  });

  test("a contenteditable region counts as text entry", () => {
    expect(isTypingTarget(element("DIV", true))).toBe(true);
  });

  test("the canvas and its nodes do not", () => {
    expect(isTypingTarget(element("DIV"))).toBe(false);
    expect(isTypingTarget(element("BUTTON"))).toBe(false);
  });

  test("a missing target is not treated as a field", () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});
