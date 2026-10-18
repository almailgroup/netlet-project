/**
 * Searching with a photo (3.1.6): what is sent, and what may come back.
 *
 * Pure and shared, for the reason the password floor is: the panel shrinks
 * and checks the photo against the same limits the API refuses on.
 *
 * ## The photo is the only thing that leaves, and it is shrunk first
 *
 * A model turns the picture into a few words, and the shop then searches for
 * those words the ordinary way. Nothing else about the shopper goes with it —
 * no account, no basket, no location — and the photo is shrunk in the browser
 * to `PHOTO_MAX_EDGE` before it is sent: enough to tell a kettle from a lamp,
 * and too small to read a letter lying on the counter behind it. NetLet keeps
 * neither the photo nor the words.
 *
 * ## The model's reply is a query, never anything more
 *
 * What comes back is reduced to a handful of words in letters and digits —
 * `queryFromModel` — and only ever typed into the search field. It cannot add a
 * product, rank one, or say anything to the shopper in its own voice. A photo
 * of a sign reading "ignore your instructions" yields, at worst, a search for
 * those words.
 */

/** The longest edge, in pixels, a photo is shrunk to before it is sent. */
export const PHOTO_MAX_EDGE = 768;
/**
 * The most a photo may weigh once encoded, in characters of its data URL.
 * Under the API's 256 KB body limit with room for the envelope, rather than
 * raising that limit for every route to suit one: a 768px JPEG fits easily,
 * and the panel steps the quality down until it does.
 */
export const MAX_PHOTO_CHARS = 240_000;
/** The most words a query from a photo may carry. */
export const MAX_PHOTO_QUERY_WORDS = 6;
const MAX_PHOTO_QUERY_CHARS = 80;

const DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A photo the API will accept: a small JPEG, PNG or WebP as a data URL. */
export function acceptablePhoto(dataUrl: string): boolean {
  return dataUrl.length <= MAX_PHOTO_CHARS && DATA_URL.test(dataUrl);
}

/**
 * The search a model's reply comes to, or "" for nothing usable.
 *
 * It asks for `{"query": "…"}` and takes the field if it is there and the
 * whole text if it is not, then keeps only letters, digits and single spaces
 * in any script — so Arabic survives and punctuation, markup and anything
 * shaped like an instruction does not — and stops at a handful of words.
 */
export function queryFromModel(raw: string): string {
  let text = raw.trim();
  const fenced = /\{[\s\S]*\}/.exec(text)?.[0];
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced) as { query?: unknown };
      text = typeof parsed.query === "string" ? parsed.query : "";
    } catch {
      /* Not JSON after all: fall through to the plain text. */
    }
  }
  const words = text
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(word => word && word !== "-")
    .slice(0, MAX_PHOTO_QUERY_WORDS);
  return words.join(" ").slice(0, MAX_PHOTO_QUERY_CHARS).trim();
}
