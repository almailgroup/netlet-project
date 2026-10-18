/**
 * "See it on you" (3.1.8): a shopper's own photo, and the drawing model's
 * picture of them wearing this product.
 *
 * Drawn only where it works — a product that is worn, the `tryOn` switch on
 * (it starts off), a model configured (`tryOn.offered`) — and only signed in,
 * since every try is counted against an account. Before a photo is chosen
 * the panel says where it goes: to Google's Gemini, through NetLet, kept by
 * NetLet nowhere. The photo is shrunk in the browser first, photo search's
 * rule, so what leaves is small and a letter on the table behind is not
 * legible. The picture is shown here and not saved; it is labelled as the
 * model's, because a drawn fit is a guess at a fit.
 *
 * A modal, owing what every modal here does through `useOverlay`.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Camera, LoaderCircle, Sparkles, X } from "lucide-react";
import AuthDialog from "@/components/auth/AuthDialog";
import { useAuth } from "@/hooks/useAuth";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { shrinkPhoto } from "@/lib/shrinkPhoto";
import { trpc } from "@/lib/trpc";

export function TryOn({ productId, title }: { productId: string; title: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const numeric = /^\d+$/.test(productId) ? Number(productId) : null;
  const offered = trpc.tryOn.offered.useQuery({ productId: numeric ?? 0 }, { enabled: numeric !== null, staleTime: 300_000 });
  if (numeric === null || !offered.data) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable mt-2 inline-flex items-center gap-1.5 text-[12px] font-extrabold text-[#0a285a] underline underline-offset-2"
      >
        <Sparkles className="size-3.5" aria-hidden />{t("tryOn.open")}
      </button>
      {open ? <TryOnDialog productId={numeric} title={title} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function TryOnDialog({ productId, title, onClose }: { productId: number; title: string; onClose: () => void }) {
  const { t, tError } = useTranslation();
  const { isAuthenticated } = useAuth();
  const titleId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  useOverlay(true, onClose);
  useEffect(() => { closeButton.current?.focus(); }, []);
  const make = trpc.tryOn.make.useMutation({ onError: error => setProblem(tError(error.message)) });

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    make.reset();
    const shrunk = await shrinkPhoto(file);
    if (!shrunk) { setProblem(t("tryOn.unreadable")); return; }
    setPhoto(shrunk);
  };

  const tryIt = () => {
    if (!photo) return;
    const [, mimeType, data] = /^data:(image\/jpeg);base64,(.+)$/.exec(photo) ?? [];
    if (!data) { setProblem(t("tryOn.unreadable")); return; }
    make.mutate({ productId, photo: { mimeType: mimeType as "image/jpeg", data } });
  };

  const result = make.data ? `data:${make.data.mimeType};base64,${make.data.data}` : null;

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-[#061b3b]/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-[520px] overflow-y-auto rounded-3xl bg-[#fffdf9] p-6 shadow-[0_24px_60px_rgba(10,40,90,.28)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-extrabold text-[#0a285a]">{t("tryOn.title")}</h2>
            <p dir="auto" className="mt-0.5 truncate text-[13px] ink-muted">{title}</p>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label={t("tryOn.close")} className="glass pressable grid size-9 shrink-0 place-items-center rounded-full">
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <p className="mt-4 text-[13px] leading-6 text-[#404553]">{t("tryOn.privacy")}</p>

        {!isAuthenticated ? (
          <div className="mt-4">
            <p className="text-[13px] leading-6 text-[#0a285a]">{t("tryOn.signIn")}</p>
            <button type="button" onClick={() => setAuthOpen(true)} className="glass glass-navy pressable mt-3 inline-flex h-11 items-center rounded-full px-5">
              {t("header.signIn")}
            </button>
            <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
          </div>
        ) : (
          <>
            <div className={`mt-4 grid gap-3 ${result ? "grid-cols-2" : "grid-cols-1"}`}>
              {photo ? (
                <figure className="overflow-hidden rounded-2xl border border-[#d5dfeb] bg-white">
                  <img src={photo} alt={t("tryOn.yourPhoto")} loading="eager" decoding="async" className="aspect-[3/4] w-full object-cover" />
                  <figcaption className="px-3 py-2 text-[12px] ink-muted">{t("tryOn.yourPhoto")}</figcaption>
                </figure>
              ) : null}
              {result ? (
                <figure className="overflow-hidden rounded-2xl border border-[#0a285a] bg-white">
                  <img src={result} alt={t("tryOn.resultAlt", { product: title })} loading="eager" decoding="async" className="aspect-[3/4] w-full object-cover" />
                  <figcaption className="px-3 py-2 text-[12px] ink-muted">{t("tryOn.madeByAi")}</figcaption>
                </figure>
              ) : null}
            </div>

            <input ref={picker} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden onChange={event => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => picker.current?.click()} disabled={make.isPending} className="glass pressable inline-flex h-11 items-center gap-2 rounded-full px-5 text-[#0a285a]">
                <Camera className="size-4" aria-hidden />{t(photo ? "tryOn.another" : "tryOn.choose")}
              </button>
              {photo && !result ? (
                <button type="button" onClick={tryIt} disabled={make.isPending} className="glass glass-navy pressable inline-flex h-11 items-center gap-2 rounded-full px-5">
                  {make.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                  {t(make.isPending ? "tryOn.working" : "tryOn.go")}
                </button>
              ) : null}
            </div>
            <p aria-live="polite" className="mt-3 text-[13px] leading-5 text-[#8c2f22]">{problem}</p>
          </>
        )}
      </div>
    </div>
  );
}
