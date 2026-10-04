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
 * Absent from the demo build, which has no server to store a photo on.
 */
import { useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";
import { DEMO_MODE } from "@/lib/demoMode";
import { preparePhoto, type PreparedPhoto } from "@/lib/preparePhoto";
import type { Fix } from "@shared/commerce/media";
import type { MessageKey } from "@shared/i18n/dictionary";

const FIX_LABEL: Record<Fix, MessageKey> = {
  trimmed: "media.fixTrimmed",
  squared: "media.fixSquared",
  levelled: "media.fixLevelled",
  resized: "media.fixResized",
};

type Choice = { taken: PreparedPhoto; fixed: PreparedPhoto; urls: { taken: string; fixed: string } };

export function PhotoUpload({ onUploaded }: { onUploaded: (url: string) => void }) {
  const { t, tError } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"preparing" | "uploading" | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [useFixed, setUseFixed] = useState(true);

  /* Object URLs hold the blob alive until revoked. */
  useEffect(() => () => {
    if (choice) { URL.revokeObjectURL(choice.urls.taken); URL.revokeObjectURL(choice.urls.fixed); }
  }, [choice]);

  if (DEMO_MODE) return null;

  const chosen = async (file: File | undefined) => {
    if (!file) return;
    setBusy("preparing");
    const [taken, fixed] = await Promise.all([preparePhoto(file, false), preparePhoto(file, true)]);
    setBusy(null);
    if (typeof taken === "string" || typeof fixed === "string") {
      toast.error(t(typeof fixed === "string" ? fixed : (taken as MessageKey)));
      return;
    }
    setUseFixed(fixed.fixes.some(fix => fix !== "resized"));
    setChoice({ taken, fixed, urls: { taken: URL.createObjectURL(taken.blob), fixed: URL.createObjectURL(fixed.blob) } });
  };

  const upload = async () => {
    if (!choice) return;
    const photo = useFixed ? choice.fixed : choice.taken;
    setBusy("uploading");
    try {
      const response = await fetch("/api/media", { method: "POST", headers: { "Content-Type": photo.type }, body: photo.blob, credentials: "same-origin" });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error ?? "media.failed");
      onUploaded(body.url);
      toast.success(t("media.uploaded"));
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
        className="glass pressable inline-flex items-center gap-2 rounded-full border border-[#0a285a]/15 px-4 py-2 text-xs font-extrabold disabled:opacity-60"
      >
        {busy === "preparing" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
        {t(busy === "preparing" ? "media.preparing" : "media.upload")}
      </button>
      <input ref={input} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden onChange={event => { void chosen(event.target.files?.[0]); event.target.value = ""; }} />

      {choice ? (
        <div className="mt-3 w-full rounded-2xl border border-[#d5dfeb] bg-white p-4 text-[12px] text-[#0a285a]">
          <p className="font-extrabold">{t("media.chooseTitle")}</p>
          <p className="mt-1 ink-muted">
            {meaningful.length ? t("media.fixedThese", { fixes: meaningful.map(fix => t(FIX_LABEL[fix])).join(" · ") }) : t("media.nothingToFix")}
          </p>
          <fieldset className="mt-3 grid grid-cols-2 gap-3">
            <legend className="sr-only">{t("media.chooseTitle")}</legend>
            {([["fixed", true], ["taken", false]] as const).map(([which, fixedOne]) => (
              <label key={which} className={`cursor-pointer rounded-xl border p-2 ${useFixed === fixedOne ? "border-[#0a285a] ring-2 ring-[#0a285a]/20" : "border-[#d5dfeb]"}`}>
                <img src={choice.urls[which]} alt={t(fixedOne ? "media.fixedAlt" : "media.takenAlt")} loading="eager" decoding="async" className="aspect-square w-full rounded-lg bg-[#eef1f6] object-contain" />
                <span className="mt-2 flex items-center gap-2 font-bold">
                  <input type="radio" name="photo-choice" checked={useFixed === fixedOne} onChange={() => setUseFixed(fixedOne)} className="accent-[#0a285a]" />
                  {t(fixedOne ? "media.useFixed" : "media.useTaken")}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void upload()} disabled={busy !== null} className="glass-navy pressable type-control inline-flex items-center gap-2 rounded-full px-4 py-2 disabled:opacity-60">
              {busy === "uploading" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}{t("media.add")}
            </button>
            <button type="button" onClick={() => setChoice(null)} disabled={busy !== null} className="glass pressable type-control rounded-full px-4 py-2">{t("media.cancel")}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
