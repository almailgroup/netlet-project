/**
 * Whether the signed-in shopper is a NetLet member (4.1).
 *
 * Asked only when somebody is signed in — an anonymous browser has no account
 * and so no membership — and answered "not a member" while loading, so a
 * member price never flashes at somebody it turns out not to apply to.
 */
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";

export function useMembership() {
  const { user } = useAuth();
  const mine = trpc.membership.mine.useQuery(undefined, { enabled: Boolean(user), staleTime: 60_000 });
  return { member: Boolean(user && mine.data?.member), until: mine.data?.until ?? null, freeDeliveryOver: mine.data?.freeDeliveryOver ?? null };
}
