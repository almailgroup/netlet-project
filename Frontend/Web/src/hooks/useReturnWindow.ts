/**
 * How many days after delivery a return may be asked for — the figure an
 * administrator sets on `/admin/features` (`returns.windowDays`), read from
 * `commerce.policy`.
 *
 * The code's fourteen stands in while it loads, which is also what the server
 * answers until somebody changes it, so on nearly every visit nothing moves.
 * Held for ten minutes: it changes when an administrator decides, not while
 * somebody reads.
 */
import { trpc } from "@/lib/trpc";
import { RETURN_WINDOW_DAYS } from "@shared/commerce/returns";

export function useReturnWindow(): number {
  const policy = trpc.commerce.policy.useQuery(undefined, { staleTime: 10 * 60 * 1000, refetchOnWindowFocus: false });
  return policy.data?.returnWindowDays ?? RETURN_WINDOW_DAYS;
}
