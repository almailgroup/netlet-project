/**
 * Whether a feature is switched on (2.3), for hiding its entry points.
 *
 * A courtesy and never the control: the server refuses a switched-off entry on
 * its own. So the answer while the switches are still loading — or if they
 * cannot be read at all — is **on**, which is what a shop nobody has
 * configured means. Hiding every optional control from everybody for the
 * length of a request, to spare the rare shop that turned one off a moment of
 * seeing it, is the wrong way round.
 */
import { trpc } from "@/lib/trpc";
import type { FeatureKey } from "@shared/features";

export function useFeature(key: FeatureKey): boolean {
  const states = trpc.features.states.useQuery(undefined, { staleTime: 60_000 });
  return states.data?.[key] ?? true;
}
