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
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { StatusPill } from "@/components/dashboard/StatusPill";
import { trpc } from "@/lib/trpc";
import { useMoney, useTranslation } from "@/lib/useTranslation";
import { usePageMeta } from "@/lib/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { can, type Actor } from "@shared/inventory/permissions";
import { LoaderCircle, PackagePlus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function DashboardProducts() {
  usePageMeta(privatePageMeta("Dashboard"));
  return <DashboardShell>{actor => <ProductTable actor={actor} />}</DashboardShell>;
}

function ProductTable({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const money = useMoney();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const utils = trpc.useUtils();

  const products = trpc.inventory.products.list.useQuery({});
  const create = trpc.inventory.products.create.useMutation({
    onSuccess: row => {
      void utils.inventory.products.list.invalidate();
      navigate(`/dashboard/products/${row.id}`);
    },
    onError: error => toast.error(error.message === "product.create" ? t("dash.forbidden") : t("dash.saveFailed")),
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = products.data ?? [];
    if (!term) return all;
    return all.filter(row => row.title.toLowerCase().includes(term) || row.handle.includes(term));
  }, [products.data, search]);

  // Only worth a column when the answer differs between rows.
  const showVendor = new Set((products.data ?? []).map(row => row.vendorId)).size > 1;
  const mayCreate = can(actor, "product.create", actor.kind === "vendor" ? actor.vendorId : undefined);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold">{t("dash.products")}</h1>
        {mayCreate && actor.kind === "vendor" ? (
          <button
            onClick={() => create.mutate({ vendorId: actor.vendorId, title: t("dash.newProduct") })}
            disabled={create.isPending}
            className="glass glass-navy pressable inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-extrabold disabled:opacity-60"
          >
            {create.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
            {t("dash.newProduct")}
          </button>
        ) : null}
      </div>

      <label className="glass-field mt-4 flex h-10 items-center gap-2 rounded-xl px-3">
        <Search className="size-4 shrink-0 text-[#778ba6]" aria-hidden />
        <input
          value={search}
          onChange={event => setSearch(event.target.value)}
          aria-label={t("dash.searchProducts")}
          placeholder={t("dash.searchProducts")}
          className="w-full bg-transparent text-[13px] outline-none"
        />
      </label>

      {products.isLoading ? (
        <p className="mt-6 text-sm text-[#536b8c]">{t("dash.loading")}</p>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
          <p className="text-sm font-extrabold">{t(search ? "dash.noMatches" : "dash.noProducts")}</p>
          {!search ? <p className="mx-auto mt-2 max-w-xs text-[13px] leading-6 text-[#536b8c]">{t("dash.noProductsNote")}</p> : null}
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-[#e6e9ef] bg-white">
          <table className="w-full min-w-[620px] text-start text-[13px]">
            <thead className="border-b border-[#e6e9ef] text-[11px] uppercase tracking-[.08em] text-[#778ba6]">
              <tr>
                <th className="px-4 py-3 text-start font-bold">{t("dash.columnProduct")}</th>
                {showVendor ? <th className="px-4 py-3 text-start font-bold">{t("dash.columnVendor")}</th> : null}
                <th className="px-4 py-3 text-start font-bold">{t("dash.columnStatus")}</th>
                <th className="px-4 py-3 text-start font-bold">{t("dash.columnStock")}</th>
                <th className="px-4 py-3 text-start font-bold">{t("dash.columnPrice")}</th>
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
                    onClick={() => navigate(`/dashboard/products/${row.id}`)}
                    className="cursor-pointer border-b border-[#f0f2f6] last:border-b-0 hover:bg-[#f7f9fc]"
                  >
                    <td className="px-4 py-3">
                      <p dir="auto" className="font-bold text-[#0a285a]">{row.title}</p>
                      <p className="mt-0.5 text-[11px] text-[#9ea4b5]">
                        {row.variants.length === 1 ? t("dash.variantOne") : t("dash.variantCount", { count: row.variants.length })}
                      </p>
                    </td>
                    {showVendor ? <td className="px-4 py-3 text-[#536b8c]">#{row.vendorId}</td> : null}
                    <td className="px-4 py-3"><StatusPill status={row.status} /></td>
                    <td className="px-4 py-3">
                      <span className={stock === 0 ? "font-bold text-[#e61c38]" : "font-bold text-[#0a285a]"}>{stock}</span>
                      {stock === 0 ? <span className="ms-2 text-[11px] text-[#e61c38]">{t("dash.outOfStock")}</span> : null}
                    </td>
                    <td className="px-4 py-3 font-bold">{cheapest ? money({ amount: cheapest, currencyCode: "KWD" }) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
