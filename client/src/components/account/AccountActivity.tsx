/**
 * What the account has accumulated: saved items, and where to track an order.
 *
 * Below the settings on purpose. These are things to glance at, not things
 * to change, and the page is for changing things — the shop itself is where
 * saved items are actually used.
 */
import { useCustomer } from "@/contexts/CustomerContext";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { ArrowRight, Heart, PackageSearch } from "lucide-react";

export function AccountActivity() {
  const { t } = useTranslation();
  const { savedIds } = useCustomer();

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <article className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5 sm:p-6">
        <span className="grid size-10 place-items-center rounded-xl bg-[#e7edf5] text-[#0a285a]"><Heart className="size-5" /></span>
        <h3 className="mt-4 text-base font-extrabold text-[#0a285a]">{t("account.savedFinds")}</h3>
        <p className="mt-1 text-sm ink-muted">
          {savedIds.length === 0
            ? t("account.savedEmpty")
            : savedIds.length === 1
              ? t("account.savedCountOne")
              : t("account.savedCount", { count: savedIds.length })}
        </p>
        <a
          href={appPath("/saved")}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-extrabold ink-accent underline underline-offset-4"
        >
          {t("account.browseSaved")}<ArrowRight className="size-3.5 rtl:-scale-x-100" />
        </a>
      </article>

      <article className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5 sm:p-6">
        <span className="grid size-10 place-items-center rounded-xl bg-[#e7edf5] text-[#0a285a]"><PackageSearch className="size-5" /></span>
        <h3 className="mt-4 text-base font-extrabold text-[#0a285a]">{t("account.orderTracking")}</h3>
        {/* It counted rows in a tracking table nothing writes to, and said
            "no connected order source yet" — a status report, not an answer.
            Tracking is on each order now (3.4.3), so this points there. */}
        <p className="mt-1 text-sm ink-muted">{t("account.trackingWhere")}</p>
        <a
          href="#orders"
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-extrabold ink-accent underline underline-offset-4"
        >
          {t("account.seeOrders")}<ArrowRight className="size-3.5 rtl:-scale-x-100" />
        </a>
      </article>
    </div>
  );
}
