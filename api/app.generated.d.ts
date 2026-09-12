/**
 * Types for the build output, which is gitignored and absent in a fresh clone.
 *
 * Without this, `pnpm check` fails on a checkout that has not been built —
 * which would make the typecheck depend on build order for no reason.
 */
import type { Express } from "express";

declare const app: Express;
export default app;
