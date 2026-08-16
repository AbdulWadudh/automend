import { config } from "@automend/shared";
import { createFileRoute, redirect } from "@tanstack/react-router";

/** `/app` has no page of its own yet — flows are the whole product so far. */
export const Route = createFileRoute("/app/")({
  beforeLoad: () => {
    throw redirect({ to: config.webClient.routes.flows });
  },
});
