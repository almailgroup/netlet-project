/**
 * The product's photos as "Generate with AI" sends them: the first
 * `MAX_IMAGES` uploaded to NetLet, each shrunk in the browser to a 768px JPEG
 * (`shrinkPhoto`, photo search's rule) — a model reading a label needs no more,
 * and three of them sit far under the gateway's body limit.
 *
 * Only an upload (`/media/…`) is sent. A photo added by its address lives on
 * somebody else's server, which this page cannot read without that server's
 * leave, and fetching it through NetLet is the manufacturer-image route's job,
 * not this one's. A photo that cannot be read or made small enough is left out
 * rather than failing the draft.
 */
import { shrinkPhoto } from "@/lib/shrinkPhoto";
import { MAX_IMAGES } from "@shared/ai/gateway";

export function isUploadedPhoto(url: string): boolean {
  return url.startsWith("/media/");
}

/** The photos that will be sent, in the gallery's order. */
export function draftPhotoUrls(urls: readonly string[]): string[] {
  return urls.filter(isUploadedPhoto).slice(0, MAX_IMAGES);
}

export async function photosForDraft(urls: readonly string[]): Promise<Blob[]> {
  const blobs: Blob[] = [];
  for (const url of draftPhotoUrls(urls)) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const shrunk = await shrinkPhoto(await response.blob());
      if (shrunk) blobs.push(fromDataUrl(shrunk));
    } catch {
      /* Left out: the notes and the other photos still make a draft. */
    }
  }
  return blobs;
}

function fromDataUrl(url: string): Blob {
  const comma = url.indexOf(",");
  const type = url.slice(5, url.indexOf(";"));
  const binary = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return new Blob([bytes], { type });
}
