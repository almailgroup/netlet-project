/**
 * "Tell me when it changes."
 *
 * Two requests, one control: a price-drop alert on anything, and a
 * back-in-stock alert on what is sold out. They are the same promise from the
 * shopper's side — *let me know* — so making them two unrelated features would
 * be an implementation detail leaking into the page.
 *
 * The waiting count is shown on a sold-out product because it is honest
 * information for the shopper ("this is in demand, it will go again") and it is
 * the demand signal the vendor needs. It is a count; who is waiting is nobody's
 * business.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/lib/useTranslation";
import type { Product } from "@shared/commerce/types";
import { BellRing, Check, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

export function FollowProduct({ product, compact = false }: { product: Product; compact?: boolean }) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const inStock = product.variants.some(variant => variant.availableForSale);
  const follows = trpc.customer.follows.list.useQuery(undefined, { enabled: isAuthenticated });
  const demand = trpc.customer.follows.demand.useQuery({ productId: product.id }, { enabled: !inStock });

  const follow = trpc.customer.follows.set.useMutation({
    onSuccess: () => {
      void utils.customer.follows.list.invalidate();
      void utils.customer.follows.demand.invalidate({ productId: product.id });
    },
    onError: () => toast.error(t("follow.failed")),
  });

  const existing = follows.data?.find(entry => entry.productId === product.id);
  // Out of stock, the meaningful alert is "it is back"; in stock it is "it got
  // cheaper". One button, and which promise it makes depends on the product.
  const active = Boolean(inStock ? existing?.priceDrop : existing?.backInStock);

  const toggle = () => {
    if (!isAuthenticated) return toast(t("follow.signInFirst"));
    follow.mutate({
      productId: product.id,
      ...(inStock ? { priceDrop: !active } : { backInStock: !active }),
    });
    toast(t(active ? "follow.off" : "follow.on", { name: product.title }));
  };

  const label = active
    ? t("follow.watching")
    : t(inStock ? "follow.priceDrop" : "follow.backInStock");

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
      {!inStock && (demand.data ?? 0) > 0 ? (
        <p className="mt-2 text-center text-[11px] font-semibold ink-muted">
          {demand.data === 1 ? t("follow.waitingOne") : t("follow.waiting", { count: demand.data ?? 0 })}
        </p>
      ) : null}
    </div>
  );
}
