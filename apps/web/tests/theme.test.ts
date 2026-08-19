import { describe, expect, test } from "bun:test";
import { config } from "@automend/shared";

/**
 * `index.html` applies the stored theme before the bundle loads, so it cannot import config — it repeats
 * the key and the class as literals. This is what makes that repetition safe: change either in config and
 * this fails rather than the app silently forgetting the theme on every reload.
 */
describe("the pre-paint theme script", () => {
  const html = Bun.file(`${import.meta.dir}/../index.html`);
  const { storageKey, darkClass, defaultOption } = config.webClient.theme;

  test("reads the key config stores the theme under", async () => {
    expect(await html.text()).toContain(`"${storageKey}"`);
  });

  test("toggles the class Tailwind's dark variant reads", async () => {
    expect(await html.text()).toContain(`classList.toggle("${darkClass}"`);
  });

  test("falls back to the same default the app does", async () => {
    expect(await html.text()).toContain(`|| "${defaultOption}"`);
  });
});
