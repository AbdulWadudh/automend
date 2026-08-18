/**
 * `/api/v1/runs` — runs read across every flow, which is what the dashboard asks for. The flow-scoped
 * listings under `flows/:flowId/runs` stay where they are; they answer a different question.
 */

import {
  findFlowForTenant,
  findRunWithFlowForTenant,
  listRunsForTenant,
  listStepRunsForRun,
  retriggerRun,
  summariseRunsForTenant,
} from "@automend/db";
import {
  isTerminalRunStatus,
  notFoundError,
  type RunStatus,
  requestValidationError,
  retriggerRunRequestSchema,
  runListQuerySchema,
  runStatsQuerySchema,
  summariseRunGroups,
} from "@automend/shared";
import { Hono } from "hono";
import type { ApiDependencies } from "../dependencies";
import { assertDefinitionIsExecutable } from "../http/definition-validation";
import { respondWithData } from "../http/envelope";
import { toRunDetailResponse, toRunListItemResponse } from "../http/run-responses";
import { createRequireSession, getRequestContext, type SessionEnv } from "../http/session";
import { parseJsonBody, parseQuery, parseUuidParam } from "../http/validation";

const RUN_ID_PARAM = "runId";
const RUN_ID_ROUTE = `/:${RUN_ID_PARAM}`;

const MS_PER_HOUR = 60 * 60 * 1000;

export function createRunRoutes(deps: ApiDependencies): Hono<SessionEnv> {
  const routes = new Hono<SessionEnv>();

  routes.use(createRequireSession(deps));

  routes.get("/", async (c) => {
    const { tenantId } = getRequestContext(c);
    const query = parseQuery(c, runListQuerySchema);

    const runs = await listRunsForTenant(deps.db, tenantId, {
      flowId: query.flowId,
      status: query.status,
      limit: query.limit,
      before: query.before,
    });

    return respondWithData(c, runs.map(toRunListItemResponse));
  });

  // Registered before `/:runId`, which Hono would otherwise match "stats" against.
  routes.get("/stats", async (c) => {
    const { tenantId } = getRequestContext(c);
    const { windowHours } = parseQuery(c, runStatsQuerySchema);
    const since = new Date(Date.now() - windowHours * MS_PER_HOUR);

    const groups = await summariseRunsForTenant(deps.db, tenantId, since);

    const stats = summariseRunGroups(
      groups.map((group) => ({ ...group, lastRunAt: group.lastRunAt?.toISOString() ?? null })),
      { windowHours, since: since.toISOString() },
    );

    return respondWithData(c, stats);
  });

  routes.get(RUN_ID_ROUTE, async (c) => {
    const { tenantId } = getRequestContext(c);
    const runId = parseUuidParam(c, RUN_ID_PARAM);
    const run = await findRunWithFlowForTenant(deps.db, tenantId, runId);

    if (!run) {
      throw notFoundError(`No run with id ${runId}`);
    }

    const steps = await listStepRunsForRun(deps.db, tenantId, runId);

    return respondWithData(c, toRunDetailResponse(run, steps));
  });

  routes.post(`${RUN_ID_ROUTE}/retrigger`, async (c) => {
    const { tenantId } = getRequestContext(c);
    const runId = parseUuidParam(c, RUN_ID_PARAM);
    const body = await parseJsonBody(c, retriggerRunRequestSchema);
    const source = await findRunWithFlowForTenant(deps.db, tenantId, runId);

    if (!source) {
      throw notFoundError(`No run with id ${runId}`);
    }

    /**
     * An unfinished run may still be mid-send, and this starts a *second* run rather than retrying the
     * first — so the step journal, which makes a retry of the same run safe, protects nothing here.
     */
    if (!isTerminalRunStatus(source.status as RunStatus)) {
      throw requestValidationError(
        `This run is still ${source.status}. Wait for it to finish before starting it again.`,
      );
    }

    const flow = await findFlowForTenant(deps.db, tenantId, source.flowId);

    if (!flow) {
      throw notFoundError(`No flow with id ${source.flowId}`);
    }

    assertDefinitionIsExecutable(flow.definition);

    const run = await retriggerRun(deps.db, {
      tenantId,
      sourceRunId: source.id,
      flowId: source.flowId,
      gestureToken: body.idempotencyKey ?? crypto.randomUUID(),
      definitionSnapshot: flow.definition,
      triggerPayload: source.triggerPayload,
    });

    deps.logger.info({ tenantId, flowId: source.flowId, sourceRunId: source.id, runId: run.id }, "run retriggered");

    return respondWithData(c, { runId: run.id, duplicate: !run.isNew }, run.isNew ? 202 : 200);
  });

  return routes;
}
