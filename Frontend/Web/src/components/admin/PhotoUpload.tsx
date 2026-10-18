/**
 * Upload a product photo, fixed on the way in (3.3.4).
 *
 * The seller picks a file; the browser prepares it twice — as taken, and fixed
 * (`preparePhoto`) — and shows both side by side with what the fixes were, so
 * nobody's framing is changed without them seeing it. The fixed one is chosen
 * when anything was fixed; "as taken" is one press away. Only then is anything
 * sent, and what comes back is a path that goes into the gallery like a pasted
 * URL, to be saved with the rest.
 *
 * The same panel takes a manufacturer's image (3.1.10): the seller pastes the
 * maker's product page, NetLet's server reads it for the images the maker
 * lists for the product and fetches each for a preview, and the one chosen
 * goes through exactly the before-and-after an upload does — with where it
 * came from sent along, so NetLet can say later where a picture was found.
 *
 * Absent from the demo build, which has no server to store a photo on.
 */
import { fieldClass, smallButtonClass } from "@/components/admin/ui";
import { useEffect, useRef, useState } from "react";
import { Factory, ImagePlus, LoaderCircle, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";
import { DEMO_MODE } from "@/lib/demoMode";
import { preparePhoto, type PreparedPhoto } from "@/lib/preparePhoto";
import { trpc } from "@/lib/trpc";
import type { Candidate } from "@shared/commerce/manufacturerImages";
import { MIN_EDGE, type Fix } from "@shared/commerce/media";
import type { MessageKey } from "@shared/i18n/dictionary";

const FIX_LABEL: Record<Fix, MessageKey> = {
  trimmed: "media.fixTrimmed",
  squared: "media.fixSquared",
  levelled: "media.fixLevelled",
  resized: "media.fixResized",
};

/**
 * `source` is the manufacturer's image address when the photo came from one,
 * else null. `ai` is the drawing model's clean-up (3.3.4), once asked for.
 */
type Choice = {
  taken: PreparedPhoto;
  fixed: PreparedPhoto;
  ai: PreparedPhoto | null;
  urls: { taken: string; fixed: string; ai: string | null };
  source: string | null;
};
type Pick = "fixed" | "taken" | "ai";

export function PhotoUpload({ onUploaded, addedNote = "media.uploaded", productName = "", fromMaker = true }: {
  onUploaded: (url: string) => void;
  /** Offer the maker's page beside the upload — a product's, never a guide's. */
  fromMaker?: boolean;
  /** The product's name as typed so far, for finding its maker's page by name. */
  productName?: string;
  /** What the toast says once it is in the list: the editor saves photos with a Save, the new-product form with Create. */
  addedNote?: MessageKey;
}) {
  const { t, tError } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"preparing" | "uploading" | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [pick, setPick] = useState<Pick>("fixed");
  const [cleaning, setCleaning] = useState(false);
  /* The clean-up needs the model; absent, the two the browser made are the choice. */
  const modelOn = trpc.media.aiAvailable.useQuery(undefined, { enabled: choice !== null && !DEMO_MODE, staleTime: 300_000 });

  /* Object URLs hold the blob alive until revoked. */
  useEffect(() => () => {
    if (choice) {
      URL.revokeObjectURL(choice.urls.taken);
      URL.revokeObjectURL(choice.urls.fixed);
      if (choice.urls.ai) URL.revokeObjectURL(choice.urls.ai);
    }
  }, [choice]);

  if (DEMO_MODE) return null;

  const chosen = async (file: Blob | undefined, source: string | null = null) => {
    if (!file) return;
    setBusy("preparing");
    const [taken, fixed] = await Promise.all([preparePhoto(file, false), preparePhoto(file, true)]);
    setBusy(null);
    if (typeof taken === "string" || typeof fixed === "string") {
      toast.error(t(typeof fixed === "string" ? fixed : (taken as MessageKey)));
      return;
    }
    setPick(fixed.fixes.some(fix => fix !== "resized") ? "fixed" : "taken");
    setChoice({ taken, fixed, ai: null, urls: { taken: URL.createObjectURL(taken.blob), fixed: URL.createObjectURL(fixed.blob), ai: null }, source });
  };

  /* The photo as taken goes to the drawing model; what comes back is prepared
     like any photo, so it is stored the way every other one is. */
  const cleanUp = async () => {
    if (!choice) return;
    setCleaning(true);
    try {
      const response = await fetch("/api/media/ai-clean", { method: "POST", headers: { "Content-Type": choice.taken.type }, body: choice.taken.blob, credentials: "same-origin" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "drawing.failed");
      }
      const prepared = await preparePhoto(await response.blob(), false);
      if (typeof prepared === "string") throw new Error(prepared);
      const url = URL.createObjectURL(prepared.blob);
      setChoice(current => current && { ...current, ai: prepared, urls: { ...current.urls, ai: url } });
      setPick("ai");
    } catch (error) {
      toast.error(tError(error instanceof Error ? error.message : "drawing.failed"));
    } finally {
      setCleaning(false);
    }
  };

  const upload = async () => {
    if (!choice) return;
    const photo = pick === "ai" && choice.ai ? choice.ai : pick === "fixed" ? choice.fixed : choice.taken;
    setBusy("uploading");
    try {
      const headers: Record<string, string> = { "Content-Type": photo.type };
      if (choice.source) headers["X-NetLet-Source"] = choice.source;
      const response = await fetch("/api/media", { method: "POST", headers, body: photo.blob, credentials: "same-origin" });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error ?? "media.failed");
      onUploaded(body.url);
      toast.success(t(addedNote));
      setChoice(null);
    } catch (error) {
      toast.error(tError(error instanceof Error ? error.message : "media.failed"));
    } finally {
      setBusy(null);
    }
  };

  const meaningful = choice?.fixed.fixes.filter(fix => fix !== "resized") ?? [];

  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy !== null}
        className={smallButtonClass.secondary}
      >
        {busy === "preparing" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
        {t(busy === "preparing" ? "media.preparing" : "media.upload")}
      </button>
      <input ref={input} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden onChange={event => { void chosen(event.target.files?.[0]); event.target.value = ""; }} />
      {fromMaker ? <ManufacturerImport busy={busy !== null} productName={productName} onPick={(blob, source) => void chosen(blob, source)} /> : null}

      {choice ? (
        <div className="mt-3 w-full rounded-2xl border border-[#d5dfeb] bg-white p-4 text-[12px] text-[#0a285a]">
          <p className="font-extrabold">{t("media.chooseTitle")}</p>
          <p className="mt-1 ink-muted">
            {meaningful.length ? t("media.fixedThese", { fixes: meaningful.map(fix => t(FIX_LABEL[fix])).join(" · ") }) : t("media.nothingToFix")}
          </p>
          <fieldset className={`mt-3 grid gap-3 ${choice.ai ? "grid-cols-3" : "grid-cols-2"}`}>
            <legend className="sr-only">{t("media.chooseTitle")}</legend>
            {(["fixed", "taken", ...(choice.ai ? ["ai" as const] : [])] as Pick[]).map(which => (
              <label key={which} className={`cursor-pointer rounded-xl border p-2 ${pick === which ? "border-[#0a285a] ring-2 ring-[#0a285a]/20" : "border-[#d5dfeb]"}`}>
                <img
                  src={choice.urls[which] ?? undefined}
                  alt={t(which === "fixed" ? "media.fixedAlt" : which === "ai" ? "media.aiAlt" : choice.source ? "media.originalAlt" : "media.takenAlt")}
                  loading="eager"
                  decoding="async"
                  className="aspect-square w-full rounded-lg bg-[#eef1f6] object-contain"
                />
                <span className="mt-2 flex items-center gap-2 font-bold">
                  <input type="radio" name="photo-choice" checked={pick === which} onChange={() => setPick(which)} className="accent-[#0a285a]" />
                  {t(which === "fixed" ? "media.useFixed" : which === "ai" ? "media.useAi" : choice.source ? "media.useOriginal" : "media.useTaken")}
                </span>
              </label>
            ))}
          </fieldset>
          {choice.ai ? <p className="mt-2 leading-5 ink-muted">{t("media.aiNote")}</p> : null}
          {modelOn.data && !choice.ai ? (
            <button type="button" onClick={() => void cleanUp()} disabled={cleaning || busy !== null} className={`${smallButtonClass.secondary} mt-3`}>
              {cleaning ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              {t(cleaning ? "media.aiCleaning" : "media.aiClean")}
            </button>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void upload()} disabled={busy !== null} className={smallButtonClass.primary}>
              {busy === "uploading" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}{t("media.add")}
            </button>
            <button type="button" onClick={() => setChoice(null)} disabled={busy !== null} className={smallButtonClass.secondary}>{t("media.cancel")}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

type Preview = { state: "loading" } | { state: "ready"; blob: Blob; url: string } | { state: "failed"; reason: string };

/** One image through NetLet's server, which is the only thing allowed to go and fetch it. */
async function fetchRemote(url: string): Promise<Blob> {
  const response = await fetch("/api/media/remote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    credentials: "same-origin",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "manufacturer.unreachable");
  }
  return response.blob();
}

/**
 * The manufacturer's page, read for its product images (3.1.10).
 *
 * Previews come through NetLet's server too, never straight from the maker's
 * site: the page's content policy would refuse a stranger's image host, and a
 * seller's browser fetching it directly would tell that site who is looking.
 * Three at a time, so a page of eight does not open eight connections at once.
 */
function ManufacturerImport({ busy, productName, onPick }: { busy: boolean; productName: string; onPick: (blob: Blob, source: string) => void }) {
  const { t, tError } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pageUrl, setPageUrl] = useState("");
  /* Finding the page by name needs a model (3.1.10); absent, the paste box is the whole panel. */
  const searchable = trpc.media.aiAvailable.useQuery(undefined, { enabled: open, staleTime: 300_000 });
  const find = trpc.media.findPages.useMutation({ onError: error => toast.error(tError(error.message)) });
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const scan = trpc.media.scanPage.useMutation({
    onSuccess: result => void loadPreviews(result.candidates),
    onError: error => toast.error(tError(error.message)),
  });
  const live = useRef<Record<string, Preview>>({});
  const generation = useRef(0);

  /* Object URLs hold their blobs alive until revoked. */
  useEffect(() => () => {
    for (const preview of Object.values(live.current)) if (preview.state === "ready") URL.revokeObjectURL(preview.url);
  }, []);

  const set = (url: string, preview: Preview) => {
    live.current = { ...live.current, [url]: preview };
    setPreviews(live.current);
  };

  const loadPreviews = async (candidates: Candidate[]) => {
    const mine = ++generation.current;
    for (const preview of Object.values(live.current)) if (preview.state === "ready") URL.revokeObjectURL(preview.url);
    live.current = Object.fromEntries(candidates.map(candidate => [candidate.url, { state: "loading" } as Preview]));
    setPreviews(live.current);
    const queue = [...candidates];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          const blob = await fetchRemote(next.url);
          if (mine !== generation.current) return;
          /* Measured here, so a picture too small to use is never offered with a button that can only fail. */
          const bitmap = await createImageBitmap(blob).catch(() => null);
          if (!bitmap) throw new Error("manufacturer.notAnImage");
          const shortSide = Math.min(bitmap.width, bitmap.height);
          bitmap.close();
          if (shortSide < MIN_EDGE) throw new Error("manufacturer.tooSmall");
          set(next.url, { state: "ready", blob, url: URL.createObjectURL(blob) });
        } catch (error) {
          if (mine !== generation.current) return;
          set(next.url, { state: "failed", reason: error instanceof Error ? error.message : "manufacturer.unreachable" });
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className={smallButtonClass.secondary}
      >
        <Factory className="size-4" aria-hidden />{t("manufacturer.open")}
      </button>
    );
  }

  const result = scan.data;
  const fieldId = "manufacturer-page";
  return (
    <section aria-labelledby="manufacturer-title" className="mt-3 w-full rounded-2xl border border-[#d5dfeb] bg-white p-4 text-[12px] text-[#0a285a]">
      <h3 id="manufacturer-title" className="text-[13px] font-extrabold">{t("manufacturer.open")}</h3>
      <p className="mt-1 leading-5 ink-muted">{t("manufacturer.hint")}</p>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (pageUrl.trim()) scan.mutate({ url: pageUrl.trim() }); }}>
        <label htmlFor={fieldId} className="block min-w-[220px] flex-1">
          <span className="block text-[13px] font-semibold text-[#0a285a]">{t("manufacturer.urlLabel")}</span>
          <input id={fieldId} type="url" inputMode="url" value={pageUrl} onChange={event => setPageUrl(event.target.value)} maxLength={2048} required dir="ltr" placeholder="https://" className={`${fieldClass} mt-1 w-full`} />
        </label>
        <button type="submit" disabled={!pageUrl.trim() || scan.isPending} className={smallButtonClass.primary}>
          {scan.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          {t(scan.isPending ? "manufacturer.finding" : "manufacturer.find")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={smallButtonClass.secondary}>{t("manufacturer.close")}</button>
      </form>

      {searchable.data ? (
        <div className="mt-3 rounded-xl border border-[#d5dfeb] bg-[#f7f8fb] p-3">
          <p className="leading-5 ink-muted">{t("manufacturer.searchHint")}</p>
          <button
            type="button"
            disabled={productName.trim().length < 3 || find.isPending}
            onClick={() => find.mutate({ name: productName })}
            className={`${smallButtonClass.secondary} mt-2`}
          >
            {find.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
            {t(find.isPending ? "manufacturer.searching" : "manufacturer.search")}
          </button>
          {productName.trim().length < 3 ? <p className="mt-2 leading-5 ink-muted">{t("manufacturer.needName")}</p> : null}
          <div aria-live="polite">
            {find.data ? (
              find.data.length === 0 ? (
                <p className="mt-2 leading-5">{t("manufacturer.searchNone")}</p>
              ) : (
                <>
                  <p className="mt-3 font-extrabold">{t("manufacturer.searchResults")}</p>
                  <ul className="mt-2 space-y-2">
                    {find.data.map(page => (
                      <li key={page.url} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#d5dfeb] bg-white px-3 py-2">
                        <span className="min-w-0">
                          <bdi dir="ltr" className="block font-bold">{page.host}</bdi>
                          <span dir="auto" className="block truncate text-[12px] ink-muted">{page.title}</span>
                        </span>
                        <button
                          type="button"
                          disabled={scan.isPending}
                          onClick={() => { setPageUrl(page.url); scan.mutate({ url: page.url }); }}
                          className={smallButtonClass.primary}
                        >
                          {t("manufacturer.choose")}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )
            ) : null}
          </div>
        </div>
      ) : null}

      <div aria-live="polite">
        {result ? (
          result.candidates.length === 0 ? (
            <p className="mt-3 rounded-xl border border-[#d5dfeb] bg-[#f7f8fb] px-3 py-3 leading-5">{t("manufacturer.noneFound")}</p>
          ) : (
            <>
              <p className="mt-3 font-bold">
                {result.title ? <>{t("manufacturer.foundOn")} <bdi>{result.title}</bdi></> : t("manufacturer.foundSome", { count: String(result.candidates.length) })}
              </p>
              <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {result.candidates.map((candidate, index) => {
                  const preview = previews[candidate.url] ?? { state: "loading" };
                  return (
                    <li key={candidate.url} className="rounded-xl border border-[#d5dfeb] p-2">
                      <div className="grid aspect-square w-full place-items-center overflow-hidden rounded-lg bg-[#eef1f6]">
                        {preview.state === "ready" ? (
                          <img src={preview.url} alt={t("manufacturer.previewAlt", { n: String(index + 1) })} loading="lazy" decoding="async" className="size-full object-contain" />
                        ) : preview.state === "loading" ? (
                          <><LoaderCircle className="size-5 animate-spin text-[#536b8c]" aria-hidden /><span className="sr-only">{t("manufacturer.loadingPreview")}</span></>
                        ) : (
                          <span className="px-2 text-center text-[12px] leading-4 ink-muted">{tError(preview.reason)}</span>
                        )}
                      </div>
                      <p className="mt-1 text-[12px] ink-muted">{t(candidate.source === "product" ? "manufacturer.sourceProduct" : "manufacturer.sourceShare")}</p>
                      <button
                        type="button"
                        disabled={preview.state !== "ready" || busy}
                        onClick={() => { if (preview.state === "ready") onPick(preview.blob, candidate.url); }}
                        /* The visible words first, so the name a voice user says is the one they see (WCAG 2.5.3). */
                        aria-label={`${t("manufacturer.use")} ${index + 1}`}
                        className={`${smallButtonClass.secondary} mt-1 w-full`}
                      >
                        {t("manufacturer.use")}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )
        ) : null}
      </div>
      <p className="mt-3 leading-5 ink-muted">{t("manufacturer.rights")}</p>
    </section>
  );
}
