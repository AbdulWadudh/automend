import { describe, expect, test } from "bun:test";
import { config } from "@automend/shared";
import { resolveRedirectTarget } from "../../src/lib/redirects";

const { routes } = config.webClient;

/**
 * The redirect target arrives in a query string, so it is attacker-controlled input: a link to
 * `/sign-in?redirect=https://evil.example` must not send a freshly signed-in user off-site.
 */
describe("resolving where to go after signing in", () => {
  test("keeps a path inside the app", () => {
    expect(resolveRedirectTarget(`${routes.flows}/abc`)).toBe(`${routes.flows}/abc`);
  });

  test("falls back to the flow list when there is nothing to go back to", () => {
    expect(resolveRedirectTarget(undefined)).toBe(routes.flows);
    expect(resolveRedirectTarget("")).toBe(routes.flows);
    expect(resolveRedirectTarget(null)).toBe(routes.flows);
  });

  test("refuses anything that could leave this origin", () => {
    const attempts = [
      "https://evil.example",
      "//evil.example",
      `${routes.app}//evil.example`,
      "javascript:alert(1)",
      `${routes.app}/../../evil`,
      "\\\\evil.example",
    ];

    for (const attempt of attempts) {
      expect(resolveRedirectTarget(attempt)).toBe(routes.flows);
    }
  });

  test("refuses a path outside the signed-in area", () => {
    expect(resolveRedirectTarget(routes.privacy)).toBe(routes.flows);
  });
});
