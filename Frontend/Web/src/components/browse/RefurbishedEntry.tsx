/**
 * The way into the refurbished section from the Categories page and the
 * home page, on the owner's word ("a section for used products, completely
 * separate from the new products"). Drawn only while something refurbished
 * is on sale, so it never leads to an empty page; the section is a shop of
 * its own (`/refurbished`), never a department of the new one.
 */
import { ChevronRight, Recycle } from "lucide-react";
import { Link, useLocation } from "wouter";
import { TabbedShelf } from "@/components/home/ProductShelf";
import { useCatalog, useRefurbishedSummary } from "@/hooks/useCatalog";
import { useTranslation } from "@/hooks/useTranslation";
import { REFURBISHED_PATH } from "@/lib/refurbished";
import type { Product } from "@shared/commerce/types";

/** Below this a strip of refurbished products reads as a broken shelf — the home shelves' floor. */
const SHELF_FLOOR = 4;

/** A card the width of the page: what the section is, how many it holds, and the way in. */
export function RefurbishedEntry({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const total = useRefurbishedSummary().data?.total ?? 0;
  if (total === 0) return null;
  return (
    <Link
      href={REFURBISHED_PATH}
      className={`group flex items-center gap-4 rounded-2xl border border-[#d7e7df] tint-on-hover bg-[#f1f8f4] p-4 text-[#1f4d36] sm:p-5 ${className}`}
    >
      <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white text-[#1f4d36]">
        <Recycle className="size-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-extrabold">{t("refurbished.title")}</span>
        <span className="mt-0.5 block text-[14px] leading-5">{t("refurbished.entryNote")}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 rtl:-scale-x-100" aria-hidden />
    </Link>
  );
}

/** The home page's refurbished shelf: a strip of its own under its own name, never mixed into the new shop's. */
export function RefurbishedShelf({ saved, onSave, onQuickView }: {
  saved: string[];
  onSave: (id: string, title: string) => void;
  onQuickView: (product: Product) => void;
}) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const shelf = useCatalog(24, { refurbished: true });
  const products = shelf.data ?? [];
  if (products.length < SHELF_FLOOR) return null;
  return (
    <TabbedShelf
      id="refurbished"
      title="refurbished.title"
      note={t("refurbished.shelfNote")}
      products={products}
      layout="rail"
      onViewAll={() => navigate(REFURBISHED_PATH)}
      saved={saved}
      onSave={onSave}
      onQuickView={onQuickView}
    />
  );
}
