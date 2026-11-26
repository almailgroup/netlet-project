/**
 * Whether an error's message is the browser's or the parser's rather than
 * NetLet's: the request never reached the server, or what came back was not
 * an answer. Shown as it arrived, a shopper read "Unexpected token 'd',
 * "down" is not valid JSON" or "Failed to fetch" under a form — words for a
 * developer's console, in English on the Arabic page too. `tError` says these
 * as `error.network` instead; a message the server wrote is left alone.
 *
 * Each engine words a failed fetch its own way, so all of them are here:
 * Chrome and Edge "Failed to fetch", Safari "Load failed" or "The network
 * connection was lost.", Firefox "NetworkError when attempting to fetch
 * resource."; a body that is not JSON is the engine's parse error or tRPC's
 * "Unable to transform response from server"; a request NetLet gave up on is
 * the client's own deadline (`main.tsx`) or an abort.
 */
const TRANSPORT = [
  /^failed to fetch\b/i,
  /^load failed$/i,
  /^networkerror\b/i,
  /^network request failed$/i,
  /^the network connection was lost/i,
  /^the internet connection appears to be offline/i,
  /\bis not valid json\b/i,
  /^unexpected token\b/i,
  /^unexpected end of json input$/i,
  /^json\.parse:/i,
  /^unable to transform response from server$/i,
  /^the request took too long$/i,
  /^(the|this) operation was aborted/i,
  /^signal is aborted\b/i,
  /^the user aborted a request/i,
];

export function isTransportFailure(message: string): boolean {
  const said = message.trim();
  return TRANSPORT.some(shape => shape.test(said));
}

/**
 * Whether a failed email request — a reset, a one-time code — is said rather
 * than read as sent. The server answers every address alike and a fault of
 * its own reads as sent too, so a fault on one address cannot say it has an
 * account; what is said is what cannot vary by address: the throttle, and a
 * request that never reached NetLet. It read every failure but the throttle
 * as sent, so an offline press said "check your email" over a mail that never
 * went.
 */
export function saysEmailFailure(message: string): boolean {
  return message === "auth.tooManyAttempts" || isTransportFailure(message);
}
