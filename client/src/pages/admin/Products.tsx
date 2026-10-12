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
import { ImageOff, PackagePlus, Search, Trash2, Upload } from "lucide-react";
import { useState } from "react";
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
    { page, query: term || undefined, status: filter === "all" ? undefined : filter, vendorId: storeId },
    { placeholderData: previous => previous },
  );
  const chooseStore = (value: string) => {
    setPage(1);
    navigate(value ? `/admin/products?vendor=${value}` : "/admin/products", { replace: true });
  };

  const rows = products.data?.rows ?? [];
  const ownVendor = actor.kind === "vendor" ? actor.vendorId : undefined;
  const showVendor = new Set(rows.map(row => row.vendorId)).size > 1;
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
                      {showVendor && row.vendorName ? <p dir="auto" className="mt-0.5 truncate text-[12px] ink-muted">{row.vendorName}</p> : null}
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
                    <th scope="col" className="px-4 py-3 text-start font-semibold">{t("admin.columnProduct")}</th>
                    {showVendor ? <th scope="col" className="px-4 py-3 text-start font-semibold">{t("admin.columnVendor")}</th> : null}
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
                        className="cursor-pointer border-b border-[#f0f2f6] last:border-b-0 hover:bg-[#f7f9fc]"
                      >
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
    </>
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
