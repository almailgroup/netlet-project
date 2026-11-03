import { waitUntil } from "@vercel/functions";
import { DB_IDLE_SECONDS } from "../services/db.js";

/**
 * Keeps a Vercel instance awake until its idle database connections close.
 *
 * Vercel freezes an instance once it has answered, and a frozen instance runs
 * no timers — so postgres.js's idle timeout never fired, and every instance
 * kept its connections open from the pooler's side for as long as it lived.
 * Enough instances used up the project's 200 pooled connections and every
 * query failed (`EMAXCONN`), which is what took sign-in down on the live shop.
 *
 * So each request asks Vercel, through `waitUntil`, to keep the instance
 * awake until a little after the idle timeout has passed since it closed.
 * A busy instance keeps its connections warm; a quiet one hands them back
 * before it sleeps. Vercel's own `attachDatabasePool` does the same for the
 * pools it knows, and postgres.js is not one of them. Off Vercel `waitUntil`
 * does nothing, and a long-lived process closes idle connections by itself.
 */
export function holdUntilConnectionsIdle(response: { once(event: "close", listener: () => void): unknown }): void {
  if (!process.env.VERCEL) return;
  waitUntil(
    new Promise<void>(resolve => {
      response.once("close", () => setTimeout(resolve, DB_IDLE_SECONDS * 1000 + 500));
    }),
  );
}
