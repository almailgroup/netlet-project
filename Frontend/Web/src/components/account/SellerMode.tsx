/**
 * Moving between shopping and selling, without signing out.
 *
 * Requirement 3.4.17. One account already holds both identities — a vendor
 * member is a shopper with a `vendor_members` row — and there was simply no
 * door between the two: the portal has carried "Back to the store" from the
 * day it existed, and nothing in the storefront pointed the other way.
 *
 * **It is drawn only for somebody who has the second identity.** A "switch to
 * selling" link on a shopper's account is the dead-control rule again: it
 * would lead to a page telling them they have no access, which is worse than
 * no link. `inventory.me` is the one place that answers who somebody is, asked
 * rather than guessed from anything the client holds, and reused rather than
 * given a parallel endpoint that could answer differently.
 *
 * It names the store and the rank rather than saying "Seller". Somebody who
 * sells for two companies, or who has been moved from manager to staff, is
 * told which hat they are putting on before they press anything.
 */
import { Link } from "wouter";
import { ArrowRight, Store } from "lucide-react";
import { roleLabelKey } from "@/components/admin/AdminShell";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";

export function SellerMode() {
  const { t } = useTranslation();
  /* Cached hard: this answer changes when an administrator adds somebody to a
     store, which is not something to re-ask on every account page view. */
  const me = trpc.inventory.me.useQuery(undefined, { staleTime: 10 * 60 * 1000, retry: false });
  const actor = me.data;
  /* The store's name is a separate read because `Actor` is the permission
     shape both sides import, and a display name has no place in an answer
     about access. Asked only once there is a store to name. */
  const store = trpc.inventory.myStore.useQuery(undefined, {
    enabled: actor?.kind === "vendor",
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  if (!actor || actor.kind === "customer") return null;

  return (
    <div className="rounded-2xl border border-[#e6e9ef] bg-white p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[#0a285a]/12 bg-[#0a285a]/8 text-[#0a285a]">
          <Store className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-[#0a285a]">
            {store.data
              ? <span dir="auto">{store.data.name}</span>
              : t("account.sellerPlatform")}
          </p>
          <p className="mt-0.5 text-[12px] leading-5 ink-muted">
            {t("account.sellerAs", { role: t(roleLabelKey(actor)) })}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[13px] leading-6 text-[#536b8c]">{t("account.sellerNote")}</p>

      <Link
        href="/admin"
        className="glass glass-navy pressable mt-4 inline-flex items-center gap-2 rounded-full px-5 py-3 text-xs font-extrabold"
      >
        {t("account.sellerSwitch")}
        <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
      </Link>
    </div>
  );
}
