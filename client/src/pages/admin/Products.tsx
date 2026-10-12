/**
 * The product list — the page a vendor lives on.
 *
 * Scope is not decided here. `products.list` returns one vendor's rows or
 * every vendor's depending on who asks, so this renders whatever it is given
 * and the store column only appears when there is more than one store in the
 * result — which is exactly when it carries information.
 *
 * Stock is summed across variants, because "3 of 4 variants are empty" is what
 * a vendor needs to see from a list, and the per variant figure is one click
 * away.
 *
 * **Every row is a link, not a clickable `<tr>`.** The row used to navigate on
 * click, which a keyboard could not reach at all and a middle-click could not
 * open in a new tab. The name is the link; the whole row still answers a
 * pointer, because a table people scan with a mouse should not make them aim.
 *
 * Below `md` the same rows are a list of cards. Seven columns do not fit a
 * phone, and a table that scrolls sideways hides the price and the delete
 * behind a drag that nobody discovers.
 *
 * **Filters are the server's**: department and stock level go in the query,
 * like the search, because a filter over one page reports a quiet shelf for a
 * store whose empty products are on page four. **A tick box beside each row
 * selects it for a bulk action** — publish, archive, back to draft, a price
 * change by percentage, stock received — and each product is then changed by
 * its own single-product rule, so the answer lists the ones refused and why
 * (`products.bulk`). The selection is the page in view, cleared when the page
 * or a filter changes, so nothing is acted on that is not on screen.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { DeleteProductDialog } from "@/components/admin/DeleteProductDialog";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { StatusPill } from "@/components/admin/StatusPill";
import { PageHeader, SkeletonRows, buttonClass, fieldClass } from "@/components/admin/ui";
import { Thumb } from "@/components/product/Thumb";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import type { MessageKey } from "@shared/i18n/dictionary";
import { can, type Actor } from "@shared/inventory/permissions";
import { privatePageMeta } from "@shared/seo";
import { Archive, FilePen, ImageOff, PackageCheck, PackagePlus, Percent, Search, Send, Trash2, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Notice } from "@/components/admin/ui";
import { categoryMessageKey } from "@/content/homeLayout";
import { isMessageKey } from "@shared/i18n/dictionary";
import { percentProblem, restockProblem, scalePrice, type BulkAction } from "@shared/inventory/productBulk";
import { Link, useLocation, useSearch } from "wouter";
import { Select } from "@/components/ui/Select";

export default function AdminProducts() {
  usePageMeta(privatePageMeta("Admin"));
  return <AdminShell need="product.view">{actor => <ProductTable actor={actor} />}</AdminShell>;
}

/* The statuses `products.list` filters on, in the order a seller works them. */
const FILTERS = ["all", "draft", "pending_review", "published", "archived"] as const;
type Filter = (typeof FILTERS)[number];

