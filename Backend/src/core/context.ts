import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../database/schema.js";
import { authenticateRequest } from "./auth.js";
import { throttledAs, type Throttled } from "./security.js";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /** Over a ceiling (`security.ts`): the base procedure refuses it before anything runs. */
  throttled?: Throttled;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  // Authentication is optional: public procedures run for signed-out visitors,
  // and `protectedProcedure` is what rejects a missing user.
  // Over a ceiling: refused before anything runs, so not even the session is read.
  const throttled = throttledAs(opts.req);
  if (throttled) return { req: opts.req, res: opts.res, user: null, throttled };
  const user = await authenticateRequest(opts.req).catch(() => null);
  return { req: opts.req, res: opts.res, user };
}
