/**
 * "Tell me if the price drops", under an in-stock product's buy buttons.
 *
 * A sold-out product draws nothing here: its page, its card and the preview
 * carry "Remind me when back in stock" in the buy buttons' place
 * (`StockReminder`), which is the same follow row's other flag. The two were
 * one button once, whose promise changed with the stock, and a sold-out
 * product's reminder sat small under two greyed buttons where nobody looked.
 */
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import type { Product } from "@shared/commerce/types";
import { BellRing, Check, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

export function FollowProduct({ product, compact = false }: { product: Product; compact?: boolean }) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const inStock = product.variants.some(variant => variant.availableForSale);
  const follows = trpc.customer.follows.list.useQuery(undefined, { enabled: isAuthenticated && inStock, staleTime: 30_000 });

  const follow = trpc.customer.follows.set.useMutation({
    onSuccess: () => {
      void utils.customer.follows.list.invalidate();
      void utils.customer.follows.demand.invalidate({ productId: product.id });
    },
    onError: () => toast.error(t("follow.failed")),
  });

  const active = Boolean(follows.data?.find(entry => entry.productId === product.id)?.priceDrop);
  if (!inStock) return null;

  const toggle = () => {
    if (!isAuthenticated) return toast(t("follow.signInFirst"));
    follow.mutate({ productId: product.id, priceDrop: !active });
    toast(t(active ? "follow.off" : "follow.on", { name: product.title }));
  };

  const label = active ? t("follow.watching") : t("follow.priceDrop");

  return (
    <div className={compact ? "" : "rounded-xl border border-[#d5dfeb] bg-white p-3"}>
      <button
        onClick={toggle}
        disabled={follow.isPending}
        aria-pressed={active}
        className={`pressable inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl px-4 text-xs font-extrabold disabled:opacity-60 ${active ? "glass glass-navy" : "glass border border-[#0a285a]/15 text-[#0a285a]"}`}
      >
        {follow.isPending ? <LoaderCircle className="size-4 animate-spin" /> : active ? <Check className="size-4" /> : <BellRing className="size-4" />}
        {label}
      </button>
    </div>
  );
}
