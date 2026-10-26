/**
 * A spreadsheet's photos, fixed on the way in (3.3.4: the automatic fixes an
 * upload gets "apply to bulk uploads" too).
 *
 * A file carries photos as addresses. Each one is fetched through NetLet's
 * server (`/api/media/remote` — the browser never contacts somebody else's
 * host, the rule the maker's-page import follows), prepared by
 * `preparePhoto` with the fixes on, and uploaded like any photo, with its
 * address recorded as the source. What comes back is the address to write
 * instead.
 *
 * **It never stops an import.** A photo that cannot be fetched or read keeps
 * its address, as it always did; and once a ceiling answers 429 — 150 fetches
 * and 200 uploads an account an hour — the rest keep theirs too, and the page
 * says how many. Two at a time, so a file of four hundred rows does not open
 * four hundred connections.
 */
import { preparePhoto } from "@/lib/preparePhoto";

export type ImportPhotoRun = {
  /** Original address → the fixed photo's `/media/...` path. */
  replaced: Map<string, string>;
  /** Addresses kept as they were: unreadable, unreachable, or after a ceiling. */
  kept: number;
  /** The ceiling's message key, when one was reached. */
  stoppedBy: string | null;
};

class Ceiling extends Error {}

/** One image through NetLet's server, which is the only thing allowed to go and fetch it. */
export async function fetchRemotePhoto(url: string): Promise<Blob> {
  const response = await fetch("/api/media/remote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    credentials: "same-origin",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.status === 429) throw new Ceiling(body.error ?? "manufacturer.tooMany");
    throw new Error(body.error ?? "manufacturer.unreachable");
  }
  return response.blob();
}

async function fixOne(url: string): Promise<string | null> {
  const prepared = await preparePhoto(await fetchRemotePhoto(url), true);
  if (typeof prepared === "string") return null;
  const response = await fetch("/api/media", {
    method: "POST",
    headers: { "Content-Type": prepared.type, "X-NetLet-Source": url },
    body: prepared.blob,
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (response.status === 429) throw new Ceiling(body.error ?? "media.tooMany");
  return response.ok && body.url ? body.url : null;
}

export async function fixImportPhotos(urls: string[], onProgress: (done: number, total: number) => void): Promise<ImportPhotoRun> {
  const unique = [...new Set(urls.filter(url => /^https:\/\//i.test(url)))];
  const replaced = new Map<string, string>();
  let stoppedBy: string | null = null;
  let done = 0;
  onProgress(0, unique.length);

  const queue = [...unique];
  const worker = async () => {
    for (let url = queue.shift(); url !== undefined && !stoppedBy; url = queue.shift()) {
      try {
        const fixed = await fixOne(url);
        if (fixed) replaced.set(url, fixed);
      } catch (error) {
        if (error instanceof Ceiling) stoppedBy = error.message;
      }
      done += 1;
      onProgress(done, unique.length);
    }
  };
  await Promise.all([worker(), worker()]);
  return { replaced, kept: unique.length - replaced.size, stoppedBy };
}
