/**
 * A product's photos copied onto NetLet from the site its gallery points at
 * (`Backend/src/services/photoCopies.ts` is the server half and says why).
 *
 * Each photo is fetched by NetLet's server (`/api/media/copy/fetch`, named by
 * its gallery id — the browser never contacts the seller's host), shrunk and
 * re-encoded here by `preparePhoto` with the fixes off — the seller's framing
 * kept, only made a size NetLet stores — and handed back
 * (`/api/media/copy/:id`), which stores it and points the gallery photo at
 * it. Two at a time, so a page of products does not open a hundred
 * connections.
 *
 * **It never stops on one photo.** One that cannot be fetched or read stays
 * where it was and is counted; one already copied or changed meanwhile is
 * skipped; only the hourly ceiling stops the run, and the rest wait for later.
 */
import { preparePhoto } from "@/lib/preparePhoto";

export type CopyRun = {
  copied: number;
  /** Left where they were: unreachable, unreadable, too small, or after the ceiling. */
  kept: number;
  /** The ceiling's message key, when it was reached. */
  stoppedBy: string | null;
};

class Ceiling extends Error {}
class Gone extends Error {}

async function refusal(response: Response): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (response.status === 429) throw new Ceiling(body.error ?? "media.copyTooMany");
  if (response.status === 409) throw new Gone(body.error ?? "media.copyGone");
  throw new Error(body.error ?? "media.failed");
}

async function copyOne(imageId: number): Promise<boolean> {
  const fetched = await fetch("/api/media/copy/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageId }),
    credentials: "same-origin",
  });
  if (!fetched.ok) await refusal(fetched);
  const prepared = await preparePhoto(await fetched.blob(), false);
  if (typeof prepared === "string") return false;
  const stored = await fetch(`/api/media/copy/${imageId}`, {
    method: "POST",
    headers: { "Content-Type": prepared.type },
    body: prepared.blob,
    credentials: "same-origin",
  });
  if (!stored.ok) await refusal(stored);
  return true;
}

export async function copyPhotosToNetlet(imageIds: number[], onProgress: (done: number, total: number) => void): Promise<CopyRun> {
  const queue = [...new Set(imageIds)];
  const total = queue.length;
  let copied = 0;
  let skipped = 0;
  let done = 0;
  let stoppedBy: string | null = null;
  onProgress(0, total);
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined && !stoppedBy; id = queue.shift()) {
      try {
        if (await copyOne(id)) copied += 1;
      } catch (error) {
        if (error instanceof Ceiling) stoppedBy = error.message;
        else if (error instanceof Gone) skipped += 1;
      }
      done += 1;
      onProgress(done, total);
    }
  };
  await Promise.all([worker(), worker()]);
  return { copied, kept: total - copied - skipped, stoppedBy };
}
