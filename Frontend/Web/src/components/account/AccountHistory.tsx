/**
 * Browsing history: the products this device opened, newest first — kept on
 * the device (`lib/recentlyViewed.ts`), read back by id so each shows today's
 * photo and price. On the owner's word ("keep management in the account, less
 * prominent … view, remove individual, clear all"): the home page keeps
 * Previously viewed, and this is where one product comes off or all of them
 * do. Clear all asks first, because it empties the home shelf too.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { History, PackageSearch, X } from "lucide-react";
import { toast } from "sonner";
import { PANEL } from "@/components/account/profileParts";
import { EmptyState } from "@/components/layout/Page";
import { Thumb } from "@/components/product/Thumb";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useProductsByIds } from "@/hooks/useCatalog";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { clearViewed, forgetViewed, VIEWED_DAYS, viewedIds } from "@/lib/recentlyViewed";

export function AccountHistory() {
  const { t } = useTranslation();
  const money = useMoney();
  const [ids, setIds] = useState(() => viewedIds());
  const [asking, setAsking] = useState(false);
  const { byId, settled } = useProductsByIds(ids, { enabled: ids.length > 0 });
  const products = useMemo(() => ids.flatMap(id => byId.get(id) ?? []), [ids, byId]);
  const [status, setStatus] = useState("");

  const remove = (id: string, title: string) => {
    setIds(forgetViewed(id).map(entry => entry.id));
    setStatus(`${t("history.removed")} ${title}`);
  };
  const clear = () => {
    clearViewed();
    setIds([]);
    setAsking(false);
    toast(t("history.cleared"));
  };

  return (
    <div className="space-y-3">
      <p className="text-[14px] leading-6 ink-muted">{t("history.intro", { days: VIEWED_DAYS })}</p>
      {products.length === 0 && (settled || ids.length === 0) ? (
        <EmptyState heading="h3" icon={<History className="size-6" />} title={t("history.empty")} />
      ) : (
        <>
          <ul className={`${PANEL} divide-y divide-dashed divide-[#e3e6ec] px-4`}>
            {products.map(product => (
              <li key={product.id} className="flex min-h-[76px] items-center gap-3 py-2.5">
                <Link href={`/products/${product.handle}`} tabIndex={-1} aria-hidden className="shrink-0">
                  <Thumb src={product.images[0]?.url ?? null} alt="" className="size-14 rounded-xl border border-[#e7edf5] bg-white object-contain" icon={<PackageSearch className="size-5" />} />
                </Link>
                <span className="min-w-0 flex-1">
                  <Link href={`/products/${product.handle}`} dir="auto" className="line-clamp-2 text-[14px] font-bold text-[#0a285a] hover:underline">{product.title}</Link>
                  {product.variants[0] ? <span className="mt-0.5 block text-[13px] ink-muted">{money(product.variants[0].price)}</span> : null}
                </span>
                <button
                  type="button"
                  onClick={() => remove(product.id, product.title)}
                  aria-label={t("history.remove", { name: product.title })}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-[#536b8c] hover:bg-[#f0f2f5]"
                >
                  <X className="size-5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setAsking(true)} className="glass type-control pressable inline-flex min-h-11 items-center rounded-full px-4 py-2 pointer-fine:min-h-9">
            {t("history.clearAll")}
          </button>
        </>
      )}
      <p role="status" aria-live="polite" className="sr-only">{status}</p>
      <ConfirmDialog
        open={asking}
        title={t("history.clearAsk")}
        body={t("history.clearBody")}
        confirmLabel={t("history.clearAll")}
        tone="danger"
        onConfirm={clear}
        onClose={() => setAsking(false)}
      />
    </div>
  );
}
