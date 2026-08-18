import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
// Imported by path rather than by package name: Vite bundles this config with esbuild before any
// workspace resolution is available.
import { config } from "../../packages/shared/src/config";

const srcDirectory = fileURLToPath(new URL("./src", import.meta.url));

/**
 * The repo root, not this app: there is one `.env` for the whole monorepo, and Vite otherwise
 * looks for it next to `vite.config.ts`.
 */
const rootEnvDirectory = fileURLToPath(new URL("../../", import.meta.url));

/** Treats an unset *and* an empty variable as absent, so a blank line in `.env` uses the default. */
function envOrDefault(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

export default defineConfig(({ mode }) => {
  // The empty prefix loads every variable for use *here*, in the Node-side config. It does not
  // expose them to the browser — that is governed by `envPrefix`, which stays at its `VITE_`
  // default, so a database password in `.env` can never reach the bundle.
  const env = loadEnv(mode, rootEnvDirectory, "");

  /**
   * The dev server proxies the API, ops and OTLP prefixes rather than the browser calling them
   * cross-origin. The production container does the same thing (see `server.ts`), so application
   * code only ever uses relative URLs and no upstream address is baked into the bundle.
   */
  const apiProxyTarget = envOrDefault(env.VITE_API_PROXY_TARGET, config.services.web.defaultApiProxyTarget);
  const otlpProxyTarget = envOrDefault(env.OTEL_EXPORTER_OTLP_ENDPOINT, config.telemetry.defaultEndpoint);

  return {
    envDir: rootEnvDirectory,
    plugins: [
      // Must come before the React plugin: it generates the route tree the app imports.
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": srcDirectory,
      },
      /**
       * Lexical checks that every node registered with an editor subclasses *its own*
       * `LexicalNode`. Two copies of the package therefore mean two class identities and an editor
       * that refuses to start — `nodes[1] ListNode is not a constructor that subclasses
       * LexicalNode`.
       *
       * Rollup collapses the duplicates when building, so this only ever fails in dev, where each
       * pre-bundled dependency can end up carrying its own copy. Listing them here forces one.
       */
      dedupe: [
        "lexical",
        "@lexical/react",
        "@lexical/list",
        "@lexical/rich-text",
        "@lexical/html",
        "@lexical/utils",
        "@lexical/selection",
      ],
    },
    server: {
      port: config.services.web.devServerPort,
      proxy: {
        [config.http.routes.apiProxyPrefix]: { target: apiProxyTarget, changeOrigin: true },
        // The api serves the queue dashboard here. Deliberately no `rewrite`: the dashboard builds
        // its asset URLs from the prefix, so removing it breaks every one of them.
        [config.http.routes.opsPrefix]: { target: apiProxyTarget, changeOrigin: true },
        [config.http.routes.otlpProxyPrefix]: {
          target: otlpProxyTarget,
          changeOrigin: true,
          // The collector serves /v1/logs; the prefix exists only to namespace it on this origin.
          rewrite: (path) => path.replace(config.http.routes.otlpProxyPrefix, ""),
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});
