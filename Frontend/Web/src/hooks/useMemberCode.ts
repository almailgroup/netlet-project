/**
 * The code a member of the affiliate programme shares on a product's address
 * (3.7), or null for anybody whose links would earn nothing — signed out, not
 * joined, suspended, or the programme off. A product link from a non-member
 * is just a link, so their Share carries no code.
 */
import { useAuth } from "@/hooks/useAuth";
import { useFeature } from "@/hooks/useFeature";
import { trpc } from "@/lib/trpc";

export function useMemberCode(): string | null {
  const { isAuthenticated } = useAuth();
  const on = useFeature("affiliates");
  const member = trpc.affiliates.code.useQuery(undefined, { enabled: isAuthenticated && on, staleTime: 5 * 60_000, retry: false });
  return isAuthenticated && on ? member.data?.code ?? null : null;
}
