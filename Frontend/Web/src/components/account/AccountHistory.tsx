/**
 * Browsing history: the products this device opened, newest first — kept on
 * the device (`lib/recentlyViewed.ts`), read back by id so each shows today's
 * photo and price. On the owner's word ("keep management in the account, less
 * prominent … view, remove individual, clear all"): the home page keeps
 * Previously viewed, and this is where one product comes off or all of them
 * do.
 *
 * **Several come off at once, on the owner's word** ("select multiple
 * products to delete … or select all to delete"): a circle on each row and
 * All above the list — the cart's and Saved's circles (`ChoiceCircle`) — and
 * Delete (n), which asks first because it empties the home shelf of them
 * too. All chosen is clearing the history, and says so.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { History, PackageSearch, Trash2, X } from "lucide-react";
import { ChoiceCircle } from "@/components/cart/ChoiceCircle";
import { toast } from "sonner";
import { PANEL } from "@/components/account/profileParts";
import { EmptyState } from "@/components/layout/Page";
import { Thumb } from "@/components/product/Thumb";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useProductsByIds } from "@/hooks/useCatalog";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { clearViewed, forgetViewed, VIEWED_DAYS, viewedIds } from "@/lib/recentlyViewed";
import { useConfirmRemoval } from "@/components/ui/ConfirmRemoval";
import { isolate } from "@/lib/isolate";

export function AccountHistory() {
  const { t } = useTranslation();
  const ask = useConfirmRemoval();
  const money = useMoney();
  const [ids, setIds] = useState(() => viewedIds());
  const [asking, setAsking] = useState(false);
  const { byId, settled } = useProductsByIds(ids, { enabled: ids.length > 0 });
  const products = useMemo(() => ids.flatMap(id => byId.get(id) ?? []), [ids, byId]);
  const [status, setStatus] = useState("");
  /* The products chosen for Delete (n). */
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const picked = products.filter(product => chosen.has(product.id));
  const allState = picked.length === 0 ? "none" : picked.length === products.length ? "all" : "some";
  const choose = (id: string, next: boolean) => setChosen(previous => {
    const after = new Set(previous);
    if (next) after.add(id); else after.delete(id);
    return after;
  });

  const remove = (id: string, title: string) => {
    setIds(forgetViewed(id).map(entry => entry.id));
    setChosen(previous => { const after = new Set(previous); after.delete(id); return after; });
    setStatus(`${t("history.removed")} ${title}`);
  };
  /* What was chosen, or — every one chosen — the whole history. */
  const removeChosen = () => {
    if (allState === "all") {
      clearViewed();
      setIds([]);
      toast(t("history.cleared"));
    } else {
      setIds(forgetViewed(picked.map(product => product.id)).map(entry => entry.id));
      toast(t("history.removed"));
    }
    setChosen(new Set());
    setAsking(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-[14px] leading-6 ink-muted">{t("history.intro", { days: VIEWED_DAYS })}</p>
      {products.length === 0 && (settled || ids.length === 0) ? (
        <EmptyState heading="h3" icon={<History className="size-6" />} title={t("history.empty")} />
      ) : (
        <>
          {/* All, and Delete (n) for what is chosen. */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center">
              <ChoiceCircle
                state={allState}
                label={t("select.all")}
                onToggle={next => setChosen(next ? new Set(products.map(product => product.id)) : new Set())}
                className="-ms-2.5 pointer-fine:-ms-1.5"
              />
              <span aria-hidden className="text-[14px] font-bold text-[#0a285a]">{t("cart.chooseAll")}</span>
            </div>
            {picked.length ? (
              <button
                type="button"
                onClick={() => setAsking(true)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[#b3261e]/30 bg-white px-4 text-[13px] font-bold text-[#8c2f22] hover:bg-[#fdeceb]"
              >
                <Trash2 className="size-4" aria-hidden />{t("history.deleteChosen", { count: picked.length })}
              </button>
            ) : null}
          </div>
          <ul className={`${PANEL} divide-y divide-dashed divide-[#e3e6ec] px-4`}>
            {products.map(product => (
              <li key={product.id} className="flex min-h-[76px] items-center gap-3 py-2.5">
                <ChoiceCircle
                  state={chosen.has(product.id) ? "all" : "none"}
                  label={t("select.item", { name: product.title })}
                  onToggle={next => choose(product.id, next)}
                  className="-ms-2.5 pointer-fine:-ms-1.5"
                />
                <Link href={`/products/${product.handle}`} tabIndex={-1} aria-hidden className="shrink-0">
                  <Thumb src={product.images[0]?.url ?? null} alt="" className="size-14 rounded-xl border border-[#e7edf5] bg-white object-contain" icon={<PackageSearch className="size-5" />} />
                </Link>
                <span className="min-w-0 flex-1">
                  <Link href={`/products/${product.handle}`} dir="auto" className="line-clamp-2 text-[14px] font-bold text-[#0a285a] hover:underline">{product.title}</Link>
                  {product.variants[0] ? <span className="mt-0.5 block text-[13px] ink-muted">{money(product.variants[0].price)}</span> : null}
                </span>
                <button
                  type="button"
                  onClick={() => void ask({ title: t("remove.historyTitle"), body: t("remove.historyBody", { name: isolate(product.title) }) }).then(sure => { if (sure) remove(product.id, product.title); })}
                  aria-label={t("history.remove", { name: product.title })}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-[#536b8c] hover:bg-[#f0f2f5]"
                >
                  <X className="size-5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p role="status" aria-live="polite" className="sr-only">{status}</p>
      <ConfirmDialog
        open={asking}
        title={t(allState === "all" ? "history.clearAsk" : "history.deleteAsk")}
        body={t(allState === "all" ? "history.clearBody" : "history.deleteBody")}
        confirmLabel={allState === "all" ? t("history.clearAll") : t("history.deleteChosen", { count: picked.length })}
        tone="danger"
        onConfirm={removeChosen}
        onClose={() => setAsking(false)}
      />
    </div>
  );
}
