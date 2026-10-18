/**
 * NetLet's half of the AI gateway (`Backend/gateway/`): deciding who may
 * use it, and signing the short-lived token that says so.
 *
 * The Worker holds the Gemini key and checks the token; this server holds
 * the knowledge the token carries — who is signed in, which store they act
 * for and at what rank (`can()`), and whether model calls are switched on
 * (the `ai` switch, 2.3). Nothing about a shopper but an opaque subject goes
 * into a token: an account number, or for a guest a keyed hash of their
 * address, so the gateway can count a guest's questions without ever
 * holding where they came from.
 *
 * Unconfigured is a state, not an error: no address, or a secret too short
 * to be one, answers `{ available: false }`, the way every optional service
 * here turns a feature off rather than stopping the server.
 */
import { ENV } from "../core/env.js";
import { gatewayConfigured, gatewayOrigin, guestSubject } from "../core/aiGateway.js";
import { featureOn } from "./features.js";
import { can, type Actor } from "../../../Shared/inventory/permissions.js";
import { TOKEN_TTL_SECONDS, signGatewayToken, type GatewayScope } from "../../../Shared/ai/gateway.js";

export type GatewaySession =
  | { available: false }
  | { available: true; url: string; token: string; expiresAt: number };

/** Whether anything that uses the gateway should be drawn at all. */
export async function gatewayAvailable(): Promise<boolean> {
  return gatewayConfigured() && (await featureOn("ai"));
}

async function session(scope: GatewayScope, sub: string, vendor: number | null): Promise<GatewaySession> {
  if (!(await gatewayAvailable())) return { available: false };
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const token = await signGatewayToken({ v: 1, scope, sub, vendor, exp }, ENV.aiGatewaySecret);
  return { available: true, url: gatewayOrigin()!, token, expiresAt: exp * 1000 };
}

/** The shop's assistant, for anybody — a signed-out browser is who is deciding whether to buy. */
export function chatSession(userId: number | null, address: string | null): Promise<GatewaySession> {
  return session("chat", userId ? `u:${userId}` : guestSubject(address), null);
}

/**
 * Drafting a product, for whoever may create one in that store: a seller at
 * the rank that adds products to their own, an administrator to any. The
 * draft is filled into the form and saved only by the person pressing Save,
 * so the permission asked is the one Save would ask.
 */
export async function catalogSession(actor: Actor, vendorId: number | null): Promise<GatewaySession> {
  if (!can(actor, "product.create", vendorId ?? undefined)) throw new Error("FORBIDDEN:product.create");
  const vendor = actor.kind === "vendor" ? actor.vendorId : vendorId;
  return session("catalog", `u:${actor.userId}`, vendor);
}
