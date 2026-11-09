/**
 * What is running out, and what has moved.
 *
 * Two halves of one question. The list answers "what do I need to reorder";
 * the log answers "why is this number what it is" — which only has an answer
 * because stock moves by a delta with a reason rather than by typing a new
 * total.
 *
 * Both are tables on a wide screen and cards on a phone: the columns are what
 * somebody compares down the page (how many left against the reorder point),
 * and a list of sentences made them read across instead.
 *
 * Scoped by the server: a vendor sees their own shelves, an admin sees every
 * vendor's.
 *
 * **It keeps itself current**: the shelf's counts, the list and the log are
 * asked again every thirty seconds while the page is open, and it says when
 * it last heard. Each low shelf says its state (`stockState`, the dashboard's
 * rule), how long it lasts at the last four weeks' pace, and — for a rank
 * that moves stock — takes a reorder point and a delivery where it stands.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, compactFieldClass, EmptyState, PageHeader, Pill, SectionHeading, SkeletonRows, smallButtonClass, surfaceClass, tableClass } from "@/components/admin/ui";
import { SHOP_TIME_ZONE, useDateTimeFormat } from "@/hooks/useDateFormat";
import { useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { reorderFor } from "@shared/ai/copilot";
import { daysOfCover, stockState, type StockHealth, type StockState } from "@shared/commerce/dashboard";
import { isDefaultVariantTitle } from "@shared/commerce/fromInventory";
import type { MessageKey } from "@shared/i18n/dictionary";
import { can, type Actor } from "@shared/inventory/permissions";
import { privatePageMeta } from "@shared/seo";
import { AlertTriangle, CheckCircle2, Clock, Loader2, PackagePlus, RefreshCw, XCircle } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

export default function AdminStock() {
  usePageMeta(privatePageMeta("Stock"));
  return <AdminShell need="product.view">{actor => <Stock actor={actor} />}</AdminShell>;
}

/** How often the page asks again while it is open. */
const LIVE_MS = 30_000;

const STATE_LOOK: Record<StockState, { label: MessageKey; tone: "good" | "warning" | "danger" | "neutral"; icon: ReactNode; ink: string; plate: string }> = {
  healthy: { label: "dashboard.stockHealthy", tone: "good", icon: <CheckCircle2 className="size-3.5" aria-hidden />, ink: "text-[#0a7a0a]", plate: "bg-[#e9f7e9]" },
  low: { label: "dashboard.stockLow", tone: "warning", icon: <AlertTriangle className="size-3.5" aria-hidden />, ink: "text-[#8a5a00]", plate: "bg-[#fff4dc]" },
  out: { label: "dashboard.stockOut", tone: "danger", icon: <XCircle className="size-3.5" aria-hidden />, ink: "text-[#b42318]", plate: "bg-[#fdecea]" },
  preorder: { label: "dashboard.stockPreorder", tone: "neutral", icon: <Clock className="size-3.5" aria-hidden />, ink: "text-[#475569]", plate: "bg-[#eef1f5]" },
};

