/**
 * Flow requests and the query keys they are cached under.
 *
 * Keys live here rather than in components so a mutation and the list it invalidates cannot spell
 * the same cache entry differently.
 */

import {
  type CreateFlowRequest,
  type Flow,
  type FlowDelivery,
  type FlowListItem,
  type FlowListQuery,
  flowDeliveryListSchema,
  flowListSchema,
  flowSchema,
  type UpdateFlowRequest,
} from "@automend/shared";
import { z } from "zod";
import { requestApi } from "./api";

const FLOWS_PATH = "/flows";

export const flowQueryKeys = {
  all: ["flows"] as const,
  /** Every listing, whatever it searched for — what a mutation invalidates. */
  lists: () => [...flowQueryKeys.all, "list"] as const,
  list: (query: FlowListQuery = {}) => [...flowQueryKeys.lists(), query] as const,
  detail: (flowId: string) => [...flowQueryKeys.all, "detail", flowId] as const,
  deliveries: (flowId: string) => [...flowQueryKeys.all, "deliveries", flowId] as const,
};

export async function listFlows(query: FlowListQuery = {}, signal?: AbortSignal): Promise<FlowListItem[]> {
  const search = new URLSearchParams();

  if (query.search) {
    search.set("search", query.search);
  }

  if (query.limit !== undefined) {
    search.set("limit", String(query.limit));
  }

  const suffix = search.toString();

  return await requestApi({
    path: suffix ? `${FLOWS_PATH}?${suffix}` : FLOWS_PATH,
    schema: flowListSchema,
    signal,
  });
}

export async function getFlow(flowId: string, signal?: AbortSignal): Promise<Flow> {
  return await requestApi({ path: `${FLOWS_PATH}/${flowId}`, schema: flowSchema, signal });
}

export async function createFlow(body: CreateFlowRequest): Promise<Flow> {
  return await requestApi({ path: FLOWS_PATH, schema: flowSchema, method: "POST", body });
}

export async function updateFlow(flowId: string, body: UpdateFlowRequest): Promise<Flow> {
  return await requestApi({ path: `${FLOWS_PATH}/${flowId}`, schema: flowSchema, method: "PATCH", body });
}

export async function listDeliveries(flowId: string, signal?: AbortSignal): Promise<FlowDelivery[]> {
  return await requestApi({ path: `${FLOWS_PATH}/${flowId}/deliveries`, schema: flowDeliveryListSchema, signal });
}

export async function deleteFlow(flowId: string): Promise<void> {
  await requestApi({
    path: `${FLOWS_PATH}/${flowId}`,
    schema: z.object({ id: z.uuid() }),
    method: "DELETE",
  });
}
