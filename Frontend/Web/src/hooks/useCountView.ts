import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { countsViews, markCounted, viewChannel, viewSource } from "@/lib/productViews";

/**
 * Counts one opening of a product's page for its store (migration 0084): once
 * per product the page shows, with the channel, where it was opened from, and
 * whether this device has counted it today. A count that fails is nobody's
 * business but the server log's, so nothing here says anything.
 */
export function useCountView(productId: string | undefined): void {
  const record = trpc.commerce.recordView.useMutation();
  const send = useRef(record.mutate);
  send.current = record.mutate;
  const counted = useRef<string | null>(null);

  useEffect(() => {
    if (!productId || counted.current === productId) return;
    counted.current = productId;
    /* Read now, as the page appears, so a hint left by the press is spent here. */
    const source = viewSource();
    if (!countsViews() || !/^\d{1,9}$/.test(productId)) return;
    send.current(
      { productId: Number(productId), channel: viewChannel(), source, firstToday: markCounted(productId) },
      { onError: () => undefined },
    );
  }, [productId]);
}
