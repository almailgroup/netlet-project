/**
 * The rail that is about this shopper.
 *
 * Three things here are deliberate, and all three are the same idea: the rail
 * says exactly what it is and never more.
 *
 * **It only draws when it is "for you".** The server sends `personalised`,
 * and with too little to go on the rail is absent. It used to fall back to
 * "Popular right now" on the home page, where it was the fourth shelf of the
 * same dozen products in a different order; it lives on `/saved` now, under
 * the hearts it learns from, and a generic list there would be a fifth. A rail
 * headed "Picked for you" over a generic list is a claim a shopper checks once
 * and never trusts again — the same reason there are no invented seller
 * counts on the sign-in wall.
 *
 * **It shows what it thinks it knows.** The interest terms are printed under
 * the heading, in the shopper's own language. A shop that profiles somebody
 * and will not say what it decided is asking for trust it has not offered any
 * way to check, and "because you have been looking at lighting, home" is
 * something a person can disagree with.
 *
 * **It says when a model was involved**, and only when one actually was.
 * `refinedByModel` is false on every fallback — no key, a timeout, a refusal —
 * so the badge cannot appear over a plain sort.
 *
 * **On the home page it is a shelf, and held to a shelf's floor.** Below
 * `MIN_SHELF_PRODUCTS` it is not drawn there — two cards in a row built for
 * four read as a broken shelf, the reason the strips above it have the floor.
 * On `/saved` it is drawn from one, where it sits under the hearts it learns
 * from and is the page's own answer rather than one shelf among several.
 *
 * Three states, never two: `QueryGate` is the same gate the portal uses, so a
 * failed query says so instead of rendering as an empty shelf.
 *
 * **It is asked when the page appears, never while somebody is on it**, on
 * the owner's word ("make sure the products stay in their place when adding
 * them to the cart"). It was asked with the bag drawn, and a shopper's first
 * add is what gives a bag its id, so the rail turned personal and appeared
 * above the brands, the stores and New arrivals, pushing the card just
 * pressed down the page; and the server leaves out what is in the bag, so a
 * product added from the rail vanished from it. It asks with the bag this
 * device held when the page appeared (`cartId`, known before the bag is
 * read), and not again on the window coming back into focus; the next page
 * that draws it asks afresh. The app's rail does the same.
 */
import { ProductCard } from "@/components/product/ProductCard";
import { QueryGate } from "@/components/admin/QueryGate";
import { useCart } from "@/contexts/CartContext";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { useState } from "react";
import type { Product } from "@shared/commerce/types";
import type { TasteReason } from "@shared/commerce/taste";
import { Sparkles } from "lucide-react";
import { MIN_SHELF_PRODUCTS } from "@/content/homeLayout";

export function RecommendedRail({ saved, onSave, onQuickView, quiet = false }: {
  saved: string[];
  onSave: (id: string, title: string) => void;
  onQuickView: (product: Product) => void;
  /** Draw nothing while it loads or if it fails: on the home page it is one
      shelf among several, and a loading line or an error there is noise. */
  quiet?: boolean;
}) {
  const { t, locale, isArabic } = useTranslation();
  const { cartId } = useCart();
  /* The bag as it was when the page appeared, kept for as long as it is open. */
  const [askedWith] = useState(cartId);

  /*
   * The bag goes in the request because a signed-out shopper's cart is the
   * strongest signal they have given us, and the server has no other way to
   * know which one is theirs. The account, when there is one, is read from the
   * session — it is deliberately not something a caller can name.
   */
  const query = trpc.recommendations.forMe.useQuery(
    { cartId: askedWith, limit: 8, locale },
    { refetchOnWindowFocus: false, refetchOnReconnect: false },
  );

  if (quiet && !query.data) return null;
  return (
    <QueryGate queries={[query]}>
      {() => {
        const data = query.data;
        if (!data || !data.personalised || data.items.length === 0) return null;
        if (quiet && data.items.length < MIN_SHELF_PRODUCTS) return null;

        return (
          <section id="for-you" className="container py-9 sm:py-12">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-xl font-extrabold text-[#0a285a] sm:text-2xl">
                  {t("taste.railPersonal")}
                </h2>
                <p dir="auto" className="mt-1 max-w-prose text-xs leading-5 ink-muted">
                  {t("taste.railNotePersonal", { terms: data.terms.slice(0, 4).join(isArabic ? "، " : ", ") })}
                </p>
              </div>
              {/* Only when a model actually ran. Every fallback sends false. */}
              {data.refinedByModel ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#e6e9ef] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#0a285a]">
                  <Sparkles className="size-3 ink-accent" aria-hidden />
                  {t("taste.refined")}
                </span>
              ) : null}
            </div>

            <div className="hide-scrollbar flex gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-4 lg:overflow-visible">
              {data.items.slice(0, 4).map(item => (
                <div key={item.product.id} className="min-w-[172px] sm:min-w-[195px] lg:min-w-0">
                  <ProductCard
                    compact
                    product={item.product}
                    note={<ReasonNote reasons={item.reasons} />}
                    saved={saved.includes(item.product.id)}
                    onSave={() => onSave(item.product.id, item.product.title)}
                    onQuickView={() => onQuickView(item.product)}
                  />
                </div>
              ))}
            </div>
          </section>
        );
      }}
    </QueryGate>
  );
}

/**
 * Why this one, in one line.
 *
 * The first reason only. Two on a 172px card is a paragraph where a label
 * belongs, and the first is the most specific by construction — `rankByTaste`
 * orders them that way.
 */
function ReasonNote({ reasons }: { reasons: TasteReason[] }) {
  const { t } = useTranslation();
  const reason = reasons[0];
  if (!reason) return null;

  return (
    <span dir="auto" className="type-label block truncate ink-accent">
      {reason.key === "taste.becausePrice" ? t(reason.key) : t(reason.key, { value: reason.value })}
    </span>
  );
}
