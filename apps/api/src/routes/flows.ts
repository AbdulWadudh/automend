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
  createFlowRunWithOutbox,
  deleteFlowForTenant,
  findFlowForTenant,
  findRunWithFlowForTenant,
  insertFlow,
  listDeliveriesForFlow,
  listFlowsForTenant,
  listRunsForFlow,
  listStepRunsForRun,
  registerFlowTrigger,
  updateFlowForTenant,
} from "@automend/db";
import { findTrigger } from "@automend/kits";
import {
  buildRunIdempotencyKey,
  config,
  createDefaultFlowDefinition,
  createFlowRequestSchema,
  type Flow,
  flowListQuerySchema,
  notFoundError,
  readTriggerText,
  startFlowRunRequestSchema,
  updateFlowRequestSchema,
} from "@automend/shared";
import { Hono } from "hono";
import type { ApiDependencies } from "../dependencies";
import { assertDefinitionIsExecutable } from "../http/definition-validation";
import { respondWithData } from "../http/envelope";
import { toRunDetailResponse, toRunResponse } from "../http/run-responses";
import { createRequireSession, getRequestContext, type SessionEnv } from "../http/session";
import { parseJsonBody, parseQuery, parseUuidParam } from "../http/validation";

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

/**
 * Records which trigger this flow is now listening on.
 *
 * Written on every definition save rather than only when the trigger changes, because the registration is
 * what the scheduler will read and a flow whose trigger was edited must not keep firing on the old one.
 *
 * `enabled` follows what this deployment can actually fire, so a polling trigger is registered but switched
 * off until the scheduler exists — the honest state rather than a promise.
 */
async function syncTriggerRegistration(deps: ApiDependencies, tenantId: string, row: FlowRow): Promise<void> {
  const { trigger } = row.definition;
  const definition = findTrigger(trigger.kitId, trigger.triggerName);

  if (!definition) {
    return;
  }

  const schedulable: readonly string[] = config.kits.schedulableTriggerStrategies;

  await registerFlowTrigger(deps.db, {
    tenantId,
    flowId: row.id,
    triggerId: trigger.id,
    kitId: trigger.kitId,
    triggerName: trigger.triggerName,
    strategy: definition.strategy,
    // The one value a scheduler needs and cannot derive: a cron expression lives in the trigger's own input.
    schedule: readTriggerText(trigger, "cron") ?? null,
    enabled: schedulable.includes(definition.strategy),
  });
}

