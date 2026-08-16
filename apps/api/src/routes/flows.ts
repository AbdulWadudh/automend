/**
 * `/api/v1/flows` — the flows a workspace owns.
 *
 * Every handler reads its tenant from the request context rather than from the request itself, and
 * every query passes it to the query helper, which puts it in the `where` clause. A flow that
 * belongs to another workspace is reported as missing, not as forbidden: saying "you may not see
 * this" confirms that it exists.
 */

import type { FlowRow } from "@automend/db";
import {
  deleteFlowForTenant,
  findFlowForTenant,
  insertFlow,
  listFlowsForTenant,
  updateFlowForTenant,
} from "@automend/db";
import {
  createDefaultFlowDefinition,
  createFlowRequestSchema,
  type Flow,
  notFoundError,
  updateFlowRequestSchema,
} from "@automend/shared";
import { Hono } from "hono";
import type { ApiDependencies } from "../dependencies";
import { respondWithData } from "../http/envelope";
import { createRequireSession, getRequestContext, type SessionEnv } from "../http/session";
import { parseJsonBody, parseUuidParam } from "../http/validation";

/** Local to this router: nothing outside it addresses the parameter by name. */
const FLOW_ID_PARAM = "flowId";
const FLOW_ID_ROUTE = `/:${FLOW_ID_PARAM}`;

/**
 * Timestamps become ISO strings and the definition is handed over as stored. The column is typed
 * `jsonb`, so it is validated by `flowSchema` on the way in — not re-parsed on the way out.
 */
function toFlowResponse(row: FlowRow): Flow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    definition: row.definition,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createFlowRoutes(deps: ApiDependencies): Hono<SessionEnv> {
  const routes = new Hono<SessionEnv>();

  routes.use(createRequireSession(deps));

  routes.get("/", async (c) => {
    const { tenantId } = getRequestContext(c);
    const rows = await listFlowsForTenant(deps.db, tenantId);

    return respondWithData(c, rows.map(toFlowResponse));
  });

  routes.post("/", async (c) => {
    const { tenantId, userId } = getRequestContext(c);
    const body = await parseJsonBody(c, createFlowRequestSchema);

    const row = await insertFlow(deps.db, {
      tenantId,
      name: body.name,
      description: body.description ?? null,
      definition: body.definition ?? createDefaultFlowDefinition(),
      createdBy: userId,
    });

    return respondWithData(c, toFlowResponse(row), 201);
  });

  routes.get(FLOW_ID_ROUTE, async (c) => {
    const { tenantId } = getRequestContext(c);
    const flowId = parseUuidParam(c, FLOW_ID_PARAM);
    const row = await findFlowForTenant(deps.db, tenantId, flowId);

    if (!row) {
      throw notFoundError(`No flow with id ${flowId}`);
    }

    return respondWithData(c, toFlowResponse(row));
  });

  routes.patch(FLOW_ID_ROUTE, async (c) => {
    const { tenantId } = getRequestContext(c);
    const flowId = parseUuidParam(c, FLOW_ID_PARAM);
    const body = await parseJsonBody(c, updateFlowRequestSchema);

    const row = await updateFlowForTenant(deps.db, tenantId, flowId, body);

    if (!row) {
      throw notFoundError(`No flow with id ${flowId}`);
    }

    return respondWithData(c, toFlowResponse(row));
  });

  routes.delete(FLOW_ID_ROUTE, async (c) => {
    const { tenantId } = getRequestContext(c);
    const flowId = parseUuidParam(c, FLOW_ID_PARAM);
    const deleted = await deleteFlowForTenant(deps.db, tenantId, flowId);

    if (!deleted) {
      throw notFoundError(`No flow with id ${flowId}`);
    }

    return respondWithData(c, { id: flowId });
  });

  return routes;
}
