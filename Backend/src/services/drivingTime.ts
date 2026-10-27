/**
 * How long the road from the driver to the door takes now (3.4.3: "estimated
 * arrival time based on distance and traffic"), from Apple's Maps Server API.
 *
 * Apple's because the shop already holds a MapKit key for the pin picker, and
 * the same team, key id and private key sign a server token — no second
 * provider account, and Apple's server API is free to a developer account up to
 * a daily quota. `appleServerAuthToken` (`core/maps.ts`) signs it; Apple trades
 * it for a half-hour access token (`/v1/token`), and `/v1/etas` answers the
 * driving time for the road as it is (`expectedTravelTimeSeconds`, traffic
 * included).
 *
 * **Every way it does not answer is the same answer: null**, and the caller
 * falls back to the distance band in `Shared/commerce/tracking.ts`. No key, a
 * refusal, a timeout, a body of another shape — a shopper waiting for a parcel
 * sees an estimate either way, labelled with where it came from.
 *
 * Three things keep it cheap and quiet:
 *
 * - **An answer is kept for a minute** per driver point and door, rounded to
 *   about ten metres. The order page asks every twenty seconds and a driver
 *   reports every ten at most, so most asks are the same journey.
 * - **The access token is kept until shortly before it lapses**, in this
 *   instance's memory. A credential, not a count: a fresh instance asks for a
 *   new one, which is what it would do anyway.
 * - **A refusal from Apple stops the asking for a quarter of an hour** — a key
 *   Apple rejects or a day's quota spent is not cured by asking again every
 *   twenty seconds — and is logged once, not on every poll.
 *
 * What goes to Apple is two points: where the driver is and the pin on the
 * door. No name, no order, no account; the privacy policy says it while this
 * is configured (`maps.providers`' `drivingTimes`).
 */
import type { Pin } from "../../../Shared/commerce/geo.js";
import { appleServerAuthToken } from "../core/maps.js";
import { describeError } from "../core/describeError.js";

const API = "https://maps-api.apple.com/v1";
/** The order page polls; a slow answer is not worth holding it for. */
const DEADLINE_MS = 3000;
const ANSWER_TTL_MS = 60_000;
const ANSWER_CEILING = 500;
const REFUSED_FOR_MS = 15 * 60_000;
/** Ask for a new access token this long before the old one lapses. */
const TOKEN_MARGIN_MS = 60_000;

export type Drive = { seconds: number; meters: number };

type Reply = { ok: boolean; status: number; json(): Promise<unknown> };
/** The seam the tests replace: Apple is not reachable from where they run. */
export type Transport = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Reply>;

const defaultTransport: Transport = (url, init) => fetch(url, init);
let transport: Transport = defaultTransport;
let access: { token: string; until: number } | null = null;
let refusedUntil = 0;
const answers = new Map<string, Drive & { at: number }>();

/** For tests: a stand-in for Apple, and a clean slate. Null puts the real one back. */
export function useTransport(next: Transport | null): void {
  transport = next ?? defaultTransport;
  access = null;
  refusedUntil = 0;
  answers.clear();
}

const point = (pin: Pin) => `${pin.lat.toFixed(4)},${pin.lng.toFixed(4)}`;

async function ask(url: string, bearer: string): Promise<Reply> {
  return transport(url, { headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(DEADLINE_MS) });
}

function refuse(now: number, why: string): null {
  if (refusedUntil <= now) console.warn(`[maps] Apple's driving times are paused for 15 minutes: ${why}`);
  refusedUntil = now + REFUSED_FOR_MS;
  access = null;
  return null;
}

async function accessToken(now: number): Promise<string | null> {
  if (access && access.until > now) return access.token;
  const auth = await appleServerAuthToken();
  if (!auth) return null;
  const reply = await ask(`${API}/token`, auth);
  if (!reply.ok) return refuse(now, `the token endpoint answered ${reply.status}`);
  const body = await reply.json() as { accessToken?: unknown; expiresInSeconds?: unknown } | null;
  if (typeof body?.accessToken !== "string" || !body.accessToken) return refuse(now, "the token endpoint answered without a token");
  const lifetime = typeof body.expiresInSeconds === "number" && body.expiresInSeconds > 0 ? body.expiresInSeconds * 1000 : 30 * 60_000;
  access = { token: body.accessToken, until: now + Math.max(0, lifetime - TOKEN_MARGIN_MS) };
  return access.token;
}

/** The driving time from `from` to `to` now, or null for every way Apple did not say. */
export async function drivingTime(from: Pin, to: Pin, now = Date.now()): Promise<Drive | null> {
  if (refusedUntil > now) return null;
  const key = `${point(from)}>${point(to)}`;
  const kept = answers.get(key);
  if (kept && now - kept.at < ANSWER_TTL_MS) return { seconds: kept.seconds, meters: kept.meters };

  try {
    const token = await accessToken(now);
    if (!token) return null;
    const url = `${API}/etas?origin=${point(from)}&destinations=${point(to)}&transportType=Automobile`;
    const reply = await ask(url, token);
    /* A lapsed access token is answered 401: drop it, and the next poll asks for another. */
    if (reply.status === 401) { access = null; return null; }
    if (reply.status === 429) return refuse(now, "the day's quota is spent");
    if (!reply.ok) return null;
    const body = await reply.json() as { etas?: { expectedTravelTimeSeconds?: unknown; distanceMeters?: unknown }[] } | null;
    const eta = Array.isArray(body?.etas) ? body.etas[0] : undefined;
    const seconds = eta?.expectedTravelTimeSeconds;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
    const meters = typeof eta?.distanceMeters === "number" && Number.isFinite(eta.distanceMeters) ? eta.distanceMeters : 0;

    if (answers.size >= ANSWER_CEILING) answers.delete(answers.keys().next().value!);
    answers.set(key, { seconds, meters, at: now });
    return { seconds, meters };
  } catch (error) {
    /* A timeout or a dropped connection: this poll gets the distance band. */
    console.warn(`[maps] no driving time from Apple: ${describeError(error)}`);
    return null;
  }
}
