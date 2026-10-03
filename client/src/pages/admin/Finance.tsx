/**
 * Where the money went.
 *
 * Requirement 3.6.1. Almost all of this existed already and could not be read:
 * `order_items` has carried `lineTotal`, `commissionAmount` and `vendorNet`
 * frozen at the moment of sale since the day orders landed, and nothing asked
 * for them back. `shared/commerce/finance.ts` is the arithmetic and is pure;
 * this draws it.
 *
 * **Gross, refunded and net are three figures, never one.** A single blended
 * number hides the refund rate, which is among the first things anybody opens
 * a finance panel to find out.
 *
 * **It says plainly when there is nothing yet.** Nothing places a paid order
 * in NetLet today — that is the honest state rather than an omission, written
 * down in `CLAUDE.md` under Orders — so this panel will be empty on a real
 * deployment until payments land. An empty table that looks like a working one
 * is the exact lie `QueryGate` exists to stop, so the emptiness is labelled
 * rather than left to be inferred from four zeros.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { cell, head, Scroller } from "@/components/admin/FinanceTable";
import { PayoutsDue } from "@/components/admin/PayoutsDue";
import { QueryGate } from "@/components/admin/QueryGate";
import { useTranslation, useMoney } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { takeRate, type MonthTotals, type Totals, type VendorTotals } from "@shared/commerce/finance";
import { useDateFormat } from "@/hooks/useDateFormat";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Coins, RotateCcw, Store, Wallet } from "lucide-react";
import { toast } from "sonner";

export default function AdminFinance() {
  usePageMeta(privatePageMeta("Finance"));
  return <AdminShell need="platform.viewAll">{() => <Finance />}</AdminShell>;
}

function Finance() {
  const { t } = useTranslation();
  const report = trpc.finance.report.useQuery({});

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("admin.financeTitle")}</h1>
      <p className="mt-1 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("admin.financeNote")}</p>

      <QueryGate queries={[report]}>
        {() => {
          const data = report.data;
          if (!data) return null;
          return (
          <div className="mt-6 space-y-8">
            {data.truncated ? (
              /* Under-reporting silently is the same lie a table showing one
                 page of an answer tells. Say it. */
              <p className="flex items-start gap-2 rounded-xl border border-[#f0d3c6] bg-[#fdf3ee] px-4 py-3 text-[13px] font-semibold text-[#8c2f22]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t("admin.financeTruncated")}
              </p>
            ) : null}

            {data.totals.paidLines === 0 && data.totals.refundedLines === 0 ? (
              <p className="rounded-xl border border-[#d5dfeb] bg-white/60 px-4 py-5 text-[13px] leading-6 text-[#536b8c]">
                {t("admin.financeEmpty")}
              </p>
            ) : (
              <>
                <Headline totals={data.totals} />
                <VendorTable rows={data.vendors} />
                <MonthTable rows={data.months} />
                <Payouts />
                <PayoutsDue />
              </>
            )}
          </div>
          );
        }}
      </QueryGate>

      {/* Outside the "nothing sold yet" branch on purpose: a points balance can
          exist without a sale behind it — an adjustment, a goodwill credit —
          and a cash-out somebody is waiting on must not be hidden by an empty
          sales table. */}
      <div className="mt-8">
        <CashOuts />
      </div>
    </>
  );
}

function Tile({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#d5dfeb] bg-white/70 p-4">
      <div className="flex items-center gap-2 text-[11px] font-extrabold tracking-[.06em] text-[#536b8c] uppercase">
        <span className="grid size-6 place-items-center rounded-lg bg-[#0a285a]/8 text-[#0a285a]">{icon}</span>
        {label}
      </div>
      <p className="mt-2 text-xl font-extrabold text-[#0a285a]"><bdi dir="ltr">{value}</bdi></p>
      {sub ? <p className="mt-0.5 text-[11px] text-[#536b8c]">{sub}</p> : null}
    </div>
  );
}

function Headline({ totals }: { totals: Totals }) {
  const { t } = useTranslation();
  const money = useMoney();
  const rate = takeRate(totals);
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        label={t("admin.financeNet")}
        value={amount(totals.net)}
        sub={t("admin.financeGrossLess", { gross: amount(totals.gross), refunded: amount(totals.refunded) })}
        icon={<Coins className="size-3.5" />}
      />
      <Tile
        label={t("admin.financeCommission")}
        value={amount(totals.commission)}
        /* Null rather than "0.0%" when nothing sold — a rate somebody can read
           as a fact about the shop should not be invented from an empty set. */
        sub={rate === null ? undefined : t("admin.financeTakeRate", { rate: String(rate) })}
        icon={<Wallet className="size-3.5" />}
      />
      <Tile
        label={t("admin.financeVendorNet")}
        value={amount(totals.vendorNet)}
        sub={t("admin.financeOwedNote")}
        icon={<Store className="size-3.5" />}
      />
      <Tile
        label={t("admin.financeRefunded")}
        value={amount(totals.refunded)}
        sub={t("admin.financeLineCount", { paid: String(totals.paidLines), refunded: String(totals.refundedLines) })}
        icon={<RotateCcw className="size-3.5" />}
      />
    </div>
  );
}


