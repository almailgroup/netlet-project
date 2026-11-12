/**
 * Saved items.
 *
 * The heart on every product card wrote to a list nothing could read: the
 * header and the mobile tab both answered with a toast counting the items,
 * and there was no page to send anyone to. A save button that cannot be
 * reviewed is a promise the storefront does not keep, so this is that page.
 *
 * Saves live in the customer context — localStorage for a guest, the account
 * once signed in — so the list survives a reload either way.
 *
 * **Each saved product can be moved, on the owner's word**: to the cart (its
 * plain line, out of Saved) or to a wishlist (the heart's second question,
 * out of Saved once it is on a list) — the cart's own saved card
 * (`SavedCard`), drawn as a grid.
 *
 * **Several can be moved at once, on the owner's word** ("a multiple
 * selection option for the pages that need it"): a circle on each photo, All
 * above the grid, and Move to cart and Remove counting what is chosen — the
 * cart's circles (`ChoiceCircle`). Only what can go in the bag goes (one
 * option, in stock); the rest stays chosen and is said. Removing several has
 * Undo, the way the bag's Save for later has.
 *
 * **It is Saved items and wishlists, on the owner's word** ("make it Saved
 * items and wishlists, so both will be in one"): two tabs over one page
 * (`TextTabs`, My orders' row), Saved items first — the header's heart opens
 * it there — and Wishlists in the address (`?tab=wishlists`, replaced rather
 * than pushed), which is the account's own wishlist manager. The account's
 * Wishlists row went with it, and `/account/wishlists` opens this tab. A guest
 * has no lists, so their tab offers the sign-in and the finder for somebody
 * else's list, which needs no account.
 */
import { toastHeart } from "@/lib/heartToast";
import { useProductsByIds } from "@/hooks/useCatalog";
import { QuickView } from "@/components/product/QuickView";
import { SavedCard, useSavedMoves } from "@/components/cart/SavedForLater";
import { RecommendedRail } from "@/components/product/RecommendedRail";
import { BUTTON_PRIMARY, EmptyState, PageBody, PageHeading } from "@/components/layout/Page";
import { useCustomer } from "@/contexts/CustomerContext";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { privatePageMeta } from "@shared/seo";
import type { Product } from "@shared/commerce/types";
import { ArrowRight, Gift, Heart, ShoppingBag } from "lucide-react";
import { ChoiceCircle } from "@/components/cart/ChoiceCircle";
import { TextTabs } from "@/components/ui/TextTabs";
import { WishlistManager } from "@/components/account/WishlistManager";
import { GiftFinder } from "@/pages/GiftList";
import { CARD } from "@/components/layout/Page";
import { useAuth } from "@/hooks/useAuth";
import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import { useConfirmRemoval } from "@/components/ui/ConfirmRemoval";

const AuthDialog = lazy(() => import("@/components/auth/AuthDialog"));

type SavedTab = "saved" | "wishlists";

