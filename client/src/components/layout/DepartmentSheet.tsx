/**
 * The departments, as a side sheet on a phone.
 *
 * It was opened by a hamburger in the home page's top bar, and by the bottom
 * bar's Browse tab on the home page only — everywhere else Browse went to the
 * whole catalogue. The top bar no longer repeats the bottom one, so this is
 * Browse's on every page now, and Browse means the same thing wherever it is
 * pressed.
 *
 * Each department is a link, so it can be long-pressed and opened elsewhere.
 * Portalled to `<body>` for the reason every overlay opened from a bar is.
 */
import { DepartmentIcon } from "@/components/browse/DepartmentIcon";
import { categoryRail } from "@/content/homeLayout";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { categorySlug } from "@shared/commerce/browse";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { Link } from "wouter";

export function DepartmentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  useOverlay(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="netlet-menu-scrim fixed inset-0 z-50 bg-[#061b3b]/30 backdrop-blur-sm lg:hidden" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="department-sheet-title"
        className="netlet-menu-panel h-full w-[82%] max-w-sm overflow-y-auto bg-[#f3f2ed] px-5 py-6 shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="department-sheet-title" className="text-lg font-extrabold text-[#0a285a]">{t("nav.allDepartments")}</h2>
          <button onClick={onClose} aria-label={t("header.closeMenu")} title={t("header.closeMenu")} className="glass pressable grid size-11 shrink-0 place-items-center rounded-full">
            <X className="size-5" />
          </button>
        </div>
        <ul className="mt-6 space-y-1.5">
          {categoryRail.map(category => (
            <li key={category.query}>
              <Link
                href={`/category/${categorySlug(category.query)}`}
                onClick={onClose}
                className="glass pressable flex w-full items-center gap-3 rounded-xl px-4 py-4 text-start text-sm font-bold"
              >
                <DepartmentIcon query={category.query} className="size-4 shrink-0 text-[#536b8c]" />
                {t(category.key)}
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    </div>,
    document.body,
  );
}
