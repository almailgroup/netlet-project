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
import { QueryGate } from "@/components/admin/QueryGate";
import { useTranslation, useMoney } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { takeRate, type MonthTotals, type Totals, type VendorTotals } from "@shared/commerce/finance";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Coins, RotateCcw, Store, Wallet } from "lucide-react";
import type { ReactNode } from "react";

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
              </>
            )}
          </div>
          );
        }}
      </QueryGate>
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

const cell = "px-3 py-2.5 text-[13px]";
const head = "px-3 py-2 text-[11px] font-extrabold tracking-[.06em] text-[#536b8c] uppercase";

/**
 * The box a wide table scrolls inside.
 *
 * Seven columns do not fit a phone, so the box scrolls sideways — and a region
 * a mouse can drag but a keyboard cannot reach is one axe is right to fail:
 * without a tab stop on the box itself there is no way to read the last column
 * without a pointer. It takes its name from its own heading, so somebody
 * landing on it is told which table they are in rather than "region".
 *
 * The focus ring comes from the global `[tabindex]:focus-visible` rule, which
 * is why there is none here.
 */
function Scroller({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-labelledby={labelledBy}
      tabIndex={0}
      className="mt-3 overflow-x-auto rounded-xl border border-[#d5dfeb] bg-white/70"
    >
      {children}
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
