/**
 * The saved address this device used last, kept current.
 *
 * `lib/lastAddress` holds it in browser storage, which nothing re-renders on;
 * this reads it through `useSyncExternalStore` so the header's delivery button
 * names a newly picked address the moment it is picked.
 */
import { useSyncExternalStore } from "react";
import { onLastAddressChange, readLastAddressId } from "@/lib/lastAddress";

export function useLastAddressId(): number | null {
  return useSyncExternalStore(onLastAddressChange, readLastAddressId, () => null);
}
