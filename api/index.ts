/**
 * The Vercel entry point.
 *
 * Deliberately two lines. Vercel detects a function from a committed file in
 * `api/`, and transpiles whatever it finds — so this stays small enough that
 * there is nothing in it to transpile wrongly, and defers to the bundle that
 * `pnpm vercel-build` produces beside it.
 *
 * `server/_core/vercel.ts` explains why the bundle exists.
 */
import app from "./app.generated.js";

export default app;