/**
 * Per seller, in columns that add up.
 *
 * Every step is a column, so a reader can check the row with their eyes:
 * `sales − refunded = net`, and `commission + owed = net`. The first version
 * showed net beside commission and owed and they did not reconcile — Acme read
 * 180 net, 22 cut, 198 owed — which is what exposed the arithmetic bug behind
 * it, where a refunded line was left out of gross and still subtracted from it.
 * A finance table whose columns do not add up is the fastest way to lose an
 * accountant, and it was invisible until the page was rendered against real
 * orders.
 *
 * Six money-ish columns is more than a table usually wants, and this is the
 * table that earns them: the alternative is two figures and a reader who has
 * to trust the subtraction happened somewhere off screen.
 */
function VendorTable({ rows }: { rows: VendorTotals[] }) {
  const { t } = useTranslation();
  if (!rows.length) return null;

  return (
    <section>
      <h2 id="finance-by-seller" className="text-sm font-extrabold text-[#0a285a]">{t("admin.financeBySeller")}</h2>
      <Scroller labelledBy="finance-by-seller">
        <table className="w-full min-w-[680px] border-collapse">
          <thead>
            <tr className="border-b border-[#d5dfeb]">
              <th scope="col" className={`${head} text-start`}>{t("admin.financeSeller")}</th>
              <th scope="col" className={`${head} text-end`}>{t("admin.financeLinesColumn")}</th>
              <th scope="col" className={`${head} text-end`}>{t("admin.financeSales")}</th>
              <th scope="col" className={`${head} text-end`}>{t("admin.financeRefunded")}</th>
              <th scope="col" className={`${head} text-end`}>{t("admin.financeNet")}</th>
              <th scope="col" className={`${head} text-end`}>{t("admin.financeCommission")}</th>
              <th scope="col" className={`${head} text-end`}>{t("admin.financeOwed")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={String(row.vendorId ?? row.vendorName)} className="border-b border-[#eef1f6] last:border-0">
                <th scope="row" className={`${cell} text-start font-bold text-[#0a285a]`}><span dir="auto">{row.vendorName}</span></th>
                <MoneyRow totals={row} />
              </tr>
            ))}
          </tbody>
        </table>
      </Scroller>
    </section>
  );
}

/**
 * The five figures, in the order they derive from each other.
 *
 * One component for both tables rather than two copies of six cells: the
 * month table asks exactly the same question of a different grouping, and two
 * copies is how a column ends up in a different place in each.
 *
 * The count is its own column rather than "(1 lines)" beside the name — that
 * reads wrong in English and has no single right form in Arabic, which has a
 * dual as well as a plural. It counts every completed line the row is built
 * from, refunded ones included, since they are behind the money beside it.
 */
function MoneyRow({ totals }: { totals: Totals }) {
  const money = useMoney();
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });
  return (
    <>
      <td className={`${cell} text-end text-[#536b8c]`}><bdi dir="ltr">{totals.paidLines + totals.refundedLines}</bdi></td>
      <td className={`${cell} text-end text-[#404553]`}><bdi dir="ltr">{amount(totals.gross)}</bdi></td>
      <td className={`${cell} text-end text-[#404553]`}><bdi dir="ltr">{amount(totals.refunded)}</bdi></td>
      <td className={`${cell} text-end font-extrabold text-[#0a285a]`}><bdi dir="ltr">{amount(totals.net)}</bdi></td>
      <td className={`${cell} text-end text-[#404553]`}><bdi dir="ltr">{amount(totals.commission)}</bdi></td>
      <td className={`${cell} text-end text-[#404553]`}><bdi dir="ltr">{amount(totals.vendorNet)}</bdi></td>
    </>
  );
}

