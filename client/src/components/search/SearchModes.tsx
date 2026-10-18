/**
 * The two ways into search that are not typing: speaking, and pointing a
 * camera at the thing (3.1.6).
 *
 * **Voice is the browser's own recogniser.** NetLet receives the text and
 * nothing else; the panel says whose service did the listening — in Chrome
 * and Edge the audio goes to Google or Microsoft — because a microphone that
 * does not say where the sound goes is one people are right to distrust. A
 * browser with no recogniser (Firefox, today) gets the drawn "cannot listen"
 * state rather than a dead button.
 *
 * **Photo is a vision model, through NetLet.** The picture is shrunk in the
 * browser, sent once to turn it into a few search words, and kept by nobody;
 * `shared/commerce/photoSearch.ts` is what may be sent and what a reply may
 * become. With no model configured, or every model call switched off (2.3),
 * the panel stays drawn and says plainly that nothing is looking yet — the
 * line that used to sit on both panels while neither was wired.
 *
 * What was heard, and the photo that will be sent, are both shown back before
 * anything is searched: recognition mishears and a half-framed shot matches
 * nothing, and both are obvious in a preview and invisible in "no results".
 *
 * Every state is reachable for review without a microphone or a camera:
 * `?searchTest=voice-heard`, `?searchTest=photo-scanning` and the rest, on any
 * build, because several of them are unreachable by clicking.
 */
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { Thumb } from "@/components/product/Thumb";
import { shrinkPhoto } from "@/lib/shrinkPhoto";
import { trpc } from "@/lib/trpc";
import type { MessageKey } from "@shared/i18n/dictionary";
import { Camera, CameraOff, Image as ImageIcon, Keyboard, Mic, MicOff, RotateCcw, ScanLine, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { recogniser } from "@/lib/speech";

/*
 * Whether the two controls are drawn is a shop's decision now, on the
 * switchboard (`voiceSearch`, `photoSearch`), and both start off: a camera
 * that answers "nothing is looking yet" is a control with nothing behind it on
 * a shop with no model key. The sheets themselves stay mounted, so every state
 * still opens at `?searchTest=` for review whatever the switches say.
 */

export type VoiceState = "listening" | "heard" | "nothing" | "denied" | "unsupported";
export type PhotoState = "choose" | "preview" | "scanning" | "noMatch" | "denied";

/**
 * Opens the sheet straight into one state, for review.
 *
 * Not gated on the build, unlike `LiveSearch`'s own `searchTest` values — those
 * simulate an outage and belong nowhere near a real shopper. This one only
 * decides which of several honest panels is drawn, and until the recognisers
 * land it is the only way to see the states a click cannot reach: what a
 * refused microphone looks like, what a browser that cannot listen says, what
 * happens when a photo matches nothing. A design nobody can look at on the
 * deployed site is a design nobody can sign off.
 */
function forcedState(prefix: string): string | null {
  const flag = new URLSearchParams(window.location.search).get("searchTest");
  return flag?.startsWith(`${prefix}-`) ? flag.slice(prefix.length + 1) : null;
}

/**
 * The frame both panels wear.
 *
 * A bottom sheet on a phone and a centred card from `sm` up, which is the
 * shape `DeliveryZoneDialog` already established — two dialogs on one site
 * that open differently read as two sites. `useOverlay` is what makes Escape
 * close it, focus return to the control that opened it, and the catalog behind
 * stop scrolling.
 *
 * It goes through a portal to `<body>`, and that is not tidiness. This sheet
 * is opened from `LiveSearch`, which lives inside the header, and the header
 * carries `backdrop-blur-xl` — a `backdrop-filter` makes an element the
 * containing block for every `position: fixed` descendant. So `inset-0`
 * resolved against the 125px header rather than the viewport, and the sheet
 * hung off the top of the screen with its bottom edge at y=112. Measured, not
 * guessed. `DeliveryZoneDialog` never hit this only because it is rendered
 * from the page body rather than from inside the bar.
 */
function SearchModeSheet({ open, onClose, id, eyebrow, title, note, children, footer, wired, offNote }: {
  open: boolean;
  /** Whether something real is behind this panel; when not, it says so. */
  wired: boolean;
  offNote?: MessageKey;
  onClose: () => void;
  id: string;
  eyebrow: MessageKey;
  title: MessageKey;
  note?: MessageKey;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  useOverlay(open, onClose);
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[75] flex items-end bg-[#061b3b]/35 p-3 sm:items-center sm:justify-center"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="w-full max-w-md rounded-[1.5rem] bg-background p-5 shadow-2xl sm:p-7"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold ink-accent">{t(eyebrow)}</p>
            <h2 id={`${id}-title`} className="font-extrabold mt-1 text-2xl leading-tight text-[#0a285a] sm:text-3xl">{t(title)}</h2>
            {note ? <p className="mt-2 text-sm leading-6 ink-muted">{t(note)}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("search.close")}
            title={t("search.close")}
            className="glass pressable grid size-10 shrink-0 place-items-center rounded-full"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-6">{children}</div>

        {footer ? <div className="mt-5">{footer}</div> : null}

        {/*
          The line that keeps an unwired panel honest. It is not a "coming
          soon" badge on a dead control: it names the state and points at the
          thing that does work, which is the field the shopper just came from.
        */}
        {!wired && offNote ? (
          <p className="mt-5 flex items-start gap-2 rounded-xl bg-[#fff0ab] p-3 text-xs leading-5 text-[#705523]">
            <ScanLine className="mt-0.5 size-4 shrink-0" />
            {t(offNote)}
          </p>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}

/**
 * The row every terminal state ends on: two actions side by side, or one
 * across the whole width. A single button left in a two-column grid sits at
 * half width against an empty cell, which reads as a control whose pair failed
 * to render rather than as the only thing there is to do.
 */
function SheetActions({ primary, secondary }: { primary?: ReactNode; secondary?: ReactNode }) {
  return <div className={`grid gap-2 ${secondary ? "sm:grid-cols-2" : ""}`}>{primary}{secondary}</div>;
}

/**
 * Navy rather than the brand orange, which is the choice worth writing down.
 * `.glass-accent` is white on `#f2683a` — 3.08:1, the shortfall this codebase
 * already flags — and at `text-xs` these labels are nowhere near large-text
 * size, so 4.5:1 is the bar and orange misses it. axe does not catch the
 * existing orange buttons only because the gradient over the fill makes it
 * report "incomplete" instead of a violation, which is not the same as passing.
 *
 * Navy is also what the rest of the chrome already uses for the button that
 * does the thing — the cart, and the search submit this is standing in for.
 * Orange stays where it is a marketing surface rather than a control in a
 * dialog.
 */
function PrimaryAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="glass glass-navy pressable flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-xs font-extrabold">
      {icon}{label}
    </button>
  );
}

function QuietAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="glass pressable flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-xs font-extrabold">
      {icon}{label}
    </button>
  );
}

/** A large centred symbol with a headline under it — what every refusal looks like. */
function SheetNotice({ icon, title, note }: { icon: ReactNode; title: MessageKey; note: MessageKey }) {
  const { t } = useTranslation();
  return (
    <div className="grid place-items-center rounded-2xl border border-[#d5dfeb] bg-white px-5 py-8 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-[#e7edf5] ink-muted">{icon}</span>
      <p className="type-heading mt-4 text-base text-[#0a285a]">{t(title)}</p>
      <p className="mt-2 max-w-[38ch] text-sm leading-6 ink-muted">{t(note)}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ voice */

/**
 * Speaking a search.
 *
 * The listening state is the one that has to be unmistakable, because it is
 * the only moment where the page is taking something from the room. It gets
 * the whole panel: a navy disc, one expanding ring, and a meter that moves —
 * a static microphone icon cannot tell you whether it is hearing you, and
 * somebody who cannot tell says the words again louder. What is being heard
 * appears under it as it arrives.
 *
 * It listens in the page's language: Kuwaiti Arabic on an Arabic page, English
 * otherwise. Somebody switching language to speak the other is one press away,
 * and a recogniser guessing between the two mishears both.
 */
export function VoiceSearchPanel({ open, onClose, onUse }: {
  open: boolean;
  onClose: () => void;
  onUse: (query: string) => void;
}) {
  const { t, isArabic } = useTranslation();
  const [state, setState] = useState<VoiceState>("listening");
  const [heard, setHeard] = useState("");
  const [attempt, setAttempt] = useState(0);
  const forced = useRef(false);

  // Opening always starts at the top of the flow, or at the state a review
  // link asked for — a sheet that reopens on the refusal you saw last time
  // reads as broken rather than as remembered.
  useEffect(() => {
    if (!open) return;
    const asked = forcedState("voice") as VoiceState | null;
    forced.current = Boolean(asked);
    setHeard("");
    setState(asked ?? (recogniser() ? "listening" : "unsupported"));
  }, [open]);

  useEffect(() => {
    if (!open || state !== "listening" || forced.current) return;
    const Recogniser = recogniser();
    if (!Recogniser) { setState("unsupported"); return; }
    const recognition = new Recogniser();
    recognition.lang = isArabic ? "ar-KW" : "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    let final = "";
    let settled = false;
    recognition.onresult = event => {
      let partial = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) final += result[0].transcript;
        else partial += result[0].transcript;
      }
      setHeard((final || partial).trim());
    };
    recognition.onerror = event => {
      settled = true;
      setState(event.error === "not-allowed" || event.error === "service-not-allowed" ? "denied"
        : event.error === "audio-capture" ? "unsupported"
        : "nothing");
    };
    recognition.onend = () => {
      if (settled) return;
      setState(final.trim() ? "heard" : "nothing");
      if (final.trim()) setHeard(final.trim());
    };
    try {
      recognition.start();
    } catch {
      setState("unsupported");
    }
    return () => {
      settled = true;
      recognition.onresult = recognition.onerror = recognition.onend = null;
      recognition.abort();
    };
  }, [open, state, attempt, isArabic]);

  /* A review link to the heard state has nothing real to show, so it shows an example. */
  const transcript = heard || (forced.current ? t("search.voiceExample") : "");
  const retry = () => { forced.current = false; setHeard(""); setAttempt(count => count + 1); setState("listening"); };

  return (
    <SearchModeSheet
      open={open}
      onClose={onClose}
      wired
      id="voice-search"
      eyebrow="search.voiceEyebrow"
      title={state === "heard" ? "search.voiceHeardTitle" : "search.voiceTitle"}
      note={state === "listening" ? "search.voiceNote" : undefined}
      footer={
        state === "listening" ? (
          <SheetActions
            primary={<QuietAction icon={<Keyboard className="size-4" />} label={t("search.typeInstead")} onClick={onClose} />}
          />
        ) : state === "heard" ? (
          <SheetActions
            primary={<PrimaryAction icon={<Search className="size-4" />} label={t("search.voiceUse")} onClick={() => onUse(transcript)} />}
            secondary={<QuietAction icon={<RotateCcw className="size-4 rtl:-scale-x-100" />} label={t("search.voiceRetry")} onClick={retry} />}
          />
        ) : (
          <SheetActions
            primary={<PrimaryAction icon={<Keyboard className="size-4" />} label={t("search.typeInstead")} onClick={onClose} />}
            secondary={state === "denied" || state === "nothing" ? <QuietAction icon={<Mic className="size-4" />} label={t("search.voiceRetry")} onClick={retry} /> : undefined}
          />
        )
      }
    >
      {state === "listening" ? (
        <div className="grid place-items-center rounded-2xl border border-[#d5dfeb] bg-white px-5 py-8">
          <span className="relative grid size-24 place-items-center">
            {/* One ring, not three. A control that throbs from several radii at
                once reads as an error state rather than as attention. */}
            <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-[#f2683a]/25" />
            <span className="glass glass-navy relative grid size-20 place-items-center rounded-full">
              <Mic className="size-8" />
            </span>
          </span>
          {/* aria-live so the state is announced; a spinner nobody can see is
              the screen-reader equivalent of a control with no label. */}
          <p aria-live="polite" className="type-heading mt-5 text-base text-[#0a285a]">{t("search.voiceListening")}</p>
          <div aria-hidden className="mt-4 flex h-8 items-center justify-center gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map(bar => (
              <span
                key={bar}
                className="voice-bar w-1.5 rounded-full bg-[#aac0da]"
                style={{ height: "100%", animationDelay: `${bar * 110}ms` }}
              />
            ))}
          </div>
          {heard ? <p dir="auto" className="mt-3 text-sm text-[#0a285a]">{heard}</p> : null}
          <p className="mt-4 max-w-[40ch] text-center text-[12px] leading-5 ink-muted">{t("search.voicePrivacy")}</p>
        </div>
      ) : state === "heard" ? (
        <div className="rounded-2xl border border-[#d5dfeb] bg-white px-5 py-6">
          <p className="type-label ink-muted">{t("search.voiceHeard")}</p>
          {/* dir="auto" because what somebody said is their own language, not
              the interface's — an Arabic phrase inside an English session has
              to keep its own direction and punctuation. */}
          <p dir="auto" className="font-extrabold mt-2 text-2xl leading-snug text-[#0a285a]">“{transcript}”</p>
          <p className="mt-3 text-xs leading-5 ink-muted">{t("search.voiceConfirmNote")}</p>
        </div>
      ) : state === "nothing" ? (
        <SheetNotice icon={<Mic className="size-7" />} title="search.voiceNothing" note="search.voiceNothingNote" />
      ) : state === "denied" ? (
        <SheetNotice icon={<MicOff className="size-7" />} title="search.voiceDenied" note="search.voiceDeniedNote" />
      ) : (
        <SheetNotice icon={<MicOff className="size-7" />} title="search.voiceUnsupported" note="search.voiceUnsupportedNote" />
      )}
    </SearchModeSheet>
  );
}

