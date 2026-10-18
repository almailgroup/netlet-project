import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../database/schema.js";
import { authenticateRequest } from "./auth.js";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  // Authentication is optional: public procedures run for signed-out visitors,
  // and `protectedProcedure` is what rejects a missing user.
  const user = await authenticateRequest(opts.req).catch(() => null);
  return { req: opts.req, res: opts.res, user };
}