function MonthTable({ rows }: { rows: MonthTotals[] }) {
  const { t } = useTranslation();
  if (!rows.length) return null;

  return (
    <section>
      <h2 id="finance-by-month" className="text-sm font-extrabold text-[#0a285a]">{t("admin.financeByMonth")}</h2>
      {/* UTC, and the page says so: Kuwait is UTC+3, so a sale at 2am on the
          first falls in the previous month by this reckoning. Stating it beats
          a silent local-time conversion inside the arithmetic. */}
      <p className="mt-1 text-[11px] text-[#536b8c]">{t("admin.financeMonthNote")}</p>
      <Scroller labelledBy="finance-by-month">
        <table className="w-full min-w-[680px] border-collapse">
          <thead>
            <tr className="border-b border-[#d5dfeb]">
              <th scope="col" className={`${head} text-start`}>{t("admin.financeMonth")}</th>
              <th scope="col" className={`${head} text-end`}>{t("admin.financeLinesColumn")}</th>
              <th scope="col" className={`${head} text-end`}>{t("admin.financeSales")}</th>
              <th scope="col" className={`${head} text-end`}>{t("admin.financeRefunded")}</th>
              <th scope="col" className={`${head} text-end`}>{t("admin.financeNet")}</th>
              <th scope="col" className={`${head} text-end`}>{t("admin.financeCommission")}</th>
              <th scope="col" className={`${head} text-end`}>{t("admin.financeOwed")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.month} className="border-b border-[#eef1f6] last:border-0">
                <th scope="row" className={`${cell} text-start font-bold text-[#0a285a]`}><bdi dir="ltr">{row.month}</bdi></th>
                <MoneyRow totals={row} />
              </tr>
            ))}
          </tbody>
        </table>
      </Scroller>
    </section>
  );
}

/**
 * What each seller is owed, week by week.
 *
 * Requirement 3.3.16. On the finance page rather than a page of its own,
 * because it reads the same frozen lines the report above does — two pages
 * over one table is how two answers about one figure appear.
 *
 * **Weeks run Sunday to Saturday** and the page says so: the Kuwaiti weekend
 * is Friday and Saturday, so a week starting Monday would cut one in half.
 * A negative week is shown rather than hidden — a week of refunds against
 * nothing sold means the seller owes NetLet, and a zero there is how a payout
 * run quietly overpays.
 */