/* ------------------------------------------------------------------ photo */

/**
 * Searching with a picture.
 *
 * Two sources rather than one, and both are offered first. "Take a photo" is
 * the case on a phone in a shop; "choose from your photos" is the case
 * everywhere else, including every desktop, and a panel that only offers the
 * camera is a panel a laptop cannot use at all. Both are the browser's own
 * file picker — the camera one asks for the rear camera — so no camera
 * permission is held by the page and none can be left on.
 *
 * The photo is shown before it is sent, with a line saying where it goes, and
 * pressing "Search with this photo" is the consent: nothing leaves on choosing.
 */
export function PhotoSearchPanel({ open, onClose, onUse }: {
  open: boolean;
  onClose: () => void;
  /** Search for what the photo was read as. */
  onUse: (query: string) => void;
}) {
  const { t, tError, locale } = useTranslation();
  const [state, setState] = useState<PhotoState>("choose");
  const [photo, setPhoto] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const available = trpc.search.photoAvailable.useQuery(undefined, { enabled: open, staleTime: 300_000 });
  const wired = available.data?.available === true;
  const read = trpc.search.photo.useMutation({
    onSuccess: reply => {
      if (reply.kind === "query") onUse(reply.query);
      else setState("noMatch");
    },
    onError: error => { setProblem(tError(error.message)); setState("preview"); },
  });

  useEffect(() => {
    if (!open) return;
    setPhoto(null);
    setProblem(null);
    setState((forcedState("photo") as PhotoState | null) ?? "choose");
  }, [open]);

  const chosen = async (file: File | undefined) => {
    if (!file) return;
    const shrunk = await shrinkPhoto(file);
    if (!shrunk) { setProblem(t("search.photoUnreadable")); setState("choose"); return; }
    setProblem(null);
    setPhoto(shrunk);
    setState("preview");
  };

  const pick = (which: "camera" | "library") => (which === "camera" ? camera : library).current?.click();

  const frame = (
    <div className="relative isolate aspect-[4/3] overflow-hidden rounded-2xl border border-[#d5dfeb] bg-[#e7edf5]">
      <Thumb src={photo} alt={photo ? t("search.photoYours") : ""} className="size-full object-cover" icon={<Camera className="size-8" />} />
      {state === "scanning" ? (
        <>
          <span aria-hidden className="absolute inset-0 bg-[#061b3b]/35" />
          {/* The sweep is the only thing saying work is happening; a still
              photo under a caption looks like a photo that failed to send. */}
          <span aria-hidden className="photo-scan absolute inset-x-0 h-24 bg-[linear-gradient(to_bottom,rgba(242,104,58,0),rgba(242,104,58,.55),rgba(242,104,58,0))]" />
        </>
      ) : null}
      {/*
        Corner brackets rather than a full inner border. The frame has to read
        as a viewfinder holding a shot, and a plain rectangle reads as an empty
        box — which matters most in exactly the case where the photo is missing
        and the box really is empty. Logical sides, so the set mirrors whole.
      */}
      <span aria-hidden className="pointer-events-none absolute start-3 top-3 size-7 rounded-ss-lg border-s-[3px] border-t-[3px] border-white/70" />
      <span aria-hidden className="pointer-events-none absolute end-3 top-3 size-7 rounded-se-lg border-e-[3px] border-t-[3px] border-white/70" />
      <span aria-hidden className="pointer-events-none absolute bottom-3 start-3 size-7 rounded-es-lg border-b-[3px] border-s-[3px] border-white/70" />
      <span aria-hidden className="pointer-events-none absolute bottom-3 end-3 size-7 rounded-ee-lg border-b-[3px] border-e-[3px] border-white/70" />
    </div>
  );

  const search = () => {
    if (!photo || !wired) return;
    setState("scanning");
    read.mutate({ image: photo, locale });
  };

  return (
    <SearchModeSheet
      open={open}
      onClose={onClose}
      wired={wired}
      offNote="search.photoOff"
      id="photo-search"
      eyebrow="search.photoEyebrow"
      title={state === "noMatch" ? "search.photoNoMatch" : "search.photoTitle"}
      note={state === "choose" ? "search.photoNote" : state === "noMatch" ? "search.photoNoMatchNote" : undefined}
      footer={
        state === "choose" ? (
          <SheetActions
            primary={<PrimaryAction icon={<Camera className="size-4" />} label={t("search.photoTake")} onClick={() => pick("camera")} />}
            secondary={<QuietAction icon={<ImageIcon className="size-4" />} label={t("search.photoChoose")} onClick={() => pick("library")} />}
          />
        ) : state === "preview" ? (
          <SheetActions
            primary={wired ? <PrimaryAction icon={<Search className="size-4" />} label={t("search.photoUse")} onClick={search} /> : undefined}
            secondary={<QuietAction icon={<RotateCcw className="size-4 rtl:-scale-x-100" />} label={t("search.photoRetake")} onClick={() => setState("choose")} />}
          />
        ) : state === "scanning" ? null : state === "noMatch" ? (
          <SheetActions
            primary={<PrimaryAction icon={<Camera className="size-4" />} label={t("search.photoRetake")} onClick={() => setState("choose")} />}
            secondary={<QuietAction icon={<Keyboard className="size-4" />} label={t("search.typeInstead")} onClick={onClose} />}
          />
        ) : (
          <SheetActions
            primary={<PrimaryAction icon={<ImageIcon className="size-4" />} label={t("search.photoChoose")} onClick={() => pick("library")} />}
            secondary={<QuietAction icon={<Keyboard className="size-4" />} label={t("search.typeInstead")} onClick={onClose} />}
          />
        )
      }
    >
      {/* The browser's own pickers. Hidden, and reached only through the
          buttons above, which carry the words. */}
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" tabIndex={-1} aria-hidden onChange={event => { void chosen(event.target.files?.[0]); event.target.value = ""; }} />
      <input ref={library} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden onChange={event => { void chosen(event.target.files?.[0]); event.target.value = ""; }} />

      {state === "choose" ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-[#aac0da] bg-white px-5 py-9 text-center">
          <span className="glass glass-navy grid size-16 place-items-center rounded-full"><Camera className="size-7" /></span>
          <p className="type-heading mt-4 text-base text-[#0a285a]">{t("search.photoHow")}</p>
          <p className="mt-2 max-w-[34ch] text-sm leading-6 ink-muted">{t("search.photoHowNote")}</p>
          {problem ? <p role="alert" className="mt-3 text-sm font-bold text-[#8c2f22]">{problem}</p> : null}
        </div>
      ) : state === "denied" ? (
        <SheetNotice icon={<CameraOff className="size-7" />} title="search.photoDenied" note="search.photoDeniedNote" />
      ) : (
        <div>
          {frame}
          {state === "scanning" ? (
            <p aria-live="polite" className="type-heading mt-4 text-center text-base text-[#0a285a]">{t("search.photoScanning")}</p>
          ) : state === "preview" ? (
            <>
              <p className="mt-4 text-center text-xs leading-5 ink-muted">{t("search.photoPreviewNote")}</p>
              {wired ? <p className="mt-2 text-center text-[12px] leading-5 ink-muted">{t("search.photoConsent")}</p> : null}
              {problem ? <p role="alert" className="mt-2 text-center text-sm font-bold text-[#8c2f22]">{problem}</p> : null}
            </>
          ) : null}
        </div>
      )}
    </SearchModeSheet>
  );
}
