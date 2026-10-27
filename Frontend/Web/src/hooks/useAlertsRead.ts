import { useEffect } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Opening a desk reads the fraud alerts that sent somebody to it (3.6.5): high-
 * risk orders on the orders page, reviews and referrals on the fraud page. So
 * the overview's tiles count what nobody has looked at yet rather than a
 * window that never reaches zero. Once per visit, and only for somebody the
 * server would tell (`enabled`).
 */
export function useAlertsRead(desk: "orders" | "watch", enabled = true) {
  const utils = trpc.useUtils();
  const { mutate } = trpc.orders.fraudSeen.useMutation({ onSuccess: () => utils.orders.fraudUnseen.invalidate() });
  useEffect(() => {
    if (enabled) mutate({ desk });
  }, [desk, enabled, mutate]);
}
