/**
 * The maps a shopper can drop a pin on: Google's, Apple's, or neither.
 *
 * A shopper chooses between the two on the picker itself, because people here
 * use both — an iPhone opens Apple Maps for an address and most Android phones
 * open Google's — and a map you already know is one you can find your own roof
 * on. Each is drawn only when its keys are set, the rule every value in
 * `.env.example` follows; with neither, the picker falls back to OpenStreetMap,
 * which needs no account, so the pin keeps working before either exists.
 *
 * **Google's key goes to the browser**, because Google's map is drawn there and
 * asks for it by name. That is how it is designed to be used: the key is locked
 * to NetLet's own addresses in the Google Cloud console, and what it can spend
 * is set there too.
 *
 * **Apple's private key never does.** MapKit JS asks the page for a token, and
 * the server signs one — ES256, the team and key ids Apple issued, and the
 * origin it is good for — that lapses in half an hour. A ready-made token from
 * the Apple Developer site (locked to NetLet's domain there) is taken as it is,
 * which is the simpler setup and needs no private key on the server at all.
 */
import { importPKCS8, SignJWT } from "jose";
import { ENV } from "./env.js";

/** How long a signed MapKit token is good for: longer than a checkout, shorter than a day. */
const APPLE_TOKEN_TTL_SECONDS = 30 * 60;

export type MapProviders = {
  google: string | null;
  apple: boolean;
  /** Whether tracking asks Apple for a driving time (3.4.3), which the privacy policy says. */
  drivingTimes: boolean;
};

function appleSigningConfigured(): boolean {
  return Boolean(ENV.appleMapkitTeamId && ENV.appleMapkitKeyId && ENV.appleMapkitPrivateKey);
}

/** What the picker may offer. Google's key rides along because the browser needs it. */
export function mapProviders(): MapProviders {
  return {
    google: ENV.googleMapsKey || null,
    apple: Boolean(ENV.appleMapkitToken) || appleSigningConfigured(),
    drivingTimes: appleSigningConfigured(),
  };
}

/**
 * A Maps Server API auth token (3.4.3), or null when no key is set up.
 *
 * The same team, key id and private key as MapKit JS's, with
 * `scope: "server_api"` and no origin — what Apple asks for a server's own
 * calls. Only a signed token reaches that API: Apple says a ready-made one
 * works for every framework but this, so `APPLE_MAPKIT_TOKEN` alone draws the
 * map and leaves the estimate to the distance.
 */
export async function appleServerAuthToken(): Promise<string | null> {
  if (!appleSigningConfigured()) return null;
  const key = await importPKCS8(ENV.appleMapkitPrivateKey, "ES256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scope: "server_api" })
    .setProtectedHeader({ alg: "ES256", kid: ENV.appleMapkitKeyId, typ: "JWT" })
    .setIssuer(ENV.appleMapkitTeamId)
    .setIssuedAt(now)
    .setExpirationTime(now + APPLE_TOKEN_TTL_SECONDS)
    .sign(key);
}

/**
 * A MapKit JS token for a page on `origin`, or null when Apple's map is off.
 *
 * The ready-made token wins when both are set: it is what Apple's own site
 * issued, and the person who pasted it meant it.
 */
export async function appleMapToken(origin: string | null): Promise<string | null> {
  if (ENV.appleMapkitToken) return ENV.appleMapkitToken;
  if (!appleSigningConfigured()) return null;

  const key = await importPKCS8(ENV.appleMapkitPrivateKey, "ES256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(origin ? { origin } : {})
    .setProtectedHeader({ alg: "ES256", kid: ENV.appleMapkitKeyId, typ: "JWT" })
    .setIssuer(ENV.appleMapkitTeamId)
    .setIssuedAt(now)
    .setExpirationTime(now + APPLE_TOKEN_TTL_SECONDS)
    .sign(key);
}
