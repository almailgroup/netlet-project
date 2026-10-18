/**
 * The shop assistant's conversation: the whole screen on a phone, a card in
 * the end corner on a wide screen. Fetched the first time the button is
 * pressed and kept mounted after, hidden while closed, and kept for the tab
 * (`useAIChat`'s `persist`), so the conversation survives closing it, moving
 * between pages and a reload.
 *
 * **It wears the header's liquid glass, on the owner's word** — the same
 * layers (`.glass-bar-surface`, warped under a fine pointer) at the search
 * panel's even 70% (`.glass-panel`), so the page shows through it blurred.
 * The layers sit inside the panel behind its contents, never as a filter on
 * the panel, and the panel's entrance moves it by a transform and fades only
 * its contents: a fade on the surface would make it a backdrop root and turn
 * the blur to plain white while it played. **Everything with words on it is
 * a plate of white** — every answer, every starter, the box — except the
 * title and the lines beside it, which are navy and a dark slate, 4.5:1 or
 * better over the darkest thing that passes beneath (the navy Deals band).
 *
 * **On a phone it is a sheet over the dimmed page, sized to what the keyboard
 * leaves.** A keyboard covers the screen without shrinking the layout, so a
 * sheet sized to the screen put its own box under the keys; it follows the
 * visual viewport instead, the search sheet's rule, and gives up the gap
 * above it while the keyboard is up. It rises from the foot of the screen,
 * and goes back down on Close, on a press on the dim, or on a drag down from
 * its top — the handle says it can. There it is a modal (`useOverlay`:
 * Escape, focus back, the page held still); a wide screen's card leaves the
 * page usable beside it, closes on Escape from inside it, hands focus back to
 * the button, and can be made larger for reading (remembered on the device).
 *
 * **A question can be spoken** where the browser can listen and voice search
 * is on: what is heard is written into the box, never sent, so it is read
 * back and fixed before Send (`useDictation`), and the line under the box says
 * where the sound goes while it listens.
 *
 * It opens on what it can do, as presses fitted to the page: on a product,
 * that product by name and photo with questions about it; in a department,
 * help choosing there; anywhere, delivery, returns, paying and finding
 * something. A search the model offers is NetLet's own shelf for those words
 * (`ChatAnswer`), and following anything out of the answer on a phone puts the
 * chat away so the page can be seen.
 *
 * **The log follows the newest words only while the reader is at the
 * bottom.** Somebody who scrolled up to reread an answer is not dragged down
 * by the next one arriving; a "Latest" button says there is more below. A
 * message sent or arriving rises into place; one restored from the tab, or
 * already there when the panel opens again, does not.
 *
 * An answer that finishes while the panel is closed says so on the button
 * (`onAnswered`), since somebody who closed it mid-answer has no other way to
 * know it is there.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { ArrowDown, ChevronRight, LayoutGrid, Maximize2, Mic, Minimize2, Package, RotateCcw, Search, Send, Sparkles, Square, Truck, Undo2, Wallet, X } from "lucide-react";
import { ChatAnswer } from "@/components/assistant/ChatAnswer";
import { Thumb } from "@/components/product/Thumb";
import { chatDraftProblem, useAIChat } from "@/hooks/useAIChat";
import { useDictation } from "@/hooks/useDictation";
import { useFeature } from "@/hooks/useFeature";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { gatewayErrorMessage } from "@/lib/aiGateway";
import { readStored, writeStored } from "@/lib/browserStore";
import { canListen } from "@/lib/speech";
import type { ProductBrief } from "@shared/commerce/assistant";
import { departmentByName } from "@shared/commerce/departments";
import { MAX_CHAT_TEXT } from "@shared/ai/gateway";
import type { MessageKey } from "@shared/i18n/dictionary";

/** The tab's conversation, in `sessionStorage`. */
const CHAT_KEY = "netlet:shop-chat";
/** The count beside the box appears this close to the limit. */
const COUNT_FROM = MAX_CHAT_TEXT - 200;
/** Whether the wide card was made larger, on this device. */
const SIZE_KEY = "netlet:shop-chat-size";
/** How far the phone's sheet is dragged down before letting go closes it. */
const DRAG_CLOSE = 110;
/** How long the sheet takes to go back down, matching `.chat-sheet`'s rise. */
const LEAVE_MS = 220;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

