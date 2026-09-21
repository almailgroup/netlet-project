/**
 * The rail that is about this shopper.
 *
 * Three things here are deliberate, and all three are the same idea: the rail
 * says exactly what it is and never more.
 *
 * **It only claims "for you" when it is.** The server sends `personalised`,
 * and with too little to go on the heading reads "Popular right now" and the
 * note says how to make it personal. A rail headed "Picked for you" over a
 * generic list is a claim a shopper checks once and never trusts again — the
 * same reason there are no invented seller counts on the sign-in wall.
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
 * Three states, never two: `QueryGate` is the same gate the portal uses, so a
 * failed query says so instead of rendering as an empty shelf.
 */
import { ProductCard } from "@/components/product/ProductCard";
import { QueryGate } from "@/components/admin/QueryGate";
import { useCart } from "@/contexts/CartContext";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import type { Product } from "@shared/commerce/types";
import type { TasteReason } from "@shared/commerce/taste";
import { Sparkles } from "lucide-react";

export function RecommendedRail({ saved, onSave, onDetails, onQuickView, onAdd, onBuyNow, isAdding }: {
  saved: string[];
  onSave: (id: string, title: string) => void;
  onDetails: (product: Product) => void;
  onQuickView: (product: Product) => void;
  onAdd: (product: Product, quantity: number) => void;
  onBuyNow: (product: Product, quantity: number) => void;
  isAdding: boolean;
}) {
  const { t, locale, isArabic } = useTranslation();
  const { cart } = useCart();

  /*
   * The bag goes in the request because a signed-out shopper's cart is the
   * strongest signal they have given us, and the server has no other way to
   * know which one is theirs. The account, when there is one, is read from the
   * session — it is deliberately not something a caller can name.
   */
  const query = trpc.recommendations.forMe.useQuery({ cartId: cart?.id ?? null, limit: 8, locale });

  return (
    <QueryGate queries={[query]}>
      {() => {
        const data = query.data;
        if (!data || data.items.length === 0) return null;

        return (
          <section id="for-you" className="container py-9 sm:py-12">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="type-label ink-accent uppercase">{t("home.netletSelection")}</p>
                <h2 className="display-face mt-1 text-3xl text-[#0a285a] sm:text-4xl">
                  {t(data.personalised ? "taste.railPersonal" : "taste.railGeneric")}
                </h2>
                <p dir="auto" className="mt-1 max-w-prose text-xs leading-5 ink-muted">
                  {data.personalised
                    ? t("taste.railNotePersonal", { terms: data.terms.slice(0, 4).join(isArabic ? "، " : ", ") })
                    : t("taste.railNoteGeneric")}
                </p>
              </div>
              {/* Only when a model actually ran. Every fallback sends false. */}
              {data.refinedByModel ? (
                <span className="glass inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-extrabold tracking-[.08em] uppercase">
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
                    onDetails={() => onDetails(item.product)}
                    onQuickView={() => onQuickView(item.product)}
                    onAdd={quantity => onAdd(item.product, quantity)}
                    onBuyNow={quantity => onBuyNow(item.product, quantity)}
                    isAdding={isAdding}
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
