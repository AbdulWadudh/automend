/**
 * The contract between the Operations page and the API.
 *
 * The page's job is to say which operator consoles this deployment actually has and to get you into
 * them. Both facts are runtime ones — a console exists only if a credential was configured, and the
 * database studio's address differs per deployment — so neither can be a build-time constant the way
 * the queue dashboard's own path can.
 *
 * Copy (headings, warnings, button labels) deliberately does not live here. It belongs to the
 * component that renders it; this module carries only what the browser cannot work out for itself.
 */

import { z } from "zod";
import { config } from "./config";

export const opsConsolesSchema = z.object({
  /**
   * `available` is whether the api mounted the dashboard at all; `unlocked` is whether *this*
   * browser has already presented the operator password. Two flags rather than one, because they
   * call for completely different things on screen: an explanation versus a link.
   */
  queues: z.object({
    available: z.boolean(),
    unlocked: z.boolean(),
  }),
  /**
   * The studio runs as its own container on its own origin, so the API can only report the address it
   * was told. Null when the deployment did not configure one — there is no address to guess.
   */
  database: z.object({
    available: z.boolean(),
    url: z.url().nullable(),
  }),
});

export type OpsConsoles = z.infer<typeof opsConsolesSchema>;

/**
 * Bounded so a request cannot be used to hand the API an arbitrarily large body to hash. The lower
 * bound is 1 rather than the configured minimum: telling a caller how long the password is supposed
 * to be, before they have got it right, is help they have not earned.
 */
export const opsSignInRequestSchema = z.object({
  password: z.string().min(1).max(config.validation.opsPassword.maxLength),
});

export type OpsSignInRequest = z.infer<typeof opsSignInRequestSchema>;
