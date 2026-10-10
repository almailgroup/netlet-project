/**
 * Whether a feature is switched on (2.3), for hiding its entry points.
 *
 * A courtesy and never the control: the server refuses a switched-off entry on
 * its own. So the answer while the switches are still loading — or if they
 * cannot be read at all — is the feature's **default**, which is what a shop
 * nobody has configured means: on for almost everything, so an optional
 * control is not hidden from everybody for the length of a request, and off
 * for the few that start off, so they do not flash in and vanish.
 */
import { trpc } from "@/lib/trpc";
import { FEATURES, type FeatureKey } from "@shared/features";

export function useFeature(key: FeatureKey): boolean {
  const states = trpc.features.states.useQuery(undefined, { staleTime: 60_000 });
  return states.data?.[key] ?? FEATURES[key].defaultOn;
}
