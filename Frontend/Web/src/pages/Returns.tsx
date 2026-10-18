/**
 * `/returns`: what the shop does with something sent back, and where to start.
 *
 * The footer's "Returns" opened the orders page, which says nothing to
 * somebody deciding whether to buy and nothing about what happens next to
 * somebody who has. Every sentence here is a rule the server applies —
 * `RETURN_WINDOW_DAYS`, and `Shared/commerce/returnRequests.ts`'s decisions:
 * a fault on the seller's side is approved at once, a change of mind too
 * except on a perishable department, anything else waits for a person, and an
 * exchange with nothing left on the shelf becomes a refund. The button goes to
 * the orders, where a return is actually started, beside the item.
 */
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { RETURN_WINDOW_DAYS } from "@shared/commerce/returns";
import { privatePageMeta } from "@shared/seo";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ArrowRight, CircleCheck, LifeBuoy, MessageSquareText, PackageOpen, RefreshCw, Shirt, Wallet } from "lucide-react";
import { Link } from "wouter";
import { CARD, PageBody, PageHeading } from "@/components/layout/Page";

const DECIDED: { icon: typeof CircleCheck; title: MessageKey; body: MessageKey }[] = [
  { icon: CircleCheck, title: "returnsPage.faultTitle", body: "returnsPage.faultBody" },
  { icon: Shirt, title: "returnsPage.mindTitle", body: "returnsPage.mindBody" },
  { icon: MessageSquareText, title: "returnsPage.otherTitle", body: "returnsPage.otherBody" },
];

const AFTER: { icon: typeof CircleCheck; title: MessageKey; body: MessageKey }[] = [
  { icon: RefreshCw, title: "returnsPage.exchangeTitle", body: "returnsPage.exchangeBody" },
  { icon: PackageOpen, title: "returns.condition.title", body: "returns.condition.body" },
  { icon: Wallet, title: "returns.refund.title", body: "returns.refund.body" },
];

function Rows({ rows }: { rows: typeof DECIDED }) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y divide-[#e6e9ef]">
      {rows.map(row => (
        <li key={row.title} className="flex items-start gap-3.5 py-4 first:pt-0 last:pb-0">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#eef2f8] text-[#0a285a]"><row.icon className="size-4" aria-hidden /></span>
          <div>
            <h3 className="text-sm font-bold text-[#0a285a]">{t(row.title)}</h3>
            <p className="mt-0.5 text-[13px] leading-[1.55] text-[#404553]">{t(row.body)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Returns() {
  const { t } = useTranslation();
  usePageMeta(privatePageMeta("Returns and exchanges"));
  return (
    <PageBody width="reading">
        <PageHeading title={t("returnsPage.title")} note={t("returnsPage.intro", { days: RETURN_WINDOW_DAYS })} />

        <div className={`${CARD} p-5 sm:p-6`}>
          <Link href="/account/orders" className="glass glass-navy pressable inline-flex items-center gap-2 rounded-full px-5 py-3 text-[14px] font-bold">
            {t("returnsPage.start")}<ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Link>
          <p className="mt-3 text-[13px] leading-6 ink-muted">{t("returnsPage.startNote")}</p>
        </div>

        <section className="mt-8" aria-labelledby="decided-title">
          <h2 id="decided-title" className="text-lg font-extrabold">{t("returnsPage.howDecided")}</h2>
          <div className={`${CARD} mt-3 p-5 sm:p-6`}><Rows rows={DECIDED} /></div>
        </section>

        <section className="mt-8" aria-labelledby="after-title">
          <h2 id="after-title" className="text-lg font-extrabold">{t("shipping.returns.title")}</h2>
          <div className={`${CARD} mt-3 p-5 sm:p-6`}><Rows rows={AFTER} /></div>
        </section>

        <Link href="/help" className="mt-8 flex items-center gap-3 rounded-2xl border border-[#e6e9ef] bg-white p-4 hover:bg-[#f0f2f5]">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#eef2f8]"><LifeBuoy className="size-4" aria-hidden /></span>
          <span className="text-sm font-bold">{t("returnsPage.questions")} {t("support.section")}</span>
          <ArrowRight className="ms-auto size-4 text-[#536b8c] rtl:-scale-x-100" aria-hidden />
        </Link>
    </PageBody>
  );
}
