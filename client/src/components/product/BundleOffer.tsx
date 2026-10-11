/**
 * "Buy it with", on a product page.
 *
 * Requirement 3.3.11. A bundle is offered where the decision is made — the
 * page for one of its members — rather than on a bundles index nobody browses:
 * somebody looking at a sofa is exactly the person who might take the lamp
 * with it.
 *
 * **Every member goes in the basket together, and the saving holds only while
 * they all stay there.** That is said on the card rather than discovered at
 * the till, because a shopper who removes one and finds the others repriced
 * has been surprised by their own shop.
 *
 * A cross-vendor set names both shops. Two parcels from two sellers is what
 * actually turns up, and a set that looks like one delivery is a complaint
 * waiting to happen.
 */
import { useCart } from "@/contexts/CartContext";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { LoaderCircle, PackagePlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function BundleOffer({ variantId }: { variantId: string | undefined }) {
  const { t } = useTranslation();
  const money = useMoney();
  const { addItem } = useCart();
  const [adding, setAdding] = useState<number | null>(null);

  const bundles = trpc.commerce.bundlesForVariant.useQuery(
    { variantId: variantId ?? "" },
    { enabled: Boolean(variantId) },
  );

  const rows = bundles.data ?? [];
  if (rows.length === 0) return null;

  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });

  return (
    <section className="mt-6 space-y-3">
      <h2 className="type-label ink-muted">{t("bundle.heading")}</h2>

      {rows.map(bundle => (
        <div key={bundle.id} className="rounded-[1.1rem] border border-[#d5dfeb] bg-white/70 p-4">
          <p dir="auto" className="font-extrabold text-[#0a285a]">{bundle.name}</p>

          <ul className="mt-2 space-y-1">
            {bundle.members.map(member => (
              <li key={member.variantId} className="text-[13px] leading-5 text-[#536b8c]">
                <span dir="auto">{member.productTitle}</span>
                {member.quantity > 1 ? <span> ×{member.quantity}</span> : null}
                {/* Named per member, because two parcels from two sellers is
                    what actually turns up. */}
                {bundle.crossVendor && member.vendorName ? (
                  <span dir="auto" className="ink-muted"> · {member.vendorName}</span>
                ) : null}
              </li>
            ))}
          </ul>

          <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
            <span className="type-price-lg text-[#0a285a]">{amount(bundle.bundlePrice)}</span>
            {/* The struck-through figure and the saving are one claim, and it
                is only drawn because `loadBundles` already refused to hand
                over a set whose Ministry permit is not valid now. */}
            <span className="text-[13px] text-[#536b8c] line-through">{amount(bundle.separately)}</span>
            <span className="type-label ink-accent">{t("bundle.saving", { amount: amount(bundle.saving) })}</span>
          </p>

          <button
            type="button"
            disabled={adding === bundle.id}
            onClick={async () => {
              setAdding(bundle.id);
              try {
                /* Every member, one after the other, each marked as this
                   bundle's — the server is what turns that into the split
                   price, because a browser must not name what things cost. */
                for (const member of bundle.members) {
                  await addItem(String(member.variantId), member.quantity, false, [], bundle.id);
                }
                toast.success(t("bundle.added", { name: bundle.name }));
              } catch {
                toast.error(t("cart.addFailed"));
              } finally {
                setAdding(null);
              }
            }}
            className="glass-navy type-control pressable mt-3 inline-flex items-center gap-2 rounded-full px-5 py-3 disabled:opacity-60"
          >
            {adding === bundle.id ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <PackagePlus className="size-4" aria-hidden />}
            {t("bundle.add")}
          </button>

          <p className="mt-2 text-[12px] leading-5 ink-muted">{t("bundle.allOrNothing")}</p>
        </div>
      ))}
    </section>
  );
}
