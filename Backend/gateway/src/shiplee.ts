/**
 * ShipLee's door into the gateway, on the owner's word ("implement the AI that
 * we have, Gemini, named ShipLee AI, from the Cloudflare Worker").
 *
 * ShipLee — the parcel-tracking site in `ShipLee/` — is a second project with
 * its own server, and that server asks Gemini through this Worker, so there is
 * still one key and one bill. It is a door of its own rather than a NetLet
 * task:
 *
 * - **Its own secret** (`SHIPLEE_GATEWAY_SECRET`), never NetLet's, so neither
 *   project's server can mint the other's tokens: a NetLet token is refused
 *   here, and a ShipLee one on NetLet's routes.
 * - **Its own tasks** (`SHIPLEE_TASKS`), each counted apart by
 *   `SHIPLEE_LIMITER` as a backstop. Each customer's and each desk's ceiling
 *   is ShipLee's own, counted in its database before it calls — every call
 *   arrives from Vercel's few addresses, so an address ceiling here would only
 *   ever count Vercel.
 * - **Words only**: no photo in, no drawing, no search. ShipLee asks for a
 *   sentence or a filled form, and a leaked ShipLee secret should spend no
 *   more than that.
 *
 * The token is NetLet's format, `v1.<claims>.<signature>` (HMAC-SHA-256 of
 * `v1.<claims>`, both base64url), with claims of its own:
 * `{ v: 1, app: "shiplee", task, exp }`. ShipLee's server signs one for each
 * call, a minute long (`ShipLee/server/gateway.ts`); the same test vector is
 * checked on both sides, so the two cannot drift.
 */
import { readSignedClaims, TOKEN_SKEW_SECONDS, TOKEN_TTL_SECONDS } from "../../../Shared/ai/gateway.js";

export const SHIPLEE_ROUTE = "/api/shiplee/generate";

/** The customer's questions on the tracking page and Help, and the staff desk reading an order message. */
export const SHIPLEE_TASKS = ["assistant", "intake"] as const;
export type ShipLeeTask = (typeof SHIPLEE_TASKS)[number];

export type ShipLeeClaims = { v: 1; app: "shiplee"; task: ShipLeeTask; exp: number };

function isShipLeeClaims(value: unknown): value is ShipLeeClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Record<string, unknown>;
  return claims.v === 1
    && claims.app === "shiplee"
    && SHIPLEE_TASKS.includes(claims.task as ShipLeeTask)
    && Number.isInteger(claims.exp);
}

/**
 * The claims of a live token ShipLee signed with `secret`, or null — for a bad
 * signature, NetLet's secret, NetLet's claims, an expired token, and one that
 * lives longer than any ShipLee mints, which only a leak produces.
 */
export async function verifyShipLeeToken(token: string, secret: string, nowSeconds: number): Promise<ShipLeeClaims | null> {
  const claims = await readSignedClaims(token, secret);
  if (!isShipLeeClaims(claims)) return null;
  if (claims.exp <= nowSeconds - TOKEN_SKEW_SECONDS) return null;
  if (claims.exp > nowSeconds + TOKEN_TTL_SECONDS + TOKEN_SKEW_SECONDS) return null;
  return claims;
}
