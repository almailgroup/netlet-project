/**
 * What the account has accumulated: saved items and order tracking.
 *
 * Below the settings on purpose. These are things to glance at, not things
 * to change, and the page is for changing things — the shop itself is where
 * saved items are actually used.
 */
import { useCustomer } from "@/contexts/CustomerContext";
import { useTranslation } from "@/lib/useTranslation";
import { appPath } from "@/lib/basePath";
import { trpc } from "@/lib/trpc";
import { ArrowRight, Heart, PackageSearch } from "lucide-react";

export function AccountActivity() {
  const { t } = useTranslation();
  const { savedIds } = useCustomer();
  const tracking = trpc.customer.tracking.list.useQuery();
  const trackingCount = tracking.data?.length ?? 0;

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
        <p className="mt-1 text-sm ink-muted">
          {trackingCount === 0
            ? t("account.trackingEmpty")
            : trackingCount === 1
              ? t("account.trackingCountOne")
              : t("account.trackingCount", { count: trackingCount })}
        </p>
        {/* Says plainly that nothing is being simulated, rather than leaving an
            empty panel to imply the feature is merely quiet today. */}
        <p className="mt-4 text-[11px] leading-4 ink-muted">{t("account.trackingNote")}</p>
      </article>
    </div>
  );
}
