/**
 * What the account has waiting: unread replies, and parcels on the road.
 *
 * Read in one place so the header's account menu and the phone's bottom bar
 * show the same numbers — a dot on one and not the other is the drift two
 * copies of a query always end in. Every figure is the server's own count:
 * unread replies from sellers (`chat.unread`, messages) and from NetLet
 * (`support.unread`, conversations), unread notices in the inbox
 * (`notifications.unread`), and orders with a line shipped and not yet
 * delivered (`orders.onTheWay`).
 *
 * Asked again each minute while the tab is visible — React Query stops the
 * interval in a background tab — which is often enough for a reply to show up
 * while somebody is still shopping and rare enough not to matter. Signed out
 * it answers zero outright rather than trusting the cache, which still holds
 * the last account's figures after signing out.
 */
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";

export type AccountSignals = {
  unreadSupport: number;
  unreadNotices: number;
  onTheWay: number;
  /** The most recent order with a parcel on the road, by reference. */
  latestOnTheWay: string | null;
};

const NONE: AccountSignals = { unreadSupport: 0, unreadNotices: 0, onTheWay: 0, latestOnTheWay: null };

export function useAccountSignals(): AccountSignals {
  const { isAuthenticated } = useAuth();
  const options = { enabled: isAuthenticated, staleTime: 60_000, refetchInterval: 60_000, retry: false } as const;
  const support = trpc.support.unread.useQuery(undefined, options);
  const notices = trpc.notifications.unread.useQuery(undefined, options);
  const road = trpc.orders.onTheWay.useQuery(undefined, options);
  if (!isAuthenticated) return NONE;
  return {
    unreadSupport: support.data ?? 0,
    unreadNotices: notices.data ?? 0,
    onTheWay: road.data?.count ?? 0,
    latestOnTheWay: road.data?.latest ?? null,
  };
}
