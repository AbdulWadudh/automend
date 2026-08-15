import { config } from "@automend/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startBrowserTelemetry } from "./lib/telemetry";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

// Started before the app renders, so an error during the first paint is still captured.
startBrowserTelemetry();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: config.webClient.queryStaleTimeMs,
      retry: config.webClient.queryRetryCount,
    },
  },
});

// The query client is exposed as router context so loaders can prefetch with the same cache the
// components read from.
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: config.webClient.routerPreload,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById(config.services.web.rootElementId);

if (!rootElement) {
  throw new Error(`Cannot mount the app: no element with id "${config.services.web.rootElementId}" in index.html`);
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
