/**
 * Frequently bought — `/account/frequent`, on the owner's word ("a dedicated
 * Frequently Bought section, completely separate from Wishlist and Saved
 * Items"). What the shopper buys again and again, each at the size or option
 * they buy and the amount they usually take (`frequent.list`).
 *
 * **It reorders by filling the bag, never by ordering.** Each row's Add to
 * cart puts its usual amount in the bag through the bag's own door
 * (`addItem`), and "Add all to cart" does that for every item that can go in;
 * the shopper still checks out themselves, and the page says so in its first
 * line. The usual amount is changed where it is drawn and kept on the account
 * (`frequent.setQuantity`), so next week's press puts in the same.
 *
 * One press never asks for more than there is: `frequentAddable` holds the
 * usual amount to what is left of the variant less what the bag already has
 * of it, and a row with no room says so rather than sending a press the bag
 * would refuse. A sold-out item says so; one whose product has left the shop
 * stays, marked, with a way to take it off — a list that loses things on its
 * own is one nobody trusts.
 *
 * Setting it up never means going back through orders: "From your past
 * orders" (`frequent.suggestions`) offers what the shopper has bought before
 * and not put on, most often bought first, each added at the amount they took
 * the last time. Products also go on from their own page (`FrequentButton`).
 */
import { useEffect, useRef, useState, type SetStateAction } from "react";
import { Link } from "wouter";
import { Check, ListRestart, PackageSearch, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { QueryGate } from "@/components/admin/QueryGate";
import { PANEL } from "@/components/account/profileParts";
import { QuantityStepper } from "@/components/cart/QuantityStepper";
import { Thumb } from "@/components/product/Thumb";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { BUTTON_PRIMARY, EmptyState } from "@/components/layout/Page";
import { useCart } from "@/contexts/CartContext";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { pressHaptic } from "@/lib/haptics";
import { trpc } from "@/lib/trpc";
import { isMessageKey } from "@shared/i18n/dictionary";
import { isDefaultVariantTitle } from "@shared/commerce/fromInventory";
import { frequentAddable, frequentState } from "@shared/commerce/frequentItems";
import type { Product } from "@shared/commerce/types";

type Item = {
  id: number;
  productId: string;
  variantId: string;
  quantity: number;
  product: Product | null;
};

/** The pill a row's Add to cart wears: navy, and green with a tick for a moment once it has worked. */
const ADD = "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-bold transition-colors";

export function AccountFrequent() {
  const { t, locale } = useTranslation();
  const list = trpc.frequent.list.useQuery({ locale }, { staleTime: 30_000 });
  const suggestions = trpc.frequent.suggestions.useQuery({ locale }, { staleTime: 60_000 });
  const { addItem, cart } = useCart();
  const [status, setStatus] = useState("");
  const [addingAll, setAddingAll] = useState(false);

  const inBag = (variantId: string) =>
    (cart?.items ?? []).filter(line => line.variantId === variantId).reduce((total, line) => total + line.quantity, 0);

  /** How many of an item one press puts in the bag now — zero when it cannot go in. */
  const addable = (item: Item) => {
    if (frequentState(item.product, item.variantId) !== "ready") return 0;
    const variant = item.product!.variants.find(candidate => candidate.id === item.variantId)!;
    return frequentAddable(item.quantity, variant.maxQuantity, inBag(item.variantId));
  };

  const addAll = async (items: Item[]) => {
    const ready = items.filter(item => addable(item) > 0);
    if (!ready.length) return;
    pressHaptic();
    setAddingAll(true);
    try {
      for (const item of ready) {
        await addItem(item.variantId, addable(item), { reveal: false, product: item.product ?? undefined });
      }
      const skipped = items.some(item => frequentState(item.product, item.variantId) !== "ready");
      setStatus(`${t("frequent.allAdded")}${skipped ? ` ${t("frequent.someSkipped")}` : ""}`);
    } catch (error) {
      toast.error(error instanceof Error && isMessageKey(error.message) ? t(error.message) : t("cart.updateFailed"));
    } finally {
      setAddingAll(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[14px] leading-6 ink-muted">{t("frequent.intro")}</p>
      <QueryGate audience="shopper" queries={[list]}>
        {() => {
          const data = list.data!;
          if (!data.ready) {
            return <p className={`${PANEL} p-5 text-[14px] text-[#1f2a44]`}>{t("frequent.unavailable")}</p>;
          }
          const items = data.items as Item[];
          const anyAddable = items.some(item => addable(item) > 0);
          return (
            <div className="space-y-3">
              {items.length ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => void addAll(items)}
                      disabled={!anyAddable || addingAll}
                      className={`${BUTTON_PRIMARY} disabled:opacity-50`}
                    >
                      <ShoppingBag className="size-4" aria-hidden />
                      {t("frequent.addAll")}
                    </button>
                    {status ? (
                      <Link href="/cart" className="text-[14px] font-semibold text-[#0a285a] underline underline-offset-2">{t("product.viewCart")}</Link>
                    ) : null}
                  </div>
                  <ul className={`${PANEL} divide-y divide-dashed divide-[#e3e6ec] px-4 sm:px-5`}>
                    {items.map(item => (
                      <FrequentRow key={item.id} item={item} inBag={inBag(item.variantId)} onAdded={setStatus} />
                    ))}
                  </ul>
                </>
              ) : (
                <EmptyState heading="h3" icon={<ListRestart className="size-6" />} title={t("frequent.emptyTitle")} note={t("frequent.emptyNote")} />
              )}
              <p role="status" aria-live="polite" className={status ? "text-[14px] text-[#2f5d33]" : "sr-only"}>{status}</p>
              <Suggestions entries={suggestions.data ?? []} />
            </div>
          );
        }}
      </QueryGate>
    </div>
  );
}

/** One item: its photo and name, the usual amount, Add to cart and the bin. */
function FrequentRow({ item, inBag, onAdded }: { item: Item; inBag: number; onAdded: (status: string) => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  const utils = trpc.useUtils();
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(item.quantity);
  const [added, setAdded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (addedTimer.current) clearTimeout(addedTimer.current);
  }, []);

  const setQuantityOnServer = trpc.frequent.setQuantity.useMutation({
    onSuccess: () => void utils.frequent.list.invalidate(),
    onError: error => toast.error(isMessageKey(error.message) ? t(error.message) : t("account.preferenceFailed")),
  });
  const remove = trpc.frequent.remove.useMutation({
    onSuccess: () => {
      setConfirming(false);
      toast.success(t("frequent.removed"));
      void utils.frequent.list.invalidate();
      void utils.frequent.suggestions.invalidate();
      void utils.frequent.forProduct.invalidate();
    },
    onError: error => toast.error(isMessageKey(error.message) ? t(error.message) : t("account.preferenceFailed")),
  });

  /* The usual amount is the account's: kept once the presses stop, so five quick presses are one write. */
  const changeQuantity = (next: SetStateAction<number>) => {
    setQuantity(current => {
      const value = typeof next === "function" ? next(current) : next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setQuantityOnServer.mutate({ id: item.id, quantity: value }), 500);
      return value;
    });
  };

  const product = item.product;
  const variant = product?.variants.find(candidate => candidate.id === item.variantId) ?? null;
  const state = frequentState(product, item.variantId);
  const title = product?.title ?? t("frequent.gone");
  /* What one press adds follows the amount on screen, not the one last saved. */
  const addable = state === "ready" && variant ? frequentAddable(quantity, variant.maxQuantity, inBag) : 0;

  const add = async () => {
    if (!variant || addable <= 0) return;
    pressHaptic();
    try {
      await addItem(variant.id, addable, { reveal: false, product: product ?? undefined });
      setAdded(true);
      onAdded(t("frequent.allAdded"));
      if (addedTimer.current) clearTimeout(addedTimer.current);
      addedTimer.current = setTimeout(() => setAdded(false), 1800);
    } catch (error) {
      toast.error(error instanceof Error && isMessageKey(error.message) ? t(error.message) : t("cart.updateFailed"));
    }
  };

  return (
    <li className="py-4">
      <div className="flex gap-3">
        {product ? (
          <Link href={`/products/${product.handle}`} tabIndex={-1} aria-hidden className="shrink-0">
            <Thumb
              src={product.images[0]?.url ?? null}
              alt={product.images[0]?.altText ?? product.title}
              className="size-[72px] rounded-xl border border-[#e6e9ef] bg-[#f4f6f9] object-contain"
              icon={<PackageSearch className="size-5" />}
            />
          </Link>
        ) : (
          <span aria-hidden className="grid size-[72px] shrink-0 place-items-center rounded-xl border border-[#e6e9ef] bg-[#f4f6f9] text-[#5d6b82]">
            <PackageSearch className="size-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {product ? (
            <Link href={`/products/${product.handle}`} dir="auto" className="line-clamp-2 text-[15px] font-bold leading-snug text-[#0a285a] hover:underline">
              {product.title}
            </Link>
          ) : (
            <p className="text-[15px] font-bold leading-snug text-[#5d6b82]">{t("frequent.gone")}</p>
          )}
          <p className="mt-0.5 text-[13px] ink-muted">
            {variant && !isDefaultVariantTitle(variant.title) ? <><bdi>{variant.title}</bdi> · </> : null}
            {variant ? money(variant.price) : null}
          </p>
          {state === "soldOut" ? <p className="mt-1 text-[13px] font-semibold text-[#8c2f22]">{t("product.soldOut")}</p> : null}
          {state === "ready" && addable === 0 ? <p className="mt-1 text-[13px] ink-muted">{t("frequent.noRoom")}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={t("frequent.remove")}
          title={t("frequent.remove")}
          className="grid size-11 shrink-0 place-items-center rounded-full text-[#5d6b82] hover:bg-[#fdf5f3] hover:text-[#c2362a]"
        >
          <Trash2 className="size-[18px]" aria-hidden />
        </button>
      </div>
      {state !== "gone" ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-[13px] font-semibold text-[#1f2a44]" aria-hidden>{t("frequent.usual")}</span>
            <div role="group" aria-label={t("frequent.usualOf", { title })}>
              <QuantityStepper value={quantity} onChange={changeQuantity} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void add()}
            disabled={state !== "ready" || addable === 0}
            aria-label={t("frequent.addToCartOf", { title })}
            className={`${ADD} ${added ? "bg-[#2f5d33] text-white" : "bg-[#0a285a] text-white hover:bg-[#0d3372]"} disabled:cursor-not-allowed disabled:opacity-45`}
          >
            {added ? <Check className="size-4" aria-hidden /> : <ShoppingBag className="size-4" aria-hidden />}
            {added ? t("frequent.added") : t("product.addToCart")}
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={t("frequent.removeTitle", { title })}
        body={t("frequent.removeBody")}
        confirmLabel={t("frequent.removeConfirm")}
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ id: item.id })}
        onClose={() => setConfirming(false)}
      />
    </li>
  );
}