function ProductTable({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const money = useMoney();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<{ id: number; title: string } | null>(null);
  const [department, setDepartment] = useState("");
  const [stockFilter, setStockFilter] = useState<"" | "out" | "low">("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const [percent, setPercent] = useState("10");
  const [amount, setAmount] = useState("1");
  const [refused, setRefused] = useState<{ id: number; title: string; reason: string }[]>([]);
  const categories = trpc.inventory.categories.useQuery();

  /*
   * The search term goes to the server, so stepping to page three and typing
   * still searches the whole catalog. Changing it resets to page one, or a
   * narrowed list would open on a page that no longer exists.
   */
  const term = search.trim();
  /*
   * Which store, for an administrator. In the address rather than in state, so
   * a store's page can link to "its products" and the link can be kept — the
   * rule the shop's own filters follow.
   */
  const address = useSearch();
  const storeFilter = actor.kind === "admin" ? new URLSearchParams(address).get("vendor") ?? "" : "";
  const stores = trpc.inventory.vendors.list.useQuery({ pageSize: 200 }, { enabled: actor.kind === "admin" });
  const storeId = Number(storeFilter) || undefined;
  const products = trpc.inventory.products.list.useQuery(
    {
      page, query: term || undefined, status: filter === "all" ? undefined : filter, vendorId: storeId,
      categoryId: Number(department) || undefined, stock: stockFilter || undefined,
    },
    { placeholderData: previous => previous },
  );
  /* What is selected is what is on screen: a new page or filter starts again. */
  useEffect(() => setSelected(new Set()), [page, term, filter, storeId, department, stockFilter]);
  const utils = trpc.useUtils();
  const runBulk = trpc.inventory.products.bulk.useMutation({
    onSuccess: (result, input) => {
      const titles = new Map((products.data?.rows ?? []).map(row => [row.id, row.title]));
      setRefused(result.refused.map(entry => ({
        id: entry.id,
        title: titles.get(entry.id) ?? `#${entry.id}`,
        reason: isMessageKey(entry.reason) ? t(entry.reason) : t("admin.bulkRefused"),
      })));
      if (result.done) toast.success(t("admin.bulkDone", { count: result.done }));
      setSelected(new Set(result.refused.map(entry => entry.id).filter(id => input.ids.includes(id))));
      setBulk(null);
      void utils.inventory.products.list.invalidate();
      void utils.inventory.overview.invalidate();
    },
    onError: error => toast.error(isMessageKey(error.message) ? t(error.message) : error.message),
  });
  const chooseStore = (value: string) => {
    setPage(1);
    navigate(value ? `/admin/products?vendor=${value}` : "/admin/products", { replace: true });
  };

  const rows = products.data?.rows ?? [];
  const ownVendor = actor.kind === "vendor" ? actor.vendorId : undefined;
  /* Always for an administrator, who reads every store's shelf; a seller's list is all theirs. */
  const showVendor = actor.kind === "admin" || new Set(rows.map(row => row.vendorId)).size > 1;
  const mayBulk = can(actor, "product.edit", ownVendor);
  const departmentName = (name: string | null) => {
    if (!name) return "—";
    const key = categoryMessageKey(name);
    return key ? t(key) : name;
  };
  const toggle = (id: number) => setSelected(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allOnPage = rows.length > 0 && rows.every(row => selected.has(row.id));
  const percentValue = Number(percent.replace("−", "-"));
  const amountValue = Number(amount);
  const fieldProblem = bulk === "reprice" ? percentProblem(percentValue) : bulk === "restock" ? restockProblem(amountValue) : null;
  const confirmBulk = () => runBulk.mutate({
    ids: Array.from(selected),
    action: bulk!,
    ...(bulk === "reprice" ? { percent: percentValue } : {}),
    ...(bulk === "restock" ? { amount: amountValue } : {}),
  });
  const mayCreate = can(actor, "product.create", ownVendor);

  const summarise = (row: (typeof rows)[number]) => {
    const stock = row.variants.reduce((total, variant) => total + variant.stock, 0);
    const cheapest = row.variants.reduce<string | null>(
      (low, variant) => (low === null || Number(variant.price) < Number(low) ? variant.price : low), null);
    const cover = row.images.find(image => image.kind !== "video")?.url;
    return { stock, cheapest, cover, mayDelete: can(actor, "product.delete", row.vendorId) };
  };

  return (
    <>
      <PageHeader
        title={t("admin.products")}
        actions={mayCreate ? (
          <>
            <Link href="/admin/import" className={buttonClass.secondary}>
              <Upload className="size-4" aria-hidden />{t("admin.import")}
            </Link>
            <Link href={storeId ? `/admin/products/new?vendor=${storeId}` : "/admin/products/new"} className={buttonClass.primary}>
              <PackagePlus className="size-4" aria-hidden />{t("admin.newProduct")}
            </Link>
          </>
        ) : null}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 ink-muted" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={event => { setSearch(event.target.value); setPage(1); }}
            aria-label={t("admin.searchProducts")}
            placeholder={`${t("admin.searchProducts")} — ${t("admin.searchProductsHint")}`}
            className={`${fieldClass} ps-10`}
          />
        </div>
        {actor.kind === "admin" && (stores.data?.rows.length ?? 0) > 1 ? (
          <Select
            value={storeFilter}
            onChange={event => chooseStore(event.target.value)}
            aria-label={t("admin.filterStore")}
            className={`${fieldClass} lg:w-56`}
          >
            <option value="">{t("admin.statusAllStores")}</option>
            {(stores.data?.rows ?? []).map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
          </Select>
        ) : null}
        <Select
          value={department}
          onChange={event => { setDepartment(event.target.value); setPage(1); }}
          aria-label={t("admin.filterDepartment")}
          className={`${fieldClass} lg:w-48`}
        >
          <option value="">{t("nav.allDepartments")}</option>
          {(categories.data ?? []).map(category => <option key={category.id} value={category.id}>{departmentName(category.name)}</option>)}
        </Select>
        <Select
          value={stockFilter}
          onChange={event => { setStockFilter(event.target.value as "" | "out" | "low"); setPage(1); }}
          aria-label={t("admin.filterStock")}
          className={`${fieldClass} lg:w-40`}
        >
          <option value="">{t("admin.stockAny")}</option>
          <option value="low">{t("admin.stockLow")}</option>
          <option value="out">{t("admin.stockOut")}</option>
        </Select>
        {/* A segmented control rather than a dropdown: five states read at a
            glance, and the one in force is visible without opening anything. */}
        <div role="group" aria-label={t("admin.filterStatus")} className="hide-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-[#eef1f5] p-1">
          {FILTERS.map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => { setFilter(option); setPage(1); }}
              className={`h-9 shrink-0 rounded-lg px-3 text-[13px] font-semibold transition ${filter === option ? "bg-white text-[#0a285a] shadow-sm" : "text-[#536b8c] hover:text-[#0a285a]"}`}
            >
              {option === "all" ? t("admin.statusAll") : t(`status.${option}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>

      {mayBulk && selected.size > 0 ? (
        <div role="region" aria-label={t("admin.bulkActions")} className="sticky top-2 z-20 mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-[#cfd9e6] bg-white p-3 shadow-sm">
          <p className="me-auto text-[14px] font-bold text-[#0a285a]">{t("admin.selectedCount", { count: selected.size })}</p>
          <button type="button" onClick={() => setBulk("publish")} className={buttonClass.secondary}><Send className="size-4" aria-hidden />{t("admin.publish")}</button>
          <button type="button" onClick={() => setBulk("archive")} className={buttonClass.secondary}><Archive className="size-4" aria-hidden />{t("admin.bulkArchive")}</button>
          <button type="button" onClick={() => setBulk("draft")} className={buttonClass.secondary}><FilePen className="size-4" aria-hidden />{t("admin.bulkDraft")}</button>
          <button type="button" onClick={() => setBulk("reprice")} className={buttonClass.secondary}><Percent className="size-4" aria-hidden />{t("admin.bulkReprice")}</button>
          {can(actor, "stock.adjust", ownVendor) ? (
            <button type="button" onClick={() => setBulk("restock")} className={buttonClass.secondary}><PackageCheck className="size-4" aria-hidden />{t("admin.bulkRestock")}</button>
          ) : null}
          <button type="button" onClick={() => setSelected(new Set())} aria-label={t("admin.bulkClear")} title={t("admin.bulkClear")} className="grid size-10 place-items-center rounded-lg text-[#536b8c] hover:bg-[#f0f2f5]"><X className="size-4" aria-hidden /></button>
        </div>
      ) : null}

      {refused.length ? (
        <Notice tone="warning" className="mt-4" action={<button type="button" onClick={() => setRefused([])} aria-label={t("admin.bulkClear")} className="grid size-8 place-items-center rounded-lg hover:bg-[#0a285a]/[.06]"><X className="size-4" aria-hidden /></button>}>
          <p className="font-bold">{t("admin.bulkRefusedTitle", { count: refused.length })}</p>
          <ul className="mt-1 space-y-0.5">
            {refused.map(entry => <li key={entry.id}><bdi className="font-semibold">{entry.title}</bdi>: {entry.reason}</li>)}
          </ul>
        </Notice>
      ) : null}

      <div className="mt-4">
        {products.isLoading ? (
          <SkeletonRows label={t("admin.loading")} />
        ) : products.isError ? (
          <QueryGate queries={[products]}>{() => null}</QueryGate>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#b8c9dc] bg-white px-6 py-14 text-center">
            <p className="text-[15px] font-bold text-[#0a285a]">{t(term || filter !== "all" ? "admin.noMatches" : "admin.noProducts")}</p>
            {!term && filter === "all" ? (
              <>
                <p className="mx-auto mt-2 max-w-xs text-[14px] leading-6 text-[#536b8c]">{t("admin.noProductsNote")}</p>
                {mayCreate ? (
                  <Link href="/admin/products/new" className={`${buttonClass.primary} mt-5`}>
                    <PackagePlus className="size-4" aria-hidden />{t("admin.newProduct")}
                  </Link>
                ) : null}
              </>
            ) : null}
          </div>
        ) : (
          <>
            {/* Phones: one card per product. */}
            <ul className={`space-y-2 md:hidden ${products.isFetching ? "opacity-70" : ""}`}>
              {rows.map(row => {
                const { stock, cheapest, cover, mayDelete } = summarise(row);
                return (
                  <li key={row.id} className="flex items-center gap-3 rounded-2xl border border-[#e1e7ef] bg-white p-3">
                    {mayBulk ? <PickBox checked={selected.has(row.id)} onChange={() => toggle(row.id)} label={t("admin.selectProduct", { title: row.title })} /> : null}
                    <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-[#f4f6f9]">
                      <Thumb src={cover} alt="" className="size-full object-cover" icon={<ImageOff className="size-4 text-[#536b8c]" />} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/products/${row.id}`} dir="auto" className="line-clamp-2 text-[14px] leading-5 font-bold text-[#0a285a] hover:underline">
                        {row.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                        <StatusPill status={row.status} />
                        <span className="font-semibold text-[#0a285a]">{cheapest ? money({ amount: cheapest, currencyCode: "KWD" }) : "—"}</span>
                        <span className={stock === 0 ? "font-semibold text-[#b3261e]" : "ink-muted"}>
                          {stock === 0 ? t("admin.outOfStock") : `${t("admin.columnStock")}: ${stock}`}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[12px] ink-muted">
                        {showVendor && row.vendorName ? <><bdi>{row.vendorName}</bdi> · </> : null}{departmentName(row.categoryName)}
                      </p>
                    </div>
                    {mayDelete ? (
                      <DeleteButton title={row.title} onClick={() => setDeleting({ id: row.id, title: row.title })} />
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {/* Wider: the table. */}
            <div className={`hidden overflow-hidden rounded-2xl border border-[#e1e7ef] bg-white md:block ${products.isFetching ? "opacity-70" : ""}`}>
              <table className="w-full text-start text-[14px]">
                <thead className="border-b border-[#e1e7ef] bg-[#fafbfd] text-[13px] text-[#536b8c]">
                  <tr>
                    {mayBulk ? (
                      <th scope="col" className="w-12 ps-4 py-3">
                        <PickBox
                          checked={allOnPage}
                          onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map(row => row.id)))}
                          label={t("admin.selectPage")}
                        />
                      </th>
                    ) : null}
                    <th scope="col" className="px-4 py-3 text-start font-semibold">{t("admin.columnProduct")}</th>
                    {showVendor ? <th scope="col" className="px-4 py-3 text-start font-semibold">{t("admin.columnVendor")}</th> : null}
                    <th scope="col" className="px-4 py-3 text-start font-semibold">{t("admin.columnCategory")}</th>
                    <th scope="col" className="px-4 py-3 text-start font-semibold">{t("admin.columnStatus")}</th>
                    <th scope="col" className="px-4 py-3 text-end font-semibold">{t("admin.columnStock")}</th>
                    <th scope="col" className="px-4 py-3 text-end font-semibold">{t("admin.columnPrice")}</th>
                    <th scope="col" className="w-14 px-2 py-3"><span className="sr-only">{t("admin.deleteProduct")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const { stock, cheapest, cover, mayDelete } = summarise(row);
                    return (
                      <tr
                        key={row.id}
                        /* A pointer convenience over a real link: the name below
                           is what a keyboard and a middle-click use. */
                        onClick={event => {
                          if ((event.target as HTMLElement).closest("a, button")) return;
                          navigate(`/admin/products/${row.id}`);
                        }}
                        className={`cursor-pointer border-b border-[#f0f2f6] last:border-b-0 hover:bg-[#0a285a]/[.06] ${selected.has(row.id) ? "bg-[#0a285a]/[.04]" : ""}`}
                      >
                        {mayBulk ? (
                          <td className="w-12 ps-4 py-3">
                            <PickBox checked={selected.has(row.id)} onChange={() => toggle(row.id)} label={t("admin.selectProduct", { title: row.title })} />
                          </td>
                        ) : null}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="size-11 shrink-0 overflow-hidden rounded-lg bg-[#f4f6f9]">
                              <Thumb src={cover} alt="" className="size-full object-cover" icon={<ImageOff className="size-4 text-[#536b8c]" />} />
                            </div>
                            <div className="min-w-0">
                              <Link href={`/admin/products/${row.id}`} dir="auto" className="line-clamp-1 font-bold text-[#0a285a] hover:underline">
                                {row.title}
                              </Link>
                              <p className="mt-0.5 text-[12px] ink-muted">
                                {row.variants.length === 1 ? t("admin.variantOne") : t("admin.variantCount", { count: row.variants.length })}
                                {row.variants[0]?.sku ? <> · <bdi>{row.variants[0].sku}</bdi></> : null}
                              </p>
                            </div>
                          </div>
                        </td>
                        {showVendor ? (
                          <td className="px-4 py-3">
                            {/* The store's own page, for whoever may open it. */}
                            {actor.kind === "admin" ? (
                              <Link href={`/admin/vendors/${row.vendorId}`} dir="auto" className="text-[#536b8c] hover:text-[#0a285a] hover:underline">
                                {row.vendorName ?? `#${row.vendorId}`}
                              </Link>
                            ) : <span dir="auto" className="text-[#536b8c]">{row.vendorName ?? `#${row.vendorId}`}</span>}
                          </td>
                        ) : null}
                        <td className="px-4 py-3 text-[#536b8c]">{departmentName(row.categoryName)}</td>
                        <td className="px-4 py-3"><StatusPill status={row.status} /></td>
                        <td className="px-4 py-3 text-end tabular-nums">
                          {stock === 0
                            ? <span className="font-semibold text-[#b3261e]">{t("admin.outOfStock")}</span>
                            : <span className="font-semibold text-[#0a285a]">{stock}</span>}
                        </td>
                        <td className="px-4 py-3 text-end font-semibold whitespace-nowrap">{cheapest ? money({ amount: cheapest, currencyCode: "KWD" }) : "—"}</td>
                        <td className="px-2 py-3 text-end">
                          {mayDelete ? <DeleteButton title={row.title} onClick={() => setDeleting({ id: row.id, title: row.title })} /> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {products.data ? <Pager page={products.data} onPage={setPage} /> : null}
          </>
        )}
      </div>

      <DeleteProductDialog
        product={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => setDeleting(null)}
      />

      {/* One dialog for every bulk act: it says how many, and asks for the
          one figure a price change or a stock receipt needs. */}
      <ConfirmDialog
        open={bulk !== null}
        title={
          bulk === "publish" ? t("admin.bulkPublishTitle", { count: selected.size })
            : bulk === "archive" ? t("admin.bulkArchiveTitle", { count: selected.size })
            : bulk === "draft" ? t("admin.bulkDraftTitle", { count: selected.size })
            : bulk === "reprice" ? t("admin.bulkRepriceTitle", { count: selected.size })
            : t("admin.bulkRestockTitle", { count: selected.size })
        }
        body={bulk === "reprice" ? t("admin.bulkRepriceBody") : bulk === "restock" ? t("admin.bulkRestockBody") : t("admin.bulkStatusBody")}
        confirmLabel={bulk === "publish" ? t("admin.publish") : bulk === "archive" ? t("admin.bulkArchive") : bulk === "draft" ? t("admin.bulkDraft") : t("admin.bulkApply")}
        pending={runBulk.isPending}
        confirmDisabled={fieldProblem !== null}
        onClose={() => setBulk(null)}
        onConfirm={confirmBulk}
      >
        {bulk === "reprice" ? (
          <label className="block">
            <span className="block text-[13px] font-semibold text-[#0a285a]">{t("admin.bulkPercent")}</span>
            <input dir="ltr" inputMode="decimal" value={percent} onChange={event => setPercent(event.target.value)} aria-invalid={fieldProblem !== null} aria-describedby="bulk-percent-hint" className={`${fieldClass} mt-1.5`} />
            <span id="bulk-percent-hint" className="mt-1.5 block text-[12px] leading-5 ink-muted">
              {fieldProblem ? t(fieldProblem) : t("admin.bulkPercentHint", { example: money({ amount: scalePrice("10.000", percentValue), currencyCode: "KWD" }) })}
            </span>
          </label>
        ) : bulk === "restock" ? (
          <label className="block">
            <span className="block text-[13px] font-semibold text-[#0a285a]">{t("admin.bulkAmount")}</span>
            <input dir="ltr" inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} aria-invalid={fieldProblem !== null} aria-describedby="bulk-amount-hint" className={`${fieldClass} mt-1.5`} />
            {fieldProblem ? <span id="bulk-amount-hint" className="mt-1.5 block text-[12px] leading-5 text-[#8c2f22]">{t(fieldProblem)}</span> : null}
          </label>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

/** A tick box named by what it selects, at a size a thumb can hit. */
function PickBox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg" onClick={event => event.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="size-[18px] cursor-pointer accent-[#0a285a]" />
    </label>
  );
}

/** A bin with the product's name as its own, so a screen reader hears which. */
function DeleteButton({ title, onClick }: { title: string; onClick: () => void }) {
  const { t } = useTranslation();
  const label = t("admin.deleteNamed", { title });
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-10 shrink-0 place-items-center rounded-lg text-[#536b8c] transition hover:bg-[#fdeceb] hover:text-[#8c2f22] focus-visible:outline-2 focus-visible:outline-[#0a285a]"
    >
      <Trash2 className="size-4" aria-hidden />
    </button>
  );
}
