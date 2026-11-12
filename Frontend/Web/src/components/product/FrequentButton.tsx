/**
 * "Add to Frequently bought", under a product's buy buttons — the product
 * page's door onto the shopper's Frequently bought list (migration 0073, on
 * the owner's word; the list is `/account/frequent`).
 *
 * It keeps the option chosen on the page and the amount in its stepper, which
 * is what a regular purchase is: this size, this many. Pressed again it takes
 * that option off, and while it is on the list a link opens the list. A guest
 * is asked to sign in over the page, since the list is the account's. Drawn
 * like `FollowProduct` beside it, because both are "about this product, for
 * later" rather than buying it now.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Check, ListRestart, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import AuthDialog from "@/components/auth/AuthDialog";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { pressHaptic } from "@/lib/haptics";
import { trpc } from "@/lib/trpc";
import { isMessageKey } from "@shared/i18n/dictionary";
import type { Product, ProductVariant } from "@shared/commerce/types";
import { useConfirmRemoval } from "@/components/ui/ConfirmRemoval";
import { isolate } from "@/lib/isolate";

export function FrequentButton({ product, variant, quantity }: { product: Product; variant: ProductVariant | undefined; quantity: number }) {
  const { t } = useTranslation();
  const ask = useConfirmRemoval();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const [authOpen, setAuthOpen] = useState(false);
  /* A product the demo names by handle has no row to keep. */
  const productId = /^\d+$/.test(product.id) ? Number(product.id) : null;
  const state = trpc.frequent.forProduct.useQuery(
    { productId: productId ?? 0 },
    { enabled: isAuthenticated && productId !== null, staleTime: 60_000 },
  );
  const refresh = () => {
    void utils.frequent.forProduct.invalidate({ productId: productId ?? 0 });
    void utils.frequent.list.invalidate();
    void utils.frequent.suggestions.invalidate();
  };
  const failed = (error: { message: string }) => toast.error(isMessageKey(error.message) ? t(error.message) : t("account.preferenceFailed"));
  const add = trpc.frequent.add.useMutation({ onSuccess: () => { toast.success(t("frequent.addedToList")); refresh(); }, onError: failed });
  const remove = trpc.frequent.remove.useMutation({ onSuccess: () => { toast(t("frequent.removed")); refresh(); }, onError: failed });

  if (productId === null || !variant || !/^\d+$/.test(variant.id)) return null;
  /* Before migration 0073 is pasted there is nowhere to keep it: no button that can only apologise. */
  if (state.data && !state.data.ready) return null;
  const entry = state.data?.entries.find(candidate => candidate.variantId === variant.id) ?? null;
  const pending = add.isPending || remove.isPending;

  const press = () => {
    pressHaptic();
    if (!isAuthenticated) return setAuthOpen(true);
    /* Taking it off the list asks first, on the owner's word. */
    if (entry) void ask({ title: t("frequent.removeTitle", { title: isolate(product.title) }), body: t("frequent.removeBody"), confirmLabel: t("frequent.removeConfirm") }).then(sure => { if (sure) remove.mutate({ id: entry.id }); });
    else add.mutate({ productId, variantId: Number(variant.id), quantity: Math.max(1, quantity) });
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={press}
        disabled={pending}
        aria-pressed={Boolean(entry)}
        className={`pressable inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl px-4 text-xs font-extrabold disabled:opacity-60 ${entry ? "glass glass-navy" : "glass border border-[#0a285a]/15 text-[#0a285a]"}`}
      >
        {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : entry ? <Check className="size-4" aria-hidden /> : <ListRestart className="size-4" aria-hidden />}
        {entry ? t("frequent.productOn") : t("frequent.productAdd")}
      </button>
      {entry ? (
        <p className="mt-1.5 text-center text-[12px]">
          <Link href="/account/frequent" className="font-semibold text-[#0a285a] underline underline-offset-2">{t("frequent.productOpen")}</Link>
        </p>
      ) : (
        <p className="mt-1.5 text-center text-[12px] ink-muted">{t("frequent.productNote")}</p>
      )}
      {authOpen ? <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} /> : null}
    </div>
  );
}
