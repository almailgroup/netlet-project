/**
 * "Show me" and the player it opens: the seller's mini tutorials, drawn from
 * `sellerTutorials.ts` on a clock (see that file for why they are drawn rather
 * than filmed). The app's twin is `SellerTutorials.swift`.
 *
 * Every frame is a pure function of the scene's clock, so a replay is exact,
 * and somebody who asked for less motion is shown each scene's last frame with
 * nothing moving. The drawing is hidden from a screen reader; the caption is
 * the step, read out as it changes.
 */
import { DEPARTMENTS } from "@shared/commerce/departments";
import type { MessageKey } from "@shared/i18n/dictionary";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useOverlay } from "@/hooks/useOverlay";
import { Check, ChevronDown, ChevronRight, Download, Info, PlayCircle, Plus, RotateCcw, Send, Sparkles, Upload, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { buttonClass, smallButtonClass } from "../ui";
import {
  characters,
  partEnd,
  progress,
  sceneEnd,
  statusAt,
  tutorialFor,
  typedCount,
  msPerCharacter,
  wordsText,
  type PhotoLook,
  type TutorialIcon,
  type TutorialId,
  type TutorialPart,
  type Words,
} from "./sellerTutorials";

/** A small "Show me" beside a step, opening that step's tutorial. */
export function ShowMe({ tutorial, className = "" }: { tutorial: TutorialId; className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const title = t(tutorialFor(tutorial).title);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("howTo.showMeName", { title })}
        className={`${smallButtonClass.secondary} shrink-0 ${className}`}
      >
        <PlayCircle className="size-3.5" aria-hidden />
        {t("howTo.showMe")}
      </button>
      {open ? <TutorialPlayer tutorial={tutorial} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** The words of a scene in the language shown. */
function useSay() {
  const { t, locale } = useTranslation();
  return useMemo(() => {
    const department = (slug: string) => {
      const row = DEPARTMENTS.find(entry => entry.slug === slug);
      return row ? (locale === "ar" ? row.nameAr : row.name) : slug;
    };
    return (words: Words) => wordsText(words, (key: MessageKey, params) => t(key, params), department);
  }, [t, locale]);
}

/** Milliseconds since the scene began, ticking until it has stopped moving; its end at once under reduced motion. */
function useSceneClock(run: string, end: number, still: boolean): number {
  const [now, setNow] = useState(still ? Number.POSITIVE_INFINITY : 0);
  useEffect(() => {
    if (still) {
      setNow(Number.POSITIVE_INFINITY);
      return;
    }
    setNow(0);
    let frame = 0;
    const start = performance.now();
    const tick = (time: number) => {
      const elapsed = time - start;
      setNow(elapsed);
      if (elapsed < end + 200) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [run, end, still]);
  return now;
}

export function TutorialPlayer({ tutorial, onClose }: { tutorial: TutorialId; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const say = useSay();
  const still = useMediaQuery("(prefers-reduced-motion: reduce)");
  const lesson = tutorialFor(tutorial);
  const [index, setIndex] = useState(0);
  const [round, setRound] = useState(0);
  const scene = lesson.scenes[index]!;
  const length = (words: Words) => characters(say(words));
  const end = sceneEnd(scene, length);
  const now = useSceneClock(`${index}:${round}:${locale}`, end, still);
  const last = index === lesson.scenes.length - 1;
  const titleId = useId();
  const close = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);

  useOverlay(true, onClose);
  /* Declared after `useOverlay`, so the opener is recorded before focus moves in. */
  useEffect(() => { close.current?.focus(); }, []);

  const back = () => {
    if (index === 0) return;
    setIndex(index - 1);
    /* Back goes away on the first step, and a button that goes away drops the
       keyboard on <body>: it lands on Next instead. */
    if (index === 1) requestAnimationFrame(() => next.current?.focus());
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" aria-label={t("common.close")} tabIndex={-1} onClick={onClose} className="overlay-scrim absolute inset-0 bg-[#06142e]/45" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="overlay-sheet relative flex max-h-[92svh] w-full flex-col overflow-y-auto rounded-t-3xl bg-white shadow-[0_24px_60px_-20px_rgba(10,40,90,0.45)] sm:max-w-[30rem] sm:rounded-3xl"
      >
        <div className="flex items-start gap-3 px-5 pt-5 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[18px] leading-7 font-bold text-[#0a285a]">{t(lesson.title)}</h2>
            <p className="text-[13px] ink-muted">{t("howTo.stepOf", { n: index + 1, total: lesson.scenes.length })}</p>
          </div>
          <button ref={close} type="button" onClick={onClose} aria-label={t("common.close")} className="-me-2 -mt-1 grid size-11 shrink-0 place-items-center rounded-full text-[#0a285a]">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {lesson.scenes.length > 1 ? (
          <div aria-hidden className="mt-3 flex gap-1.5 px-5 sm:px-6">
            {lesson.scenes.map((_, step) => (
              <span key={step} className="h-1 flex-1 overflow-hidden rounded-full bg-[#e7edf5]">
                <span
                  className="block h-full rounded-full bg-[#0a285a]"
                  style={{ width: `${step < index ? 100 : step > index ? 0 : Math.round(progress(0, now, Math.max(1, end)) * 100)}%` }}
                />
              </span>
            ))}
          </div>
        ) : null}

        <div className="px-5 pt-4 sm:px-6">
          <div aria-hidden className="rounded-2xl bg-[#f1f4f9] p-3 sm:p-4">
            <div className="grid min-h-[14rem] content-start gap-3 rounded-xl border border-[#e1e7ef] bg-white p-4 shadow-[0_1px_2px_rgba(10,40,90,0.05)] [&>*]:min-w-0">
              {scene.parts.map((part, at) => (
                <Part key={`${index}-${at}`} part={part} now={now} say={say} length={length} />
              ))}
            </div>
          </div>
          <p aria-live="polite" className="mt-4 text-[15px] leading-6 font-medium text-[#0a285a]">{say(scene.caption)}</p>
          <p className="mt-1 text-[12px] ink-muted">{t("howTo.example")}</p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#eef1f5] px-5 py-4 sm:px-6">
          {!still ? (
            <button type="button" onClick={() => setRound(round + 1)} className={`${smallButtonClass.secondary} me-auto`}>
              <RotateCcw className="size-3.5" aria-hidden />{t("howTo.replay")}
            </button>
          ) : <span className="me-auto" />}
          {index > 0 ? (
            <button type="button" onClick={back} className={buttonClass.secondary}>{t("howTo.back")}</button>
          ) : null}
          <button ref={next} type="button" onClick={() => (last ? onClose() : setIndex(index + 1))} className={buttonClass.primary}>
            {t(last ? "howTo.done" : "howTo.next")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------------------------------------------------------------------------
 * The parts. Each frame is drawn from `now` alone.
 * ------------------------------------------------------------------------- */

type Say = (words: Words) => string;

/** A part rises into place as it appears. */
function appear(at: number, now: number): CSSProperties {
  const p = progress(at, now, 300);
  return { opacity: p, transform: `translateY(${(1 - p) * 6}px)` };
}

/** The ring a press leaves, and the dip of the press itself. */
function pressed(at: number, now: number): CSSProperties {
  const p = progress(at, now, 520);
  if (p <= 0 || p >= 1) return {};
  return {
    boxShadow: `0 0 0 ${3 + 9 * p}px rgba(242, 104, 58, ${0.4 * (1 - p)})`,
    transform: `scale(${p < 0.35 ? 0.96 : 1})`,
  };
}

const ICONS: Record<TutorialIcon, typeof Check> = { sparkles: Sparkles, upload: Upload, plus: Plus, download: Download, check: Check, send: Send };

function Label({ children }: { children: ReactNode }) {
  return <span className="block text-[12px] leading-5 font-semibold text-[#0a285a]">{children}</span>;
}

function Part({ part, now, say, length }: { part: TutorialPart; now: number; say: Say; length: (words: Words) => number }) {
  switch (part.kind) {
    case "field": {
      const text = say(part.value);
      const shown = part.fill ? (now >= part.at ? text : "") : Array.from(text).slice(0, typedCount(characters(text), part.at, now)).join("");
      const typingEnd = partEnd(part, length);
      const focused = now >= part.at - 200 && now < typingEnd + 300;
      const flash = part.fill ? 1 - progress(part.at, now, 700) : 0;
      const caret = focused && !part.fill && Number.isFinite(now) && Math.floor(now / msPerCharacter(characters(text)) / 8) % 2 === 0;
      return (
        <div>
          <Label>{say(part.label)}</Label>
          <div
            dir={part.dir ?? "auto"}
            className={`mt-1 rounded-[10px] border px-3 py-2 text-[13px] leading-5 text-[#16213a] ${(part.lines ?? 1) > 1 ? "min-h-[4.5rem] whitespace-pre-wrap" : "min-h-9 truncate"} ${focused ? "border-[#0a285a] ring-[3px] ring-[#0a285a]/12" : "border-[#cfd9e6]"}`}
            style={{ backgroundColor: flash > 0 && flash < 1 ? `rgba(242, 104, 58, ${0.14 * flash})` : "white" }}
          >
            {shown}
            {caret ? <span className="ms-px inline-block h-4 w-[1.5px] translate-y-[3px] bg-[#0a285a]" /> : null}
          </div>
        </div>
      );
    }
    case "select": {
      const chosen = now >= part.at + 220;
      return (
        <div>
          <Label>{say(part.label)}</Label>
          <div className="mt-1 flex min-h-9 items-center justify-between gap-2 rounded-[10px] border border-[#cfd9e6] bg-white px-3 py-2 text-[13px] transition-none" style={pressed(part.at, now)}>
            <span className={chosen ? "text-[#16213a]" : "text-[#8796ab]"}>{chosen ? say(part.value) : "—"}</span>
            <ChevronDown className="size-4 text-[#536b8c]" />
          </div>
        </div>
      );
    }
    case "button": {
      const Icon = part.icon ? ICONS[part.icon] : null;
      return (
        <div>
          <span
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3.5 text-[13px] font-semibold ${part.tone === "primary" ? "bg-[#0a285a] text-white" : "border border-[#cfd9e6] bg-white text-[#0a285a]"}`}
            style={pressed(part.at, now)}
          >
            {Icon ? <Icon className="size-3.5" /> : null}
            {say(part.label)}
          </span>
        </div>
      );
    }
    case "photos":
      return (
        <div className="flex flex-wrap gap-2">
          {part.at.map((at, slot) => {
            const p = progress(at, now, 360);
            return (
              <div key={slot} className="relative size-16 rounded-lg border border-dashed border-[#cfd9e6] bg-[#fafbfd]">
                {p > 0 ? (
                  <div className="absolute inset-0 overflow-hidden rounded-lg border border-[#e1e7ef]" style={{ opacity: p, transform: `translateY(${(1 - p) * -10}px) scale(${0.9 + 0.1 * p})` }}>
                    <Photo look="fixed" />
                    {slot === 0 ? <CoverTag /> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      );
    case "fix": {
      const chosen = now >= part.at ? part.pick : 0;
      return (
        <div className="flex flex-wrap items-start gap-3">
          {part.options.map((option, slot) => (
            <div key={slot} className="w-[5.5rem]">
              <div
                className={`overflow-hidden rounded-lg border-2 ${option.look === "square" ? "aspect-square" : "aspect-[4/3]"} ${slot === chosen ? "border-[#0a285a]" : "border-[#e1e7ef]"}`}
                style={slot === part.pick ? pressed(part.at, now) : undefined}
              >
                <Photo look={option.look} />
              </div>
              <span className={`mt-1 block text-[11px] leading-4 ${slot === chosen ? "font-semibold text-[#0a285a]" : "text-[#536b8c]"}`}>{say(option.label)}</span>
            </div>
          ))}
        </div>
      );
    }
    case "rows":
      return <Rows part={part} now={now} say={say} />;
    case "bullets":
      return (
        <div className="rounded-lg bg-[#f6f8fb] px-3 py-2">
          <span className="text-[11px] font-semibold text-[#536b8c]">{say(part.title)}</span>
          <ul className="mt-1 space-y-0.5">
            {part.items.map((item, at) => (
              <li key={at} style={appear(item.at, now)} className="flex items-center gap-2 text-[13px] text-[#16213a]">
                <span className="size-1.5 shrink-0 rounded-full bg-[#0a285a]" />{say(item.text)}
              </li>
            ))}
          </ul>
        </div>
      );
    case "chips": {
      const chosen = now >= part.at ? part.pick : -1;
      return (
        <div style={appear(part.at - 400, now)}>
          <Label>{say(part.label)}</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            {part.items.map((item, slot) => (
              <span
                key={slot}
                className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${slot === chosen ? "border-[#0a285a] bg-[#0a285a] text-white" : "border-[#cfd9e6] bg-white text-[#0a285a]"}`}
                style={slot === part.pick ? pressed(part.at, now) : undefined}
              >
                {say(item)}
              </span>
            ))}
          </div>
        </div>
      );
    }
    case "status": {
      const current = statusAt(part.items, now);
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {part.items.slice(0, current + 1).map((item, slot) => (
            <span key={slot} className="flex items-center gap-1.5" style={appear(item.at, now)}>
              {slot > 0 ? <ChevronRight className="size-3.5 text-[#8796ab] rtl:-scale-x-100" /> : null}
              <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${STATUS_TONE[item.tone]} ${slot < current ? "opacity-55" : ""}`}>{say(item.label)}</span>
            </span>
          ))}
        </div>
      );
    }
    case "card":
      return <MockCard was={part.was === true} style={appear(part.at, now)} say={say} />;
    case "search":
      return <MockSearch style={appear(part.at, now)} say={say} />;
    case "note":
      return (
        <p className="flex items-start gap-1.5 text-[12px] leading-5" style={appear(part.at, now)}>
          {part.tone === "ok" ? <Check className="mt-0.5 size-3.5 shrink-0 text-[#2f5d33]" /> : <Info className="mt-0.5 size-3.5 shrink-0 text-[#0a285a]" />}
          <span className={part.tone === "ok" ? "text-[#2f5d33]" : "text-[#3d5376]"}>{say(part.text)}</span>
        </p>
      );
  }
}

const STATUS_TONE = {
  muted: "bg-[#eef1f5] text-[#3d5376]",
  waiting: "bg-[#fff1d6] text-[#7a4f00]",
  live: "bg-[#e3f1e5] text-[#2f5d33]",
} as const;

function Rows({ part, now, say }: { part: Extract<TutorialPart, { kind: "rows" }>; now: number; say: Say }) {
  if (part.style === "list") {
    return (
      <ul className="space-y-1.5">
        {part.rows.map((row, at) => (
          <li key={at} style={appear(row.at, now)} className="flex items-baseline gap-2 text-[13px]">
            <Check className="size-3.5 shrink-0 translate-y-0.5 text-[#2f5d33]" />
            <span className="shrink-0 text-[#536b8c]">{say(row.cells[0]!)}</span>
            <span dir="auto" className="min-w-0 truncate font-semibold text-[#16213a]">{say(row.cells[1]!)}</span>
          </li>
        ))}
      </ul>
    );
  }
  const sheet = part.style === "sheet";
  const columns = { gridTemplateColumns: `minmax(0, 1.6fr) repeat(${Math.max(0, (part.head?.length ?? 1) - 1)}, minmax(0, 1fr))` };
  return (
    <div className={`overflow-hidden text-[12px] ${sheet ? "rounded-md border border-[#cfd9e6]" : "rounded-lg border border-[#e1e7ef]"}`}>
      {part.head ? (
        <div className={`grid ${sheet ? "bg-[#e9f0e6] divide-x divide-[#cfd9e6] rtl:divide-x-reverse" : "bg-[#f6f8fb]"}`} style={columns}>
          {part.head.map((cell, at) => <span key={at} className="px-2 py-1.5 leading-4 font-semibold break-words text-[#3d5376]">{say(cell)}</span>)}
        </div>
      ) : null}
      {part.rows.map((row, at) => (
        <div key={at} className={`grid border-t ${sheet ? "border-[#cfd9e6] divide-x divide-[#cfd9e6] rtl:divide-x-reverse" : "border-[#eef1f5]"}`} style={{ ...columns, ...appear(row.at, now) }}>
          {row.cells.map((cell, slot) => (
            <span key={slot} dir={slot === 0 ? "auto" : "ltr"} className={`truncate px-2 py-1.5 text-[#16213a] ${slot === 0 ? "" : "text-start tabular-nums"}`}>{say(cell)}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

function CoverTag() {
  const { t } = useTranslation();
  return <span className="absolute start-1 top-1 rounded bg-[#0a285a] px-1 text-[10px] leading-4 font-semibold text-white">{t("admin.newPhotoCover")}</span>;
}

/** The example lamp in one of its three looks. */
function Photo({ look }: { look: PhotoLook }) {
  const raw = look === "raw";
  return (
    <div className="grid size-full place-items-center" style={{ backgroundColor: raw ? "#d6d0c5" : "#ffffff" }}>
      <Lamp style={raw ? { transform: "translate(14%, 12%) rotate(-7deg) scale(0.7)", filter: "brightness(0.78) saturate(0.7)" } : { transform: `scale(${look === "square" ? 0.92 : 0.84})` }} />
    </div>
  );
}

/** A brass table lamp, drawn in a 100-unit square; the app's `TutorialLamp` uses the same points. */
export function Lamp({ style }: { style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 100 100" className="size-full" style={style}>
      <circle cx="50" cy="17" r="2.6" fill="#b5873a" />
      <path d="M31 22 H69 L80 50 H20 Z" fill="#f4e6c8" stroke="#d9c39a" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M22.5 44 H77.5 L80 50 H20 Z" fill="#e8d4ac" />
      <rect x="44" y="50" width="12" height="3.4" rx="1.4" fill="#a77a2c" />
      <rect x="47.2" y="53" width="5.6" height="27" fill="#c4963f" />
      <ellipse cx="50" cy="84" rx="18" ry="5.2" fill="#a77a2c" />
      <ellipse cx="50" cy="82.4" rx="15.5" ry="3.2" fill="#cfa14b" />
    </svg>
  );
}

function MockCard({ was, style, say }: { was: boolean; style: CSSProperties; say: Say }) {
  const money = useMoney();
  return (
    <div className="w-40 overflow-hidden rounded-xl border border-[#e1e7ef] bg-white" style={style}>
      <div className="relative aspect-square bg-white">
        <Lamp style={{ transform: "scale(0.86)" }} />
        {was ? <span dir="ltr" className="absolute start-1.5 top-1.5 rounded-md bg-[#f2683a] px-1.5 text-[11px] leading-5 font-bold text-[#0a285a]">−17%</span> : null}
      </div>
      <div className="border-t border-[#eef1f5] px-2.5 py-2">
        <p dir="auto" className="truncate text-[12px] font-semibold text-[#16213a]">{say({ key: "howTo.sample.title" })}</p>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[13px] font-bold text-[#0a285a]">
          {money({ amount: "12.500", currencyCode: "KWD" })}
          {was ? <span className="text-[11px] font-normal text-[#536b8c] line-through">{money({ amount: "15.000", currencyCode: "KWD" })}</span> : null}
        </p>
      </div>
    </div>
  );
}

function MockSearch({ style, say }: { style: CSSProperties; say: Say }) {
  return (
    <div className="rounded-lg border border-[#e1e7ef] p-3" style={style}>
      <p className="truncate text-[11px] text-[#4d5156]"><bdi dir="ltr">netlet.net › products › brass-table-lamp</bdi></p>
      <p dir="auto" className="mt-0.5 text-[15px] leading-5 text-[#1a0dab]">{say({ key: "howTo.sample.title" })} — NetLet</p>
      <p dir="auto" className="mt-0.5 text-[12px] leading-5 text-[#4d5156]">{say({ key: "howTo.sample.snippet" })}</p>
    </div>
  );
}
