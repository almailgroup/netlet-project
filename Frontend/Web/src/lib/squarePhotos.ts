/**
 * A product's gallery photos made square by NetLet AI, with nothing cut off
 * (`Backend/src/services/photoCopies.ts` is the server half and says why), on
 * the owner's word: "fix the product images that are already added … all
 * images should be square for the product cards … use NetLet's AI".
 *
 * Each photo is read here — NetLet's own straight from `/media`, another
 * site's through NetLet's server (`/api/media/copy/fetch`, so the browser
 * never contacts the seller's host) — and a photo already square is left as
 * it is. The rest are shrunk to a size the model takes, drawn square
 * (`/api/media/square/draw/:id`), prepared like any upload — padded rather
 * than cut, should the model keep the photo's shape — and stored in the
 * photo's place (`/api/media/square/:id`), naming the address that was
 * squared so a photo changed meanwhile is left alone. Two at a time.
 *
 * **It never stops on one photo**, the copy's rule: one that cannot be read
 * or drawn stays as it was and is counted; only the hourly ceiling stops the
 * run. Every photo squared is reported with the address it replaced, so the
 * dialog can offer to put it back.
 */
import { preparePhoto } from "@/lib/preparePhoto";
import { isMediaPath } from "@shared/commerce/media";
import { isSquareEnough } from "@shared/commerce/aiImages";

export type SquareTarget = { imageId: number; url: string; productTitle: string };
export type Squared = SquareTarget & { after: string };
export type SquareRun = {
  squared: Squared[];
  /** Already square: nothing was drawn. */
  alreadySquare: number;
  /** Left as they were: unreadable, refused by the model, changed meanwhile, or after the ceiling. */
  kept: number;
  /** The ceiling's or the switch's message key, when one stopped the run. */
  stoppedBy: string | null;
  /** Why the last photo kept as it was could not be squared: said in the dialog, so "could not" has a reason. */
  lastProblem: string | null;
  /** Whether NetLet AI drew them, or each was squared on its own edge colours in this browser. */
  withAi: boolean;
};

/** The longest edge sent to the model: a card's picture, well under the gateway's photo limit. */
const DRAW_EDGE = 1024;

class Stop extends Error {}

/**
 * The reasons every photo after this one would be refused alike: the hour
 * spent, NetLet AI switched off, or Google refusing the image model itself
 * (no allowance on the project, or a key it will not use). One photo the
 * model could not draw is that photo's alone, and the run goes on: a 503 for
 * "that did not work" once stopped a whole run on its first photo, and the
 * other 72 were counted as kept without being tried.
 */
const STOPS = new Set(["drawing.off", "drawing.tooMany", "drawing.googleQuota", "drawing.googleRefused", "media.copyTooMany"]);

async function refusal(response: Response): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  const reason = body.error ?? "drawing.failed";
  if (response.status === 429 || STOPS.has(reason)) throw new Stop(reason);
  throw new Error(reason);
}

async function readPhoto(target: SquareTarget): Promise<Blob> {
  const response = isMediaPath(target.url)
    ? await fetch(target.url, { credentials: "same-origin" })
    : await fetch("/api/media/copy/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: target.imageId }),
        credentials: "same-origin",
      });
  if (!response.ok) await refusal(response);
  return response.blob();
}

/** The photo at most `DRAW_EDGE` on its long side, as a JPEG the model takes. */
async function forDrawing(bitmap: ImageBitmap): Promise<Blob> {
  const scale = Math.min(1, DRAW_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("media.notAnImage");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.86));
  if (!blob) throw new Error("media.notAnImage");
  return blob;
}

async function squareOne(target: SquareTarget, withAi: boolean): Promise<string | "already"> {
  const original = await readPhoto(target);
  const bitmap = await createImageBitmap(original);
  try {
    if (isSquareEnough(bitmap.width, bitmap.height)) return "already";
    /* Without NetLet AI, the photo itself padded on its own edge colours, never cut. */
    let square: Blob = original;
    if (withAi) {
      const sent = await forDrawing(bitmap);
      const drawn = await fetch(`/api/media/square/draw/${target.imageId}`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: sent,
        credentials: "same-origin",
      });
      if (!drawn.ok) await refusal(drawn);
      square = await drawn.blob();
    }
    const prepared = await preparePhoto(square, false, { square: true });
    if (typeof prepared === "string") throw new Error(prepared);
    const stored = await fetch(`/api/media/square/${target.imageId}`, {
      method: "POST",
      headers: { "Content-Type": prepared.type, "X-NetLet-Was": encodeURIComponent(target.url) },
      body: prepared.blob,
      credentials: "same-origin",
    });
    if (!stored.ok) await refusal(stored);
    const body = (await stored.json()) as { url: string };
    return body.url;
  } finally {
    bitmap.close();
  }
}

export async function squarePhotos(targets: SquareTarget[], onProgress: (done: number, total: number) => void, options: { withAi?: boolean } = {}): Promise<SquareRun> {
  const withAi = options.withAi ?? true;
  const seen = new Set<number>();
  const queue = targets.filter(target => !seen.has(target.imageId) && seen.add(target.imageId));
  const total = queue.length;
  const run: SquareRun = { squared: [], alreadySquare: 0, kept: 0, stoppedBy: null, lastProblem: null, withAi };
  let done = 0;
  onProgress(0, total);
  const worker = async () => {
    for (let target = queue.shift(); target && !run.stoppedBy; target = queue.shift()) {
      try {
        const after = await squareOne(target, withAi);
        if (after === "already") run.alreadySquare += 1;
        else run.squared.push({ ...target, after });
      } catch (error) {
        if (error instanceof Stop) run.stoppedBy = error.message;
        else run.lastProblem = error instanceof Error ? error.message : "drawing.failed";
        run.kept += 1;
      }
      done += 1;
      onProgress(done, total);
    }
  };
  await Promise.all([worker(), worker()]);
  /* What the ceiling stopped is kept as it was, and said. */
  run.kept += queue.length;
  return run;
}
