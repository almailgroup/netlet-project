/**
 * Opening and keeping a product's catalogue (`Shared/inventory/productCatalogues.ts`).
 *
 * A file of up to 4 MB is its own address, opened in the browser's PDF viewer
 * in a new tab or saved by a link — a plain link, so a middle click, "open in
 * new tab" and "copy address" all work. A larger one cannot be: a Vercel
 * function's answer stops at about 4.5 MB unless it streams, so it is read in
 * parts and put together here, then shown from the browser's own copy. The
 * tab is opened at the press, before the parts are read, because a browser
 * lets a page open a tab only from the press itself.
 */
import { cataloguePartHref, partCount } from "@shared/inventory/productCatalogues";

/** The whole file, read part by part. */
export async function catalogueBlob(id: number, size: number): Promise<Blob> {
  const parts: ArrayBuffer[] = [];
  for (let part = 0; part < partCount(size); part += 1) {
    const response = await fetch(cataloguePartHref(id, part), { credentials: "same-origin" });
    if (!response.ok) throw new Error(`catalogue part ${part}: ${response.status}`);
    parts.push(await response.arrayBuffer());
  }
  const blob = new Blob(parts, { type: "application/pdf" });
  if (blob.size !== size) throw new Error("catalogue: the parts did not add up");
  return blob;
}

/** A browser's copy of the file is let go a minute after it is handed over. */
function release(url: string) {
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Open a large catalogue in a new tab. `tab` is the window opened at the
 * press; null means the browser refused it, and the caller says so.
 */
export async function viewLargeCatalogue(tab: Window, id: number, size: number) {
  try {
    const url = URL.createObjectURL(await catalogueBlob(id, size));
    tab.location.href = url;
    release(url);
  } catch (error) {
    tab.close();
    throw error;
  }
}

/** Save a large catalogue under its own name. */
export async function downloadLargeCatalogue(id: number, size: number, fileName: string) {
  const url = URL.createObjectURL(await catalogueBlob(id, size));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  release(url);
}