function Payouts() {
  const { t } = useTranslation();
  const money = useMoney();
  const payouts = trpc.finance.payouts.useQuery({});
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });

  return (
    <QueryGate queries={[payouts]}>
      {() => {
        const data = payouts.data;
        if (!data) return null;
        return (
          <section>
            <h2 id="finance-payouts" className="text-sm font-extrabold text-[#0a285a]">{t("admin.payouts")}</h2>
            <p className="mt-1 max-w-2xl text-[12px] leading-5 ink-muted">{t("admin.payoutsNote")}</p>
            <p className="mt-0.5 text-[11px] ink-muted">{t("admin.payoutWeekStarts")}</p>

            {data.vendors.length === 0 ? (
              <p className="mt-3 rounded-xl border border-[#d5dfeb] bg-white/60 px-4 py-5 text-[13px] leading-6 text-[#536b8c]">
                {t("admin.payoutsEmpty")}
              </p>
            ) : (
              <>
                <Scroller labelledBy="finance-payouts">
                  <table className="w-full min-w-[680px] border-collapse">
                    <thead>
                      <tr className="border-b border-[#d5dfeb]">
                        <th scope="col" className={`${head} text-start`}>{t("admin.financeSeller")}</th>
                        <th scope="col" className={`${head} text-start`}>{t("admin.payoutWeekColumn")}</th>
                        <th scope="col" className={`${head} text-end`}>{t("admin.financeLinesColumn")}</th>
                        <th scope="col" className={`${head} text-end`}>{t("admin.financeSales")}</th>
                        <th scope="col" className={`${head} text-end`}>{t("admin.financeRefunded")}</th>
                        <th scope="col" className={`${head} text-end`}>{t("admin.financeCommission")}</th>
                        <th scope="col" className={`${head} text-end`}>{t("admin.payoutOwed")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.vendors.flatMap(vendor => vendor.weeks.map((week, index) => (
                        <tr key={`${vendor.vendorId}-${week.weekStart}`} className="border-b border-[#eef1f6] last:border-0">
                          {/* The seller's name is on every row for a screen
                              reader, which announces rows one at a time and
                              would otherwise be told nothing — but hidden
                              after the first for somebody reading the table,
                              where repeating it is noise to filter out. An
                              empty row header is its own violation, which is
                              what the first attempt at this produced. */}
                          <th scope="row" className={`${cell} text-start font-bold text-[#0a285a]`}>
                            <span dir="auto" className={index === 0 ? "" : "sr-only"}>{vendor.vendorName}</span>
                          </th>
                          <td className={`${cell} text-start text-[#536b8c]`}>
                            <bdi dir="ltr">{week.weekStart}</bdi>
                          </td>
                          <td className={`${cell} text-end text-[#536b8c]`}><bdi dir="ltr">{week.lines}</bdi></td>
                          <td className={`${cell} text-end text-[#404553]`}><bdi dir="ltr">{amount(week.gross)}</bdi></td>
                          <td className={`${cell} text-end text-[#404553]`}><bdi dir="ltr">{amount(week.refunded)}</bdi></td>
                          <td className={`${cell} text-end text-[#404553]`}><bdi dir="ltr">{amount(week.commission)}</bdi></td>
                          <td className={`${cell} text-end font-extrabold text-[#0a285a]`}><bdi dir="ltr">{amount(week.owed)}</bdi></td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </Scroller>
                <p className="mt-2 text-[13px] font-extrabold text-[#0a285a]">
                  {t("admin.payoutTotalOwed")}: <bdi dir="ltr">{amount(data.owed)}</bdi>
                </p>
              </>
            )}
          </section>
        );
      }}
    </QueryGate>
  );
}


/**
 * Points cash-outs NetLet still owes (3.1.15).
 *
 * The points are already off the shopper's balance — they had to be, or the
 * same points get spent in another tab while the transfer is arranged — so
 * this is only the bank transfer and the record that it happened. It is beside
 * the seller payouts because it is the same job: a report of what is owed,
 * paid by a human, marked off here.
 */
function CashOuts() {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const owed = trpc.rewards.pendingCashOuts.useQuery({});
  const utils = trpc.useUtils();
  const settle = trpc.rewards.settleCashOut.useMutation({
    onSuccess: () => {
      toast.success(t("admin.markPaidDone"));
      void utils.rewards.pendingCashOuts.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
  });

  return (
    <QueryGate queries={[owed]}>
      {() => {
        const rows = owed.data ?? [];
        return (
          <section>
            <h2 id="finance-cashouts" className="text-sm font-extrabold text-[#0a285a]">{t("admin.cashOuts")}</h2>
            <p className="mt-1 max-w-2xl text-[12px] leading-5 ink-muted">{t("admin.cashOutsNote")}</p>
            {rows.length === 0 ? (
              <p className="mt-3 rounded-xl border border-[#d5dfeb] bg-white/60 px-4 py-5 text-[13px] leading-6 text-[#536b8c]">
                {t("admin.cashOutsEmpty")}
              </p>
            ) : (
              <Scroller labelledBy="finance-cashouts">
                <table className="w-full min-w-[560px] border-collapse">
                  <thead>
                    <tr className="border-b border-[#d5dfeb]">
                      <th scope="col" className={`${head} text-start`}>{t("admin.cashOutShopper")}</th>
                      <th scope="col" className={`${head} text-end`}>{t("admin.cashOutPoints")}</th>
                      <th scope="col" className={`${head} text-end`}>{t("admin.payoutOwed")}</th>
                      <th scope="col" className={`${head} text-start`}>{t("admin.cashOutRequested")}</th>
                      <th scope="col" className={`${head} text-end`}><span className="sr-only">{t("admin.markPaid")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.id} className="border-b border-[#eef1f6] last:border-0">
                        <th scope="row" className={`${cell} text-start font-bold text-[#0a285a]`}>
                          <span dir="auto">{row.name ?? ""}</span>{" "}
                          <bdi dir="ltr" className="font-normal ink-muted">{row.email}</bdi>
                        </th>
                        <td className={`${cell} text-end text-[#536b8c]`}>
                          {/* Two pots, two rates (3.7): an affiliate's commission is
                              money already and is paid at face value. */}
                          {row.pot === "affiliate"
                            ? t("admin.cashOutAffiliate")
                            : <bdi dir="ltr">{t("rewards.balance", { points: row.points })}</bdi>}
                        </td>
                        <td className={`${cell} text-end font-extrabold text-[#0a285a]`}>
                          <bdi dir="ltr">{money({ amount: row.value, currencyCode: "KWD" })}</bdi>
                        </td>
                        <td className={`${cell} text-start text-[#536b8c]`}>{formatDate(row.requestedAt)}</td>
                        <td className={`${cell} text-end`}>
                          <button
                            type="button"
                            disabled={settle.isPending}
                            onClick={() => settle.mutate({ entryId: row.id })}
                            className="glass-navy type-control pressable rounded-full px-3 py-1.5 disabled:opacity-60"
                          >
                            {t("admin.markPaid")}
                          </button>
                        </td>
                      </tr>
                    ))}
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
