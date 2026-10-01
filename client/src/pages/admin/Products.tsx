/**
 * The product list — the page a vendor lives on.
 *
 * Scope is not decided here. `products.list` returns one vendor's rows or
 * every vendor's depending on who asks, so this renders whatever it is given
 * and the vendor column only appears when there is more than one vendor in the
 * result — which is exactly when it carries information.
 *
 * Stock is summed across variants and shown against the total, because "3 of 4
 * variants are empty" is what a vendor needs to see from a list, and the per
 * variant figure is one click away.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { Pager } from "@/components/admin/Pager";
import { StatusPill } from "@/components/admin/StatusPill";
import { trpc } from "@/lib/trpc";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { can, type Actor } from "@shared/inventory/permissions";
import { LoaderCircle, PackagePlus, Search } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function AdminProducts() {
  usePageMeta(privatePageMeta("Admin"));
  return <AdminShell need="product.view">{actor => <ProductTable actor={actor} />}</AdminShell>;
}

function ProductTable({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const money = useMoney();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const utils = trpc.useUtils();

  const [page, setPage] = useState(1);
  /*
   * The search term goes to the server, so stepping to page three and typing
   * still searches the whole catalog. Changing it resets to page one, or a
   * narrowed list would open on a page that no longer exists.
   */
  const term = search.trim();
  const products = trpc.inventory.products.list.useQuery(
    { page, query: term || undefined },
    { placeholderData: previous => previous },
  );
  /*
   * A product belongs to a vendor, and an admin is not one — so an admin has
   * to say which. Vendors see no picker: there is only ever one answer for
   * them, and asking would be a question with a single option.
   */
  const vendors = trpc.inventory.vendors.list.useQuery({ pageSize: 200 }, { enabled: actor.kind === "admin" });
  const [chosenVendor, setChosenVendor] = useState("");
  const create = trpc.inventory.products.create.useMutation({
    onSuccess: row => {
      void utils.inventory.products.list.invalidate();
      navigate(`/admin/products/${row.id}`);
    },
    onError: error => toast.error(error.message === "product.create" ? t("admin.forbidden") : t("admin.saveFailed")),
  });

  const rows = products.data?.rows ?? [];

  // Only worth a column when the answer differs between rows.
  const showVendor = new Set(rows.map(row => row.vendorId)).size > 1;
  const mayCreate = can(actor, "product.create", actor.kind === "vendor" ? actor.vendorId : undefined);

  /**
   * Which vendor a new product would belong to, or null when there is none.
   *
   * A vendor member: their own, always. An admin: whichever they picked, or
   * the first — which on a fresh install is the house vendor the seed writes,
   * so the common case needs no choice at all. Null only when the vendor table
   * is genuinely empty, and then the button is replaced by the reason.
   */
  const newProductVendorId =
    actor.kind === "vendor"
      ? actor.vendorId
      : Number(chosenVendor) || vendors.data?.rows?.[0]?.id || null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold">{t("admin.products")}</h1>
        {mayCreate ? (
          <div className="flex flex-wrap items-center gap-2">
            {/* More than one vendor is the only case where the choice is real. */}
            {actor.kind === "admin" && (vendors.data?.rows ?? []).length > 1 ? (
              <label className="text-[11px] font-extrabold text-[#536b8c]">
                {t("admin.productVendor")}
                <select
                  value={chosenVendor || String(vendors.data?.rows?.[0]?.id ?? "")}
                  onChange={event => setChosenVendor(event.target.value)}
                  className="type-body ms-2 h-10 rounded-xl border border-[#d5dfeb] bg-white px-2.5 text-[12px] text-[#0a285a] outline-none focus:border-[#f2683a]"
                >
                  {(vendors.data?.rows ?? []).map(vendor => (
                    <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                  ))}
                </select>
              </label>
            ) : null}

            {newProductVendorId === null ? (
              <p className="text-[12px] font-semibold text-[#8c2f22]">{t("admin.needVendorFirst")}</p>
            ) : (
              <button
                onClick={() => create.mutate({ vendorId: newProductVendorId, title: t("admin.newProduct") })}
                disabled={create.isPending}
                className="glass glass-navy pressable inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-extrabold disabled:opacity-60"
              >
                {create.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
                {t("admin.newProduct")}
              </button>
            )}
          </div>
        ) : null}
      </div>

      <label className="glass-field mt-4 flex h-10 items-center gap-2 rounded-xl px-3">
        <Search className="size-4 shrink-0 ink-muted" aria-hidden />
        <input
          value={search}
          onChange={event => { setSearch(event.target.value); setPage(1); }}
          aria-label={t("admin.searchProducts")}
          placeholder={t("admin.searchProducts")}
          className="w-full bg-transparent text-[13px] outline-none"
        />
      </label>

      {products.isLoading || products.isError ? (
        <div className="mt-6"><QueryGate queries={[products]}>{() => null}</QueryGate></div>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
          <p className="text-sm font-extrabold">{t(search ? "admin.noMatches" : "admin.noProducts")}</p>
          {!search ? <p className="mx-auto mt-2 max-w-xs text-[13px] leading-6 text-[#536b8c]">{t("admin.noProductsNote")}</p> : null}
        </div>
      ) : (
        /* A region a keyboard can reach, like the finance tables: below 620px
           the table scrolls sideways, and a box only a mouse can drag hides
           the status and price columns from anybody without one. */
        <div tabIndex={0} role="region" aria-label={t("admin.products")} className="mt-5 overflow-x-auto rounded-2xl border border-[#e6e9ef] bg-white">
          <table className="w-full min-w-[620px] text-start text-[13px]">
            <thead className="border-b border-[#e6e9ef] text-[11px] uppercase tracking-[.08em] ink-muted">
              <tr>
                <th className="px-4 py-3 text-start font-bold">{t("admin.columnProduct")}</th>
                {showVendor ? <th className="px-4 py-3 text-start font-bold">{t("admin.columnVendor")}</th> : null}
                <th className="px-4 py-3 text-start font-bold">{t("admin.columnStatus")}</th>
                <th className="px-4 py-3 text-start font-bold">{t("admin.columnStock")}</th>
                <th className="px-4 py-3 text-start font-bold">{t("admin.columnPrice")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const stock = row.variants.reduce((total, variant) => total + variant.stock, 0);
                const cheapest = row.variants.reduce<string | null>(
                  (low, variant) => (low === null || Number(variant.price) < Number(low) ? variant.price : low), null);
                return (
                  <tr
                    key={row.id}
                    onClick={() => navigate(`/admin/products/${row.id}`)}
                    className="cursor-pointer border-b border-[#f0f2f6] last:border-b-0 hover:bg-[#f7f9fc]"
                  >
                    <td className="px-4 py-3">
                      <p dir="auto" className="font-bold text-[#0a285a]">{row.title}</p>
                      <p className="mt-0.5 text-[11px] ink-muted">
                        {row.variants.length === 1 ? t("admin.variantOne") : t("admin.variantCount", { count: row.variants.length })}
                      </p>
                    </td>
                    {showVendor ? <td className="px-4 py-3 text-[#536b8c]">#{row.vendorId}</td> : null}
                    <td className="px-4 py-3"><StatusPill status={row.status} /></td>
                    <td className="px-4 py-3">
                      <span className={stock === 0 ? "font-bold text-[#e61c38]" : "font-bold text-[#0a285a]"}>{stock}</span>
                      {stock === 0 ? <span className="ms-2 text-[11px] text-[#e61c38]">{t("admin.outOfStock")}</span> : null}
                    </td>
                    <td className="px-4 py-3 font-bold">{cheapest ? money({ amount: cheapest, currencyCode: "KWD" }) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {products.data ? <Pager page={products.data} onPage={setPage} /> : null}
        </div>
      )}
    </>
  );
}
