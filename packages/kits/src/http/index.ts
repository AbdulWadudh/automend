/**
 * `http` — the escape hatch.
 *
 * Any service without a kit of its own is reachable through this one, which is what stops "we have no
 * Xero kit" from meaning "you cannot automate Xero". It needs no credentials of its own because
 * whatever the call requires goes in the headers.
 */

import { createKit } from "@automend/kit-framework";
import { httpRequestAction } from "./actions/request";

export const httpKit = createKit({
  id: "http",
  displayName: "HTTP",
  description: "Call any URL, for services that have no kit of their own yet.",
  actions: [httpRequestAction],
});