function SavedItems() {
  const { savedIds, saveForLater } = useCustomer();
  /* The products chosen for Move to cart or Remove. */
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const { t } = useTranslation();
  const ask = useConfirmRemoval();
  const moves = useSavedMoves();
  /* By id, so a heart on something older than the newest sixty products is
     still a card — it used to be counted as no longer available. */
  const saved = useProductsByIds(savedIds);
  const isLoading = saved.waiting;

  // Ordered by the saved list rather than by catalog order, so the most
  // recently saved item is where the shopper left it.
  const savedProducts = saved.products;

  // A saved id with no product behind it means the item left the catalog while
  // it was on the list. Counted rather than hidden: "two items are no longer
  // available" is information; silently showing fewer cards is a bug report.
  // Only once the server has answered: the shelves' copy is not the catalogue.
  const missingCount = saved.missing;

  const ids = savedProducts.map(product => product.id);
  const picked = savedProducts.filter(product => chosen.has(product.id));
  const allState = picked.length === 0 ? "none" : picked.length === ids.length ? "all" : "some";
  const choose = (id: string, next: boolean) => setChosen(previous => {
    const after = new Set(previous);
    if (next) after.add(id); else after.delete(id);
    return after;
  });
  /* What can go in the bag as it is: one option, in stock. */
  const movable = (product: Product) => product.variants.length <= 1 && product.variants.some(variant => variant.availableForSale);
  const moveChosen = () => {
    const going = picked.filter(movable);
    for (const product of going) moves.move(product);
    const stayed = picked.filter(product => !movable(product));
    setChosen(new Set(stayed.map(product => product.id)));
    toast(going.length ? `${t("saved.movedChosen")}${stayed.length ? ` ${t("saved.someStayed")}` : ""}` : t("saved.someStayed"));
  };
  const removeChosen = async () => {
    /* Asks first, on the owner's word. */
    if (!(await ask({ title: t("remove.savedChosenTitle"), body: t("remove.savedChosenBody") }))) return;
    const gone = picked.map(product => product.id);
    for (const id of gone) moves.unsave(id);
    setChosen(new Set());
    toast(t("saved.removedChosen"), { action: { label: t("cart.undo"), onClick: () => gone.forEach(saveForLater) } });
  };

  return (
    <>
        {/* A line held while the list loads, so the grid does not drop when it lands. */}
        <p className="mb-5 text-[14px] leading-6 ink-muted">
          {isLoading ? "\u00a0" : savedProducts.length === 0
            ? t("saved.emptyPrompt")
            : savedProducts.length === 1
              ? t("saved.countOne")
              : t("saved.count", { count: savedProducts.length })}
        </p>
        {missingCount > 0 && !isLoading ? (
          <p className="-mt-2 mb-6 rounded-xl border border-[#f2b69e] bg-white px-4 py-3 text-[13px] font-semibold text-[#a44a2b]">
            {missingCount === 1 ? t("saved.unavailableOne") : t("saved.unavailableCount", { count: missingCount })}
          </p>
        ) : null}

        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-[330px] animate-pulse rounded-2xl border border-[#d5dfeb] bg-white/60" />
            ))}
          </div>
        ) : savedProducts.length ? (
          <>
          {/* The cards are h3s under the page's h1: the department grid's rung. */}
          <h2 className="sr-only">{t("browse.resultsRegion")}</h2>
          <p aria-live="polite" className="sr-only">{moves.said}</p>
          {/* All, and what to do with what is chosen. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center">
              <ChoiceCircle
                state={allState}
                label={t("select.all")}
                onToggle={next => setChosen(next ? new Set(ids) : new Set())}
                className="-ms-2.5 pointer-fine:-ms-1.5"
              />
              <span aria-hidden className="text-[14px] font-bold text-[#0a285a]">{t("cart.chooseAll")}</span>
            </div>
            {picked.length ? (
              <>
                <button type="button" onClick={moveChosen} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[#0a285a] px-4 text-[13px] font-bold text-white hover:bg-[#0d3372]">
                  <ShoppingBag className="size-4" aria-hidden />{t("saved.moveChosen", { count: picked.length })}
                </button>
                <button type="button" onClick={() => void removeChosen()} className="inline-flex min-h-11 items-center rounded-full border border-[#0a285a]/25 bg-white px-4 text-[13px] font-bold text-[#0a285a] hover:bg-[#f0f2f5]">
                  {t("saved.removeChosen", { count: picked.length })}
                </button>
              </>
            ) : null}
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {savedProducts.map((product) => (
              <SavedCard
                key={product.id}
                grid
                choice={{ chosen: chosen.has(product.id), toggle: next => choose(product.id, next) }}
                product={product}
                onMove={() => moves.move(product)}
                onRemove={() => moves.unsave(product.id)}
                onWish={moves.wish ? () => moves.wish?.(product) : null}
              />
            ))}
          </ul>
          </>
        ) : (
          <EmptyState icon={<Heart className="size-6" />} title={t("saved.emptyTitle")} note={t("saved.emptyNote")}>
            <Link href="/" className={BUTTON_PRIMARY}>
              {t("saved.browse")} <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
          </EmptyState>
        )}
    </>
  );
}

export default function Saved() {
  usePageMeta(privatePageMeta("Saved items and wishlists"));
  const { t } = useTranslation();
  const { heartedIds, toggleSaved } = useCustomer();
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  const search = useSearch();
  const [, navigate] = useLocation();
  const tab: SavedTab = new URLSearchParams(search).get("tab") === "wishlists" ? "wishlists" : "saved";
  /* Replaced, not pushed: Back leaves the page rather than stepping through its tabs. */
  const choose = (next: SavedTab) => navigate(next === "wishlists" ? "/saved?tab=wishlists" : "/saved", { replace: true });

  return (
    <>
      <PageBody>
        <PageHeading title={t("saved.andWishlists")} />
        <TextTabs
          items={[
            { id: "saved" as const, label: t("footer.savedItems") },
            { id: "wishlists" as const, label: t("saved.tabWishlists") },
          ]}
          value={tab}
          onChange={choose}
          label={t("saved.tabsLabel")}
        />
        <div className="mt-5">
          {tab === "saved" ? <SavedItems /> : <Wishlists />}
        </div>
      </PageBody>
      {/* Under the hearts it learns from, and only once it has learned
          something: the rail draws nothing until it is personal. */}
      {tab === "saved" ? (
        <RecommendedRail
          saved={heartedIds}
          onSave={(id, title) => toastHeart(toggleSaved(id), title, t)}
          onQuickView={setQuickProduct}
        />
      ) : null}
      <QuickView product={quickProduct} onClose={() => setQuickProduct(null)} />
    </>
  );
}

/**
 * The account's wishlists, or for a guest — who has none — the sign-in and
 * the finder for somebody else's list, which needs no account.
 */
function Wishlists() {
  const { t } = useTranslation();
  const { isAuthenticated, loading } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  if (loading) return <div className="h-40 animate-pulse rounded-2xl border border-[#d5dfeb] bg-white/60" />;
  /* The cards inside are h3s; the tab's own heading is their h2, for a screen reader. */
  if (isAuthenticated) return <><h2 className="sr-only">{t("saved.tabWishlists")}</h2><WishlistManager /></>;
  return (
    <div className="space-y-5">
      <EmptyState icon={<Gift className="size-6" />} title={t("wish.guestTitle")} note={t("wish.guestNote")}>
        <button type="button" onClick={() => setAuthOpen(true)} className={BUTTON_PRIMARY}>
          {t("header.signIn")} <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
        </button>
      </EmptyState>
      <section aria-labelledby="find-a-list" className={`${CARD} p-4 sm:p-5`}>
        <h2 id="find-a-list" className="text-base font-extrabold text-[#0a285a]">{t("gift.heading")}</h2>
        <p className="mt-1 text-[13px] leading-5 ink-muted">{t("gift.intro")}</p>
        <div className="mt-3"><GiftFinder /></div>
      </section>
      {authOpen ? createPortal(<Suspense fallback={null}><AuthDialog open onClose={() => setAuthOpen(false)} /></Suspense>, document.body) : null}
    </div>
  );
}
