/**
 * When each order's money is due to its seller (3.3.21) — on the finance panel
 * for NetLet and on the payouts page for a store's own manager, from one copy.
 */
import { QueryGate } from "@/components/admin/QueryGate";
import { cell, head, Scroller } from "@/components/admin/FinanceTable";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { SETTLEMENT_DAYS, type PayoutDue } from "@shared/commerce/payoutSchedule";

/**
 * When each order's money is actually due (3.3.21).
 *
 * Per order rather than per week, because the schedule runs from when the
 * money *arrived*: a cash order collected on the Sunday and one still
 * uncollected on the Thursday are not the same obligation even though they
 * fall in one week.
 *
 * **Overdue is shown rather than hidden.** A due date that has passed with no
 * payment is exactly what a seller needs to see, and a schedule that only ever
 * shows comfortable numbers is one nobody believes.
 */
export function PayoutsDue() {
  const { t } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const due = trpc.finance.payoutsDue.useQuery({});
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });

  const state = (row: { due: PayoutDue; owed: string; paid: string }) => {
    /* Sent already, in full: the ledger's answer wins over the schedule's. */
    if (Number(row.paid) > 0 && Number(row.paid) >= Number(row.owed)) return { text: t("admin.payoutSent"), tone: "ink-muted" };
    if (row.due.state === "refunded") return { text: t("admin.payoutRefunded"), tone: "ink-muted" };
    if (row.due.state === "unpaid") return { text: t("admin.payoutUnpaid"), tone: "ink-muted" };
    if (row.due.state === "held") {
      return { text: t("admin.payoutHeld", { from: formatDate(row.due.window.from) }), tone: "text-[#404553]" };
    }
    const same = row.due.window.from.getTime() === row.due.window.to.getTime();
    const text = same
      ? t("admin.payoutDueOn", { from: formatDate(row.due.window.from) })
      : t("admin.payoutDueBetween", { from: formatDate(row.due.window.from), to: formatDate(row.due.window.to) });
    return row.due.overdue
      ? { text: `${t("admin.payoutOverdue")} · ${text}`, tone: "font-extrabold text-[#8c2f22]" }
      : { text, tone: "text-[#0a285a]" };
  };

  return (
    <QueryGate queries={[due]}>
      {() => {
        const rows = due.data ?? [];
        return (
          <section>
            <h2 id="finance-due" className="text-sm font-extrabold text-[#0a285a]">{t("admin.payoutsDue")}</h2>
            <p className="mt-1 max-w-2xl text-[12px] leading-5 ink-muted">
              {t("admin.payoutsDueNote", {
                cod: String(SETTLEMENT_DAYS.cod.min),
                cardMin: String(SETTLEMENT_DAYS.card.min),
                cardMax: String(SETTLEMENT_DAYS.card.max),
              })}
            </p>
            {rows.length === 0 ? (
              <p className="mt-3 rounded-xl border border-[#d5dfeb] bg-white/60 px-4 py-5 text-[13px] leading-6 text-[#536b8c]">
                {t("admin.payoutsDueEmpty")}
              </p>
            ) : (
              <Scroller labelledBy="finance-due">
                <table className="w-full min-w-[560px] border-collapse">
                  <thead>
                    <tr className="border-b border-[#d5dfeb]">
                      <th scope="col" className={`${head} text-start`}>{t("admin.payoutOrder")}</th>
                      <th scope="col" className={`${head} text-start`}>{t("admin.financeSeller")}</th>
                      <th scope="col" className={`${head} text-end`}>{t("admin.payoutOwed")}</th>
                      <th scope="col" className={`${head} text-start`}>{t("admin.payoutsDue")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => {
                      const shown = state(row);
                      return (
                        <tr key={`${row.orderId}-${row.vendorId}`} className="border-b border-[#eef1f6] last:border-0">
                          <th scope="row" className={`${cell} text-start font-bold text-[#0a285a]`}>
                            <bdi dir="ltr">{row.reference}</bdi>
                          </th>
                          <td className={`${cell} text-start text-[#536b8c]`}><span dir="auto">{row.vendorName}</span></td>
                          <td className={`${cell} text-end font-extrabold text-[#0a285a]`}><bdi dir="ltr">{amount(row.owed)}</bdi></td>
                          <td className={`${cell} text-start ${shown.tone}`}>{shown.text}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Scroller>
            )}
          </section>
        );
      }}
    </QueryGate>
  );
}
