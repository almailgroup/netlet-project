/**
 * The Vercel function's entry, bundled by scripts/build-function.mjs into
 * api/handler.generated.js with every dependency inside it — NetLet's lesson:
 * a function Vercel only transpiles runs as loose Node ESM files, where
 * imports that every other tool resolves can fail at the first request.
 */
import { nodeHandler } from "./node.js";

export default nodeHandler;