type Suggestion = {
  productId: string;
  variantId: string;
  timesBought: number;
  lastQuantity: number;
  product: Product;
};

/** What the shopper has bought before and not put on the list — each one press away from it. */
function Suggestions({ entries }: { entries: Suggestion[] }) {
  const { t } = useTranslation();
  const money = useMoney();
  const utils = trpc.useUtils();
  const add = trpc.frequent.add.useMutation({
    onSuccess: () => {
      toast.success(t("frequent.addedToList"));
      void utils.frequent.list.invalidate();
      void utils.frequent.suggestions.invalidate();
      void utils.frequent.forProduct.invalidate();
    },
    onError: error => toast.error(isMessageKey(error.message) ? t(error.message) : t("account.preferenceFailed")),
  });
  if (!entries.length) return null;
  return (
    <section aria-labelledby="frequent-suggest" className="space-y-2 pt-2">
      <h3 id="frequent-suggest" className="text-[17px] font-extrabold text-[#0a285a]">{t("frequent.suggestTitle")}</h3>
      <p className="text-[13px] ink-muted">{t("frequent.suggestNote")}</p>
      <ul className={`${PANEL} divide-y divide-dashed divide-[#e3e6ec] px-4 sm:px-5`}>
        {entries.map(entry => {
          const variant = entry.product.variants.find(candidate => candidate.id === entry.variantId);
          const pending = add.isPending && add.variables?.variantId === Number(entry.variantId);
          return (
            <li key={`${entry.productId}:${entry.variantId}`} className="flex items-center gap-3 py-3.5">
              <Link href={`/products/${entry.product.handle}`} tabIndex={-1} aria-hidden className="shrink-0">
                <Thumb
                  src={entry.product.images[0]?.url ?? null}
                  alt={entry.product.images[0]?.altText ?? entry.product.title}
                  className="size-14 rounded-xl border border-[#e6e9ef] bg-[#f4f6f9] object-contain"
                  icon={<PackageSearch className="size-5" />}
                />
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={`/products/${entry.product.handle}`} dir="auto" className="line-clamp-2 text-[14px] font-bold leading-snug text-[#0a285a] hover:underline">
                  {entry.product.title}
                </Link>
                <p className="mt-0.5 text-[12px] ink-muted">
                  {variant && !isDefaultVariantTitle(variant.title) ? <><bdi>{variant.title}</bdi> · </> : null}
                  {variant ? <>{money(variant.price)} · </> : null}
                  {t("frequent.boughtTimes", { count: entry.timesBought })}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  pressHaptic();
                  add.mutate({ productId: Number(entry.productId), variantId: Number(entry.variantId), quantity: entry.lastQuantity });
                }}
                aria-label={t("frequent.addOf", { title: entry.product.title })}
                className="inline-flex h-10 shrink-0 items-center gap-1 rounded-full border border-[#0a285a]/25 bg-white px-4 text-[14px] font-bold text-[#0a285a] hover:bg-[#f0f2f5] disabled:opacity-50"
              >
                {t("frequent.add")}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
