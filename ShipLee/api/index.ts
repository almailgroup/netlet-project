/**
 * ShipLee's one Vercel function. Every /api path is rewritten onto it
 * (vercel.json). Deliberately two lines: Vercel finds a function from a
 * committed file here and transpiles it, so this only re-exports the bundle
 * `pnpm build` writes beside it.
 */
import handler from "./handler.generated.js";

export default handler;