type Starter = { key: MessageKey; params?: Record<string, string>; icon: ReactNode };

/** A round navy mark with the sparkle, which is the assistant wherever it speaks. */
function Mark({ size }: { size: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "size-14" : size === "md" ? "size-10" : "size-7";
  const icon = size === "lg" ? "size-6" : size === "md" ? "size-[18px]" : "size-3.5";
  return (
    <span aria-hidden className={`${box} grid shrink-0 place-items-center rounded-full bg-[#0a285a] text-white shadow-[0_4px_12px_rgba(10,40,90,.25)]`}>
      <Sparkles className={icon} />
    </span>
  );
}

export function ShopChatPanel({ open, onClose, onAnswered, product, department }: {
  open: boolean;
  /** `true` hands focus back to the button; following a link out does not. */
  onClose: (refocus: boolean) => void;
  /** An answer finished while the panel was closed. */
  onAnswered?: () => void;
  /** The product the shopper is looking at, when they are on one. */
  product: { brief: ProductBrief; image: string | null } | null;
  /** The department the page is in, by its catalogue name. */
  department: string | null;
}) {
  const { t, isArabic } = useTranslation();
  const wide = useMediaQuery("(min-width: 1024px)");
  const chat = useAIChat({ product: product?.brief ?? null, persist: CHAT_KEY });
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [behind, setBehind] = useState(false);
  const [viewport, setViewport] = useState<{ top: number; height: number; keyboard: boolean } | null>(null);
  const [large, setLarge] = useState(() => readStored(SIZE_KEY) === "large");
  const [pull, setPull] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const drag = useRef<{ y: number; at: number; id: number } | null>(null);
  const busy = chat.status !== "idle";
  const problem = chatDraftProblem(draft);
  const last = chat.messages[chat.messages.length - 1];
  const failed = last?.role === "assistant" && last.state === "failed" ? last : null;

  /* What was on screen before this mount does not rise; what arrives after does. */
  const settled = useRef<Set<number> | null>(null);
  if (settled.current === null) settled.current = new Set(chat.messages.map(message => message.id));

  /* Speaking into the box: what is heard goes after anything already typed. */
  const voiceOn = useFeature("voiceSearch") && canListen();
  const spokenAfter = useRef("");
  const dictation = useDictation({ arabic: isArabic, onHeard: text => setDraft(`${spokenAfter.current}${text}`) });
  const listen = () => {
    if (dictation.listening) { dictation.stop(); return; }
    spokenAfter.current = draft.trim() ? `${draft.trim()} ` : "";
    dictation.start();
  };
  const wasListening = useRef(false);
  useEffect(() => {
    if (wasListening.current && !dictation.listening) {
      const box = field.current;
      box?.focus({ preventScroll: true });
      box?.setSelectionRange(box.value.length, box.value.length);
    }
    wasListening.current = dictation.listening;
  }, [dictation.listening]);

  /* The phone's sheet goes back down before it is gone; a wide card simply closes. */
  const dismiss = (refocus: boolean) => {
    if (leaving) return;
    dictation.cancel();
    if (wide || reducedMotion()) { onClose(refocus); return; }
    setLeaving(true);
    window.setTimeout(() => { setLeaving(false); setPull(0); onClose(refocus); }, LEAVE_MS);
  };
  const close = () => dismiss(true);
  useOverlay(open && !wide, close);

  /* Into the box on opening, so the first key pressed is the first word typed. */
  useEffect(() => {
    if (!open) { dictation.cancel(); return; }
    setPull(0);
    field.current?.focus({ preventScroll: true });
  }, [open, dictation.cancel]);

  /* An answer that lands while the panel is closed is news for the button. */
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy && !open && last?.role === "assistant" && last.state === "done") onAnswered?.();
    wasBusy.current = busy;
  }, [busy, open, last, onAnswered]);

  /* The phone's sheet is what the keyboard leaves of the screen. */
  useLayoutEffect(() => {
    if (!open || wide) return;
    const view = window.visualViewport;
    if (!view) return;
    const place = () => setViewport({
      top: Math.round(view.offsetTop),
      height: Math.round(view.height),
      keyboard: window.innerHeight - view.height > 120,
    });
    place();
    view.addEventListener("resize", place);
    view.addEventListener("scroll", place);
    return () => {
      view.removeEventListener("resize", place);
      view.removeEventListener("scroll", place);
    };
  }, [open, wide]);

  /* Follow the newest words while the reader is at the bottom; otherwise say there are more. */
  useEffect(() => {
    if (!open) return;
    if (pinned.current) log.current?.scrollTo({ top: log.current.scrollHeight });
    else if (chat.messages.length) setBehind(true);
  }, [chat.messages.length, last?.text, last?.state, open]);

  const toLatest = () => {
    pinned.current = true;
    setBehind(false);
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  };

  /* The box grows with what is typed, up to five lines, then scrolls. */
  useLayoutEffect(() => {
    const box = field.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 132)}px`;
  }, [draft]);

  /*
   * The box keeps focus on a wide screen, ready for the next question. A
   * phone's does not take it from a press on a suggestion: that would raise
   * the keyboard over the answer being waited for.
   */
  const send = (text: string) => {
    if (busy || chatDraftProblem(text)) return;
    dictation.cancel();
    setDraft("");
    pinned.current = true;
    setBehind(false);
    void chat.send(text);
    if (wide || document.activeElement === field.current) field.current?.focus({ preventScroll: true });
  };

  /* Following something out of an answer on a phone puts the chat away so the page shows. */
  const leave = wide ? undefined : () => { dictation.cancel(); onClose(false); };

  const resize = () => {
    setLarge(current => {
      writeStored(SIZE_KEY, current ? "normal" : "large");
      return !current;
    });
  };

  /* A drag down from the sheet's top, past the line or flicked, puts it away. */
  const grab = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (wide || (event.target as HTMLElement).closest("button")) return;
      drag.current = { y: event.clientY, at: event.timeStamp, id: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (drag.current?.id !== event.pointerId) return;
      setPull(Math.max(0, event.clientY - drag.current.y));
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      const start = drag.current;
      drag.current = null;
      if (!start) return;
      const distance = event.clientY - start.y;
      const speed = distance / Math.max(1, event.timeStamp - start.at);
      if (distance > DRAG_CLOSE || (distance > 32 && speed > 0.6)) close();
      else setPull(0);
    },
    onPointerCancel: () => { drag.current = null; setPull(0); },
  };

  const shown = department ? departmentByName(department) : null;
  const starters: Starter[] = product
    ? [
        { key: "shopChat.askProduct", icon: <Package className="size-4" /> },
        { key: "shopChat.askUse", icon: <Sparkles className="size-4" /> },
        { key: "shopChat.askCompare", icon: <Search className="size-4" /> },
        { key: "shopChat.askDelivery", icon: <Truck className="size-4" /> },
      ]
    : [
        ...(department ? [{ key: "shopChat.askDepartment" as MessageKey, params: { department: shown ? t(shown.label) : department }, icon: <LayoutGrid className="size-4" /> }] : []),
        { key: "shopChat.askFind", icon: <Search className="size-4" /> },
        { key: "shopChat.askDelivery", icon: <Truck className="size-4" /> },
        { key: "shopChat.askReturns", icon: <Undo2 className="size-4" /> },
        { key: "shopChat.askPay", icon: <Wallet className="size-4" /> },
      ];

  const titleId = "shop-chat-title";
  const iconButton = "grid size-10 shrink-0 place-items-center rounded-full bg-white/70 text-[#0a285a] ring-1 ring-white/80 hover:bg-[#f0f2f5]";
  /* The sheet's gap above it, given up while the keyboard is up. */
  const sheetStyle: CSSProperties | undefined = wide ? undefined : {
    ["--sheet-gap" as string]: viewport?.keyboard ? "0.5rem" : "max(2.75rem, calc(env(safe-area-inset-top) + 1rem))",
    top: `calc(${viewport?.top ?? 0}px + var(--sheet-gap))`,
    height: viewport ? `calc(${viewport.height}px - var(--sheet-gap))` : "calc(100dvh - var(--sheet-gap))",
    translate: leaving ? "0 100%" : pull ? `0 ${pull}px` : undefined,
    transition: drag.current ? "none" : `translate ${LEAVE_MS}ms cubic-bezier(0.3, 0, 0.8, 0.15)`,
  };
  return (
    <>
      {!wide && open ? (
        /* The dim over the page, under the sheet: a press on it puts the sheet away. */
        <div
          aria-hidden
          onClick={close}
          className={`chat-scrim fixed inset-0 z-[69] bg-[#0a1a33]/35 transition-opacity duration-200 ${leaving ? "opacity-0" : ""}`}
        />
      ) : null}
      <div
        role="dialog"
        aria-modal={!wide || undefined}
        aria-labelledby={titleId}
        onKeyDown={event => {
          if (wide && event.key === "Escape") {
            event.stopPropagation();
            close();
          }
        }}
        style={sheetStyle}
        className={`${open ? "flex" : "hidden"} glass-panel chat-panel flex-col ${wide
          ? `fixed end-6 z-50 rounded-[28px] border border-white/70 shadow-[0_24px_60px_rgba(10,40,90,.28)] motion-safe:transition-[width,height] motion-safe:duration-200 ${large
            /* Larger, it comes down to the foot of the screen — the button is out of the page while it is open — and stops under the header's bar. */
            ? "bottom-6 h-[min(860px,calc(100dvh-7.5rem))] w-[min(680px,calc(100vw-3rem))]"
            : "bottom-24 h-[min(640px,calc(100dvh-8rem))] w-[400px]"}`
          : "chat-sheet fixed inset-x-0 z-[70] rounded-t-[28px] border-t border-white/70 shadow-[0_-12px_40px_rgba(10,40,90,.22)]"}`}
      >
      {/* The header's glass, behind everything in the panel and inside its corners. */}
      <span aria-hidden className="glass-bar-surface glass-bar-round">
        <span className="glass-bar-bend" />
        <span className="glass-bar-face" />
      </span>

      <div className="chat-panel-body flex min-h-0 flex-1 flex-col">
        <div {...grab} className={wide ? "" : "touch-none select-none"}>
          {wide ? null : <span aria-hidden className="mx-auto mt-2 block h-1.5 w-10 rounded-full bg-[#0a285a]/25" />}
          <div className="flex items-center gap-3 px-4 pb-3 pt-2.5 lg:pt-4">
            <Mark size="md" />
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[16px] leading-6 font-extrabold text-[#0a285a]">{t("shopChat.title")}</h2>
              <p className="text-[12px] leading-5 font-medium text-[#2b3a55]">{t("shopChat.note")}</p>
            </div>
            {chat.messages.length ? (
              <button
                type="button"
                onClick={() => { chat.reset(); setDraft(""); pinned.current = true; setBehind(false); field.current?.focus(); }}
                aria-label={t("shopChat.newChat")}
                title={t("shopChat.newChat")}
                className={iconButton}
              >
                <RotateCcw className="size-[18px]" aria-hidden />
              </button>
            ) : null}
            {wide ? (
              <button
                type="button"
                onClick={resize}
                aria-label={t(large ? "shopChat.shrink" : "shopChat.expand")}
                title={t(large ? "shopChat.shrink" : "shopChat.expand")}
                className={iconButton}
              >
                {large ? <Minimize2 className="size-[18px] rtl:-scale-x-100" aria-hidden /> : <Maximize2 className="size-[18px] rtl:-scale-x-100" aria-hidden />}
              </button>
            ) : null}
            <button type="button" onClick={close} aria-label={t("shopChat.close")} title={t("shopChat.close")} className={iconButton}>
              <X className="size-5" aria-hidden />
            </button>
          </div>
        </div>
        <div aria-hidden className="mx-4 h-px bg-[#0a285a]/10" />

        <div className="relative min-h-0 flex-1">
          <div
            ref={log}
            role="log"
            aria-busy={busy}
            aria-label={t("shopChat.title")}
            onScroll={event => {
              const box = event.currentTarget;
              const near = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
              pinned.current = near;
              if (near) setBehind(false);
            }}
            className="absolute inset-0 space-y-4 overflow-y-auto overscroll-contain px-4 py-4"
          >
            {product ? (
              <p className="flex items-center gap-2.5 rounded-2xl bg-white/90 p-2 pe-3 ring-1 ring-white">
                <span className="size-10 shrink-0 overflow-hidden rounded-xl bg-[#f4f6f9]">
                  <Thumb src={product.image} alt="" className="size-full object-cover" icon={<Package className="size-4 text-[#536b8c]" />} />
                </span>
                <span className="min-w-0 text-[12px] leading-4">
                  <span className="block font-semibold ink-muted">{t("shopChat.aboutProduct")}</span>
                  <bdi dir="auto" className="block truncate text-[13px] font-bold text-[#0a285a]">{product.brief.title}</bdi>
                </span>
              </p>
            ) : null}

            {chat.messages.length === 0 ? (
              <>
                <div className="flex flex-col items-center px-2 pt-3 text-center">
                  <Mark size="lg" />
                  <p className="mt-3 text-[19px] leading-7 font-extrabold text-[#0a285a]">{t("shopChat.welcome")}</p>
                  <p className="mt-1 max-w-[34ch] text-[14px] leading-6 font-medium text-[#2b3a55]">{t("shopChat.greeting")}</p>
                </div>
                <div>
                  <p className="mb-2 px-1 text-[12px] font-bold text-[#2b3a55]">{t("shopChat.suggestions")}</p>
                  <ul className="grid gap-2">
                    {starters.map(starter => (
                      <li key={starter.key}>
                        <button
                          type="button"
                          onClick={() => send(t(starter.key, starter.params))}
                          className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-white/90 px-3 py-2 text-start text-[14px] font-semibold text-[#0a285a] ring-1 ring-white hover:bg-[#f0f2f5]"
                        >
                          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-[#eef2f8] text-[#0a285a]">{starter.icon}</span>
                          <span className="min-w-0 flex-1">{t(starter.key, starter.params)}</span>
                          <ChevronRight aria-hidden className="size-4 shrink-0 text-[#0a285a]/50 rtl:-scale-x-100" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : null}

            {chat.messages.map(message => message.role === "user" ? (
              <p key={message.id} dir="auto" className={`ms-auto w-fit max-w-[85%] whitespace-pre-line rounded-[20px] rounded-se-md bg-[#0a285a] px-4 py-2.5 text-[14px] leading-6 font-medium text-white shadow-[0_4px_12px_rgba(10,40,90,.2)] ${settled.current?.has(message.id) ? "" : "chat-rise"}`}>
                <span className="sr-only">{t("shopChat.you")} </span>{message.text}
              </p>
            ) : message.text || message.state === "streaming" || message === failed ? (
              <div key={message.id} className={`flex items-start gap-2 ${settled.current?.has(message.id) ? "" : "chat-rise"}`}>
                <span className="mt-1"><Mark size="sm" /></span>
                <div className="min-w-0 flex-1 space-y-2">
                  <span className="sr-only">{t("shopChat.them")}</span>
                  {message.text ? (
                    <ChatAnswer
                      message={message}
                      note="shopChat.generated"
                      onNavigate={leave}
                      onAsk={message === last && !busy ? send : undefined}
                    />
                  ) : message.state === "streaming" ? (
                    <span className="inline-flex gap-1 rounded-[20px] rounded-ss-md bg-white px-4 py-3.5 ring-1 ring-[#0a285a]/[.07]" aria-hidden>
                      {[0, 1, 2].map(dot => <span key={dot} className="size-1.5 animate-pulse rounded-full bg-[#0a285a]/45" style={{ animationDelay: `${dot * 160}ms` }} />)}
                    </span>
                  ) : null}
                  {message === failed ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-white px-3.5 py-2.5 ring-1 ring-[#efc6bd]">
                      <p className="min-w-0 flex-1 text-[13px] font-semibold text-[#8c2f22]">{t(gatewayErrorMessage(chat.error ?? "model_unavailable"))}</p>
                      <button type="button" onClick={() => { pinned.current = true; chat.retry(); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[#0a285a] px-3.5 text-[13px] font-bold text-white hover:bg-[#0d3372]">
                        <RotateCcw className="size-3.5" aria-hidden />{t("shopChat.retry")}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null)}
          </div>

          {behind ? (
            <button
              type="button"
              onClick={toLatest}
              className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#0a285a] px-3.5 py-2 text-[13px] font-bold text-white shadow-[0_8px_20px_rgba(10,40,90,.3)] hover:bg-[#0d3372]"
            >
              <ArrowDown className="size-4" aria-hidden />{t("shopChat.latest")}
            </button>
          ) : null}
        </div>

        <form
          onSubmit={event => { event.preventDefault(); send(draft); }}
          className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 lg:pb-3"
        >
          <div aria-live="polite">
            {problem?.kind === "contact" || problem?.kind === "tooLong" || (chat.error && !failed && !problem) ? (
              <p className="mb-2 rounded-xl bg-white px-3 py-2 text-[13px] font-semibold text-[#8c2f22] ring-1 ring-[#efc6bd]">
                {t(problem?.kind === "contact" ? "ai.error.contact" : problem?.kind === "tooLong" ? "ai.error.tooLarge" : gatewayErrorMessage(chat.error!))}
              </p>
            ) : dictation.listening ? (
              <p className="mb-2 rounded-xl bg-white px-3 py-2 text-[12px] leading-5 font-medium text-[#2b3a55] ring-1 ring-white">
                <b className="font-bold text-[#0a285a]">{t("search.voiceListening")}</b> {t("search.voicePrivacy")}
              </p>
            ) : dictation.problem ? (
              <p className="mb-2 rounded-xl bg-white px-3 py-2 text-[13px] font-semibold text-[#8c2f22] ring-1 ring-[#efc6bd]">
                {t(dictation.problem === "denied" ? "search.voiceDeniedNote" : dictation.problem === "unsupported" ? "search.voiceUnsupported" : "search.voiceNothing")}
              </p>
            ) : null}
          </div>
          <div className="flex items-end gap-2 rounded-[26px] bg-white p-1.5 ps-4 shadow-[0_6px_20px_rgba(10,40,90,.12)] ring-1 ring-[#0a285a]/10 focus-within:ring-2 focus-within:ring-[#0a285a]/45">
            <textarea
              ref={field}
              dir="auto"
              rows={1}
              value={draft}
              maxLength={MAX_CHAT_TEXT + 1}
              onChange={event => {
                setDraft(event.target.value);
                if (chat.error && !failed) chat.dismissError();
                if (dictation.problem) dictation.dismiss();
              }}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send(draft);
                }
              }}
              placeholder={t(dictation.listening ? "search.voiceListening" : "shopChat.placeholder")}
              aria-label={t("shopChat.inputLabel")}
              aria-invalid={Boolean(problem && problem.kind !== "empty") || undefined}
              className="min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 text-[14px] leading-6 text-[#0a285a] outline-none placeholder:text-[#5b6b82]"
            />
            {draft.length >= COUNT_FROM ? (
              <span dir="ltr" className={`self-center text-[12px] font-semibold ${draft.length > MAX_CHAT_TEXT ? "text-[#8c2f22]" : "ink-muted"}`}>
                {draft.length}/{MAX_CHAT_TEXT}
              </span>
            ) : null}
            {voiceOn && !busy ? (
              <button
                type="button"
                onClick={listen}
                aria-label={t(dictation.listening ? "shopChat.stopListening" : "shopChat.speak")}
                title={t(dictation.listening ? "shopChat.stopListening" : "shopChat.speak")}
                aria-pressed={dictation.listening}
                className={`grid size-10 shrink-0 place-items-center rounded-full ${dictation.listening
                  ? "mic-listening bg-[#0a285a] text-white hover:bg-[#0d3372]"
                  : "text-[#0a285a] hover:bg-[#0a285a]/[.06]"}`}
              >
                <Mic className="size-[18px]" aria-hidden />
              </button>
            ) : null}
            {busy ? (
              <button type="button" onClick={chat.stop} aria-label={t("assistant.stop")} title={t("assistant.stop")} className="grid size-10 shrink-0 place-items-center rounded-full bg-[#0a285a] text-white hover:bg-[#0d3372]">
                <Square className="size-3.5 fill-current" aria-hidden />
              </button>
            ) : (
              <button
                type="submit"
                disabled={Boolean(problem)}
                aria-label={t("shopChat.send")}
                title={t("shopChat.send")}
                className="grid size-10 shrink-0 place-items-center rounded-full bg-[#0a285a] text-white hover:bg-[#0d3372] disabled:bg-[#0a285a]/35"
              >
                <Send className="size-4 rtl:-scale-x-100" aria-hidden />
              </button>
            )}
          </div>
        </form>
      </div>
      </div>
    </>
  );
}
