/**
 * A product's catalogues, under the product on its page
 * (`Shared/inventory/productCatalogues.ts`): each PDF by its title in the
 * page's language, or its file's name, with its size, View and Download.
 * Nothing at all for a product with none — a heading over an empty list is
 * the shop describing itself.
 *
 * View opens the browser's own PDF viewer in a new tab and Download saves the
 * file, each a plain link where the file is small enough to be handed over
 * whole; a larger one is read in parts and put together first
 * (`lib/catalogueFile.ts`), the press saying "Getting the file…" meanwhile.
 * The visible word starts each accessible name ("View Lamp brochure"), so a
 * voice can say what it sees.
 */
import { useState } from "react";
import { Download, Eye, FileText, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { catalogueHref, catalogueName, readInParts } from "@shared/inventory/productCatalogues";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { useFileSize } from "@/lib/fileSize";
import { downloadLargeCatalogue, viewLargeCatalogue } from "@/lib/catalogueFile";
import { isolate } from "@/lib/isolate";

type Card = { id: number; title: string | null; titleAr: string | null; fileName: string; sizeBytes: number };

export function ProductCatalogues({ productId }: { productId: string }) {
  const { t, locale } = useTranslation();
  const list = trpc.catalogues.forProduct.useQuery({ productId }, { staleTime: 60_000 });
  const cards = list.data ?? [];
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="catalogue-title" className="mt-12">
      <h2 id="catalogue-title" className="text-xl font-extrabold text-[#0a285a] sm:text-2xl">{t("catalogue.heading")}</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(card => (
          <li key={card.id} className="min-w-0">
            <CatalogueCard card={card} name={catalogueName(card, locale)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One catalogue: what it is, how big, and the two ways to have it. */
export function CatalogueCard({ card, name, children }: { card: Card; name: string; children?: React.ReactNode }) {
  const { t } = useTranslation();
  const size = useFileSize();
  return (
    <div className="flex h-full flex-col gap-3 rounded-2xl border border-[#e2e7ef] bg-white p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#eef1f6] text-[#0a285a]">
          <FileText className="size-6" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <p dir="auto" className="line-clamp-2 break-words font-bold leading-snug text-[#0a285a]">{name}</p>
          {/* The size isolated, or on the Arabic page the Latin "PDF" pulls its number into its own run and the line reads backwards. */}
          <p className="mt-0.5 text-xs text-[#536b8c]">{t("catalogue.fileKind", { size: isolate(size(card.sizeBytes)) })}</p>
        </div>
      </div>
      {children}
      <CatalogueActions card={card} name={name} />
    </div>
  );
}

const BUTTON = "pressable inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full px-4 whitespace-nowrap pointer-fine:min-h-10";

/** View and Download: links for a file handed over whole, presses that put a larger one together first. */
export function CatalogueActions({ card, name }: { card: Card; name: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<"view" | "download" | null>(null);
  const large = readInParts(card.sizeBytes);
  const viewLabel = t("catalogue.viewName", { name });
  const downloadLabel = t("catalogue.downloadName", { name });

  if (!large) {
    return (
      <div className="flex gap-2">
        <a className={`glass glass-navy ${BUTTON}`} href={catalogueHref(card.id)} target="_blank" rel="noopener" aria-label={viewLabel}>
          <Eye className="size-4" aria-hidden="true" />
          {t("catalogue.view")}
        </a>
        <a className={`glass border border-[#0a285a]/15 text-[#0a285a] ${BUTTON}`} href={catalogueHref(card.id, true)} download={card.fileName} aria-label={downloadLabel}>
          <Download className="size-4" aria-hidden="true" />
          {t("catalogue.download")}
        </a>
      </div>
    );
  }

  const view = async () => {
    /* Opened at the press, or the browser refuses it once the parts are in. */
    const tab = window.open("", "_blank");
    if (!tab) { toast.error(t("catalogue.popupBlocked")); return; }
    setBusy("view");
    try {
      await viewLargeCatalogue(tab, card.id, card.sizeBytes);
    } catch {
      toast.error(t("catalogue.openFailed"));
    } finally {
      setBusy(null);
    }
  };
  const download = async () => {
    setBusy("download");
    try {
      await downloadLargeCatalogue(card.id, card.sizeBytes, card.fileName);
    } catch {
      toast.error(t("catalogue.openFailed"));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex gap-2">
      <span className="sr-only" role="status">{busy ? t("catalogue.preparing") : ""}</span>
      <button type="button" className={`glass glass-navy ${BUTTON} disabled:opacity-60`} onClick={() => void view()} disabled={busy !== null} aria-label={viewLabel} aria-busy={busy === "view"}>
        {busy === "view" ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        {t("catalogue.view")}
      </button>
      <button type="button" className={`glass border border-[#0a285a]/15 text-[#0a285a] ${BUTTON} disabled:opacity-60`} onClick={() => void download()} disabled={busy !== null} aria-label={downloadLabel} aria-busy={busy === "download"}>
        {busy === "download" ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
        {t("catalogue.download")}
      </button>
    </div>
  );
}