function Stock({ actor }: { actor: Actor }) {
  const { t, isArabic } = useTranslation();
  const when = useDateTimeFormat();
  const [page, setPage] = useState(1);
  const health = trpc.inventory.stockHealth.useQuery(undefined, { refetchInterval: LIVE_MS });
  const low = trpc.inventory.lowStock.useQuery({ page }, { placeholderData: previous => previous, refetchInterval: LIVE_MS });
  const history = trpc.inventory.stockHistory.useQuery({ limit: 30 }, { refetchInterval: LIVE_MS });
  const lowRows = low.data?.rows ?? [];
  const moves = history.data ?? [];
  const mayMove = can(actor, "stock.adjust", actor.kind === "vendor" ? actor.vendorId : undefined);
  const heard = low.dataUpdatedAt
    ? new Date(low.dataUpdatedAt).toLocaleTimeString(isArabic ? "ar-KW-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: SHOP_TIME_ZONE })
    : null;
  const refreshing = low.isFetching || health.isFetching || history.isFetching;

  const status = (row: (typeof lowRows)[number]) => {
    const look = STATE_LOOK[stockState(row)];
    return <Pill tone={look.tone}>{look.icon}{t(look.label)}</Pill>;
  };
  const pace = (row: (typeof lowRows)[number]) => {
    const days = daysOfCover(row.stock, row.soldLately);
    return days === null ? <span className="ink-muted">{t("stock.noPace")}</span> : <span className={days < 7 ? "font-semibold text-[#8a5a00]" : "text-[#0a285a]"}>{t("stock.daysLeft", { count: Math.max(1, days) })}</span>;
  };
  /* A signed number is bidi-fragile: "+12" renders as "12+" when the
     surrounding paragraph is RTL, so it is isolated. */
  const change = (delta: number) => (
    <bdi dir="ltr" className={`font-bold tabular-nums ${delta < 0 ? "text-[#8c2f22]" : "text-[#2f5d33]"}`}>
      {delta > 0 ? `+${delta}` : delta}
    </bdi>
  );
  const by = (row: (typeof moves)[number]) =>
    row.actorEmail ? t("admin.movedBy", { name: row.actorName || row.actorEmail }) : t("admin.movedBySystem");

  return (
    <>
      <PageHeader
        title={t("admin.stockTitle")}
        description={t("admin.stockIntro")}
        actions={(
          <>
            {heard ? <span role="status" className="text-[12px] ink-muted">{t("stock.updated", { time: heard })}</span> : null}
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void Promise.all([low.refetch(), health.refetch(), history.refetch()])}
              className={buttonClass.secondary}
            >
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden />{t("stock.refresh")}
            </button>
          </>
        )}
      />

      {health.data ? <StatusTiles health={health.data} /> : null}

      <section aria-labelledby="low-stock" className="mt-8">
        <SectionHeading description={t("admin.lowStockNote")}><span id="low-stock">{t("admin.lowStockTitle")}</span></SectionHeading>
        {low.isLoading ? (
          <SkeletonRows label={t("admin.loading")} />
        ) : low.isError && !low.data ? (
          <QueryGate queries={[low]}>{() => null}</QueryGate>
        ) : lowRows.length === 0 ? (
          <EmptyState title={t("admin.nothingLow")} />
        ) : (
          <>
            <ul className="space-y-2 md:hidden">
              {lowRows.map(row => (
                <li key={row.variantId} className={`p-3.5 ${surfaceClass}`}>
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/admin/products/${row.productId}`} dir="auto" className="min-w-0 font-bold text-[#0a285a] hover:underline">
                      {row.productTitle}
                    </Link>
                    {status(row)}
                  </div>
                  <p className="mt-1 text-[13px] leading-5 ink-muted">
                    {/* Each name isolated, so a Latin store name on the Arabic
                        page cannot pull the separator and the count across it. */}
                    {!isDefaultVariantTitle(row.variantTitle) ? <><bdi>{row.variantTitle}</bdi> · </> : null}
                    {t("admin.remaining", { count: Math.max(0, row.stock) })}
                    {row.vendorName ? <> · <bdi>{row.vendorName}</bdi></> : null}
                  </p>
                  <p className="mt-1 text-[13px]">{pace(row)}</p>
                  {/* Demand the seller could not see before (3.1.1): how many
                      shoppers asked to hear when it is back. A count, never who. */}
                  {row.waiting > 0 ? <p className="mt-1 text-[13px] font-semibold text-[#0a285a]">{t("admin.waitingForRestock", { count: row.waiting })}</p> : null}
                  {mayMove ? (
                    <div className="mt-3 flex flex-wrap items-start gap-x-5 gap-y-3 border-t border-[#eef1f6] pt-3">
                      <ReorderEditor row={row} />
                      <ReceiveEditor row={row} />
                    </div>
                  ) : (
                    <p className="mt-1 text-[13px] ink-muted">{row.lowStockAt === null ? t("admin.noThreshold") : t("admin.reorderAt", { count: row.lowStockAt })}</p>
                  )}
                </li>
              ))}
            </ul>
            <div className={`hidden md:block ${tableClass.wrap}`}>
              <table className={tableClass.table}>
                <thead className={tableClass.head}>
                  <tr>
                    <th scope="col" className={tableClass.th}>{t("admin.columnProduct")}</th>
                    <th scope="col" className={tableClass.th}>{t("stock.columnStatus")}</th>
                    <th scope="col" className={tableClass.thEnd}>{t("admin.columnLeft")}</th>
                    <th scope="col" className={tableClass.th}>{t("stock.columnPace")}</th>
                    <th scope="col" className={tableClass.th}>{t("admin.columnWaiting")}</th>
                    <th scope="col" className={tableClass.th}>{mayMove ? t("stock.actions") : t("admin.columnReorder")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lowRows.map(row => (
                    <tr key={row.variantId} className={`${tableClass.row} hover:bg-[#0a285a]/[.06]`}>
                      <td className={tableClass.td}>
                        <Link href={`/admin/products/${row.productId}`} dir="auto" className="font-bold text-[#0a285a] hover:underline">{row.productTitle}</Link>
                        {!isDefaultVariantTitle(row.variantTitle) ? <p dir="auto" className="mt-0.5 text-[13px] ink-muted">{row.variantTitle}</p> : null}
                        {row.vendorName ? <p dir="auto" className="mt-0.5 text-[12px] ink-muted">{row.vendorName}</p> : null}
                      </td>
                      <td className={tableClass.td}>{status(row)}</td>
                      <td className={`${tableClass.td} text-end`}>
                        <span className="text-[15px] font-bold tabular-nums text-[#0a285a]"><bdi dir="ltr">{Math.max(0, row.stock)}</bdi></span>
                        {row.lowStockAt !== null ? <LevelBar stock={row.stock} reorderAt={row.lowStockAt} /> : null}
                      </td>
                      <td className={`${tableClass.td} text-[13px]`}>{pace(row)}</td>
                      <td className={`${tableClass.td} tabular-nums ${row.waiting > 0 ? "font-semibold text-[#0a285a]" : "text-[#536b8c]"}`}>{row.waiting}</td>
                      <td className={tableClass.td}>
                        {mayMove ? (
                          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                            <ReorderEditor row={row} />
                            <ReceiveEditor row={row} />
                          </div>
                        ) : (
                          <span className="tabular-nums text-[#536b8c]">{row.lowStockAt ?? "—"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {low.data ? <Pager page={low.data} onPage={setPage} /> : null}
          </>
        )}
      </section>

      <section aria-labelledby="movements" className="mt-10">
        <SectionHeading><span id="movements">{t("admin.recentMovements")}</span></SectionHeading>
        {history.isLoading ? (
          <SkeletonRows rows={4} label={t("admin.loading")} />
        ) : history.isError ? (
          <QueryGate queries={[history]}>{() => null}</QueryGate>
        ) : moves.length === 0 ? (
          <EmptyState title={t("admin.noMovements")} />
        ) : (
          <>
            <ol className="space-y-2 md:hidden">
              {moves.map(row => (
                <li key={row.id} className="rounded-2xl border border-[#e3e8f0] bg-white shadow-[0_1px_2px_rgba(10,40,90,0.05)] p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/admin/products/${row.productId}`} dir="auto" className="min-w-0 font-semibold text-[#0a285a] hover:underline">{row.productTitle}</Link>
                    {change(row.delta)}
                  </div>
                  <p className="mt-1 text-[13px] leading-5 ink-muted">
                    {t(`reason.${row.reason}` as MessageKey)} · {by(row)} · {when(row.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
            <div className={`hidden md:block ${tableClass.wrap}`}>
              <table className={tableClass.table}>
                <thead className={tableClass.head}>
                  <tr>
                    <th scope="col" className={tableClass.th}>{t("admin.columnWhen")}</th>
                    <th scope="col" className={tableClass.th}>{t("admin.columnProduct")}</th>
                    <th scope="col" className={tableClass.th}>{t("admin.reason")}</th>
                    <th scope="col" className={tableClass.thEnd}>{t("admin.columnChange")}</th>
                    <th scope="col" className={tableClass.thEnd}>{t("admin.columnAfter")}</th>
                    <th scope="col" className={tableClass.th}>{t("admin.columnBy")}</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map(row => (
                    <tr key={row.id} className={tableClass.row}>
                      <td className={`${tableClass.td} whitespace-nowrap text-[#536b8c]`}>{when(row.createdAt)}</td>
                      <td className={tableClass.td}>
                        <Link href={`/admin/products/${row.productId}`} dir="auto" className="font-semibold text-[#0a285a] hover:underline">{row.productTitle}</Link>
                        {!isDefaultVariantTitle(row.variantTitle) ? <p dir="auto" className="mt-0.5 text-[13px] ink-muted">{row.variantTitle}</p> : null}
                      </td>
                      <td className={`${tableClass.td} text-[#536b8c]`}>{t(`reason.${row.reason}` as MessageKey)}</td>
                      <td className={`${tableClass.td} text-end`}>{change(row.delta)}</td>
                      <td className={`${tableClass.td} text-end tabular-nums text-[#0a285a]`}>{row.resulting}</td>
                      <td className={`${tableClass.td} text-[#536b8c]`}>{row.actorEmail ? <bdi>{row.actorName || row.actorEmail}</bdi> : t("admin.movedBySystem")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}

/** The shelf's four states, counted, each with its icon and word. */
function StatusTiles({ health }: { health: StockHealth }) {
  const { t } = useTranslation();
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {(Object.keys(STATE_LOOK) as StockState[]).map(state => {
        const look = STATE_LOOK[state];
        return (
          <li key={state} className={`flex items-center gap-3 p-4 ${surfaceClass}`}>
            <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-xl ${look.plate} ${look.ink} [&_svg]:size-5`}>{look.icon}</span>
            <span className="min-w-0">
              <span className="block text-[22px] leading-7 font-extrabold tabular-nums text-[#0a285a]"><bdi dir="ltr">{health[state]}</bdi></span>
              <span className="block text-[13px] leading-4 font-semibold ink-muted">{t(look.label)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The stock page's two boxes are narrower than a form's, so both sit side by side on a phone's card. */
const narrowField = compactFieldClass.replace("w-20", "w-16");

/** How much of the reorder point is left: full at twice the point, empty at none. */
function LevelBar({ stock, reorderAt }: { stock: number; reorderAt: number }) {
  const share = Math.max(0, Math.min(1, stock / Math.max(1, reorderAt * 2)));
  const color = stock <= 0 ? "#d03b3b" : stock <= reorderAt ? "#fab219" : "#0ca30c";
  return (
    <span aria-hidden className="ms-auto mt-1.5 block h-1.5 w-20 overflow-hidden rounded-full bg-[#eef1f6]">
      <span className="chart-segment block h-full rounded-full" style={{ width: `${Math.max(4, share * 100)}%`, background: color }} />
    </span>
  );
}

type LowRow = { variantId: number; productTitle: string; variantTitle: string; lowStockAt: number | null; soldLately: number };

function nameOf(row: LowRow): string {
  return isDefaultVariantTitle(row.variantTitle) ? row.productTitle : `${row.productTitle} — ${row.variantTitle}`;
}

/** The level a shelf counts as low at, set where the shelf is listed. */
function ReorderEditor({ row }: { row: LowRow }) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const [value, setValue] = useState(row.lowStockAt === null ? "" : String(row.lowStockAt));
  const save = trpc.inventory.variants.setReorderPoint.useMutation();
  /* The phone's list and the wide table both draw this, one hidden: ids of its own. */
  const id = useId();
  const suggested = reorderFor(row.soldLately);
  const parsed = value.trim() === "" ? null : Number(value);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 0 && parsed <= 100_000);
  const changed = parsed !== row.lowStockAt;
  return (
    <form
      onSubmit={async event => {
        event.preventDefault();
        if (!valid || !changed) return;
        try {
          await save.mutateAsync({ variantId: row.variantId, lowStockAt: parsed });
          toast.success(parsed === null ? t("stock.reorderCleared") : t("stock.reorderSaved"));
          void utils.inventory.lowStock.invalidate();
          void utils.inventory.stockHealth.invalidate();
          void utils.inventory.overview.invalidate();
        } catch (error) {
          toast.error(error instanceof Error ? tError(error.message) : t("admin.badReorderPoint"));
        }
      }}
      className="w-[8.5rem]"
    >
      <label className="block text-[12px] font-semibold text-[#0a285a]" htmlFor={id}>{t("stock.reorderPoint")}</label>
      <div className="mt-1 flex gap-2">
        <input
          id={id}
          inputMode="numeric"
          aria-label={t("stock.reorderFor", { name: nameOf(row) })}
          aria-invalid={valid ? undefined : true}
          aria-describedby={`${id}-hint`}
          value={value}
          onChange={event => setValue(event.target.value.replace(/[^\d٠-٩]/g, "").replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))))}
          className={narrowField}
        />
        <button type="submit" disabled={!valid || !changed || save.isPending} className={smallButtonClass.secondary}>
          {save.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}{t("stock.setReorder")}
        </button>
      </div>
      <p id={`${id}-hint`} className="mt-1 text-[11px] leading-4 ink-muted">
        {suggested !== null && suggested !== row.lowStockAt ? (
          <button type="button" onClick={() => setValue(String(suggested))} className="text-start font-semibold text-[#3730a3] underline-offset-2 hover:underline">
            {t("stock.suggested", { count: suggested })}
          </button>
        ) : t("stock.reorderHint")}
      </p>
    </form>
  );
}

/** A delivery counted in where the shelf is listed: a received movement, with its reason. */
function ReceiveEditor({ row }: { row: LowRow }) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const [value, setValue] = useState("");
  const receive = trpc.inventory.variants.adjustStock.useMutation();
  const id = useId();
  const amount = Number(value);
  const valid = Number.isInteger(amount) && amount > 0 && amount <= 1_000_000;
  return (
    <form
      onSubmit={async event => {
        event.preventDefault();
        if (!valid) return;
        try {
          const now = await receive.mutateAsync({ variantId: row.variantId, delta: amount, reason: "received" });
          toast.success(t("stock.receivedNow", { count: now }));
          setValue("");
          void utils.inventory.lowStock.invalidate();
          void utils.inventory.stockHealth.invalidate();
          void utils.inventory.stockHistory.invalidate();
          void utils.inventory.overview.invalidate();
        } catch (error) {
          toast.error(error instanceof Error ? tError(error.message) : t("error.serverProblem"));
        }
      }}
    >
      <label htmlFor={id} className="block text-[12px] font-semibold text-[#0a285a]">{t("stock.arrived")}</label>
      <div className="mt-1 flex gap-2">
      <input
        id={id}
        inputMode="numeric"
        aria-label={t("stock.receiveFor", { name: nameOf(row) })}
        placeholder="0"
        value={value}
        onChange={event => setValue(event.target.value.replace(/[^\d٠-٩]/g, "").replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))))}
        className={narrowField}
      />
      <button type="submit" disabled={!valid || receive.isPending} className={smallButtonClass.primary}>
        {receive.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <PackagePlus className="size-3.5" aria-hidden />}{t("stock.receive")}
      </button>
      </div>
    </form>
  );
}