export function createFlowRoutes(deps: ApiDependencies): Hono<SessionEnv> {
  const routes = new Hono<SessionEnv>();

  routes.use(createRequireSession(deps));

  routes.get("/", async (c) => {
    const { tenantId } = getRequestContext(c);
    const query = parseQuery(c, flowListQuerySchema);
    const rows = await listFlowsForTenant(deps.db, tenantId, { search: query.search, limit: query.limit });

    return respondWithData(
      c,
      rows.map((row) => ({ ...toFlowResponse(row), lastRunAt: row.lastRunAt?.toISOString() ?? null })),
    );
  });

  routes.post("/", async (c) => {
    const { tenantId, userId } = getRequestContext(c);
    const body = await parseJsonBody(c, createFlowRequestSchema);

    const definition = body.definition ?? createDefaultFlowDefinition();

    assertDefinitionIsExecutable(definition);

    const row = await insertFlow(deps.db, {
      tenantId,
      name: body.name,
      description: body.description ?? null,
      definition,
      createdBy: userId,
    });

    await syncTriggerRegistration(deps, tenantId, row);

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

    if (body.definition) {
      assertDefinitionIsExecutable(body.definition);
    }

    const row = await updateFlowForTenant(deps.db, tenantId, flowId, body);

    if (!row) {
      throw notFoundError(`No flow with id ${flowId}`);
    }

    if (body.definition) {
      await syncTriggerRegistration(deps, tenantId, row);
    }

    return respondWithData(c, toFlowResponse(row));
  });

  /**
   * What this flow has received. Used by the builder to show recent deliveries and to derive the
   * variables a step can refer to — the shape of real data beats a schema someone typed out.
   */
  routes.get(`${FLOW_ID_ROUTE}/deliveries`, async (c) => {
    const { tenantId } = getRequestContext(c);
    const flowId = parseUuidParam(c, FLOW_ID_PARAM);

    // Confirms the flow belongs to this workspace before reading anything hanging off it.
    if (!(await findFlowForTenant(deps.db, tenantId, flowId))) {
      throw notFoundError(`No flow with id ${flowId}`);
    }

    const deliveries = await listDeliveriesForFlow(deps.db, tenantId, flowId, config.flows.webhook.recentDeliveries);

    return respondWithData(
      c,
      deliveries.map((delivery) => ({
        ...delivery,
        receivedAt: delivery.receivedAt.toISOString(),
        processedAt: delivery.processedAt?.toISOString() ?? null,
      })),
    );
  });

  /**
   * Starting a run by hand.
   *
   * The run is created and its execution queued in one transaction, so a `202` here means what it means on the
   * webhook route: this will run, or nothing was written at all.
   *
   * `idempotencyKey` is optional. A caller that wants a double-clicked button to be one run supplies one; a
   * caller that does not gets a fresh run each time. Requiring it would be a nicer invariant and a worse API —
   * nobody has a stable id for "I pressed the button".
   */
  routes.post(`${FLOW_ID_ROUTE}/runs`, async (c) => {
    const { tenantId } = getRequestContext(c);
    const flowId = parseUuidParam(c, FLOW_ID_PARAM);
    const body = await parseJsonBody(c, startFlowRunRequestSchema);
    const row = await findFlowForTenant(deps.db, tenantId, flowId);

    if (!row) {
      throw notFoundError(`No flow with id ${flowId}`);
    }

    // Checked here rather than left to the engine, so a flow that cannot run says so while somebody is looking
    // at it. A run that fails a second later inside a worker is a far worse way to learn the same thing.
    assertDefinitionIsExecutable(row.definition);

    const run = await createFlowRunWithOutbox(deps.db, {
      tenantId,
      flowId,
      source: "manual",
      idempotencyKey: buildRunIdempotencyKey("manual", body.idempotencyKey ?? crypto.randomUUID()),
      definitionSnapshot: row.definition,
      triggerPayload: body.payload ?? null,
    });

    deps.logger.info({ flowId, tenantId, runId: run.id, duplicate: !run.isNew }, "manual run requested");

    return respondWithData(c, { runId: run.id, duplicate: !run.isNew }, run.isNew ? 202 : 200);
  });

  routes.get(`${FLOW_ID_ROUTE}/runs`, async (c) => {
    const { tenantId } = getRequestContext(c);
    const flowId = parseUuidParam(c, FLOW_ID_PARAM);

    // Confirms the flow belongs to this workspace before reading anything hanging off it.
    if (!(await findFlowForTenant(deps.db, tenantId, flowId))) {
      throw notFoundError(`No flow with id ${flowId}`);
    }

    const runs = await listRunsForFlow(deps.db, tenantId, flowId, config.runs.recentRuns);

    return respondWithData(c, runs.map(toRunResponse));
  });

  /** One run and its journal, which is what the builder shows when somebody opens it. */
  routes.get(`${FLOW_ID_ROUTE}/runs/:runId`, async (c) => {
    const { tenantId } = getRequestContext(c);
    const flowId = parseUuidParam(c, FLOW_ID_PARAM);
    const runId = parseUuidParam(c, "runId");
    const run = await findRunWithFlowForTenant(deps.db, tenantId, runId);

    // The flow id has to match as well as the tenant: a run reached through the wrong flow's URL is not this
    // flow's run, and answering with it would let one flow's history be read through another's address.
    if (!run || run.flowId !== flowId) {
      throw notFoundError(`No run with id ${runId}`);
    }

    const steps = await listStepRunsForRun(deps.db, tenantId, runId);

    return respondWithData(c, toRunDetailResponse(run, steps));
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
