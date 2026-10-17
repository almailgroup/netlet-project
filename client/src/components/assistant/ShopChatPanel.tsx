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
 * **On a phone it is the whole screen, sized to what the keyboard leaves.** A
 * keyboard covers the screen without shrinking the layout, so a panel sized
 * to the screen put its own box under the keys; it follows the visual
 * viewport instead, the search sheet's rule. There it is a modal
 * (`useOverlay`: Escape, focus back, the page held still); a wide screen's
 * card leaves the page usable beside it, closes on Escape from inside it and
 * hands focus back to the button.
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
 * by the next one arriving; a "Latest" button says there is more below.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ChevronRight, LayoutGrid, Package, RotateCcw, Search, Send, Sparkles, Square, Truck, Undo2, Wallet, X } from "lucide-react";
import { ChatAnswer } from "@/components/assistant/ChatAnswer";
import { Thumb } from "@/components/product/Thumb";
import { chatDraftProblem, useAIChat } from "@/hooks/useAIChat";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { gatewayErrorMessage } from "@/lib/aiGateway";
import type { ProductBrief } from "@shared/commerce/assistant";
import { departmentByName } from "@shared/commerce/departments";
import { MAX_CHAT_TEXT } from "@shared/ai/gateway";
import type { MessageKey } from "@shared/i18n/dictionary";

/** The tab's conversation, in `sessionStorage`. */
const CHAT_KEY = "netlet:shop-chat";
/** The count beside the box appears this close to the limit. */
const COUNT_FROM = MAX_CHAT_TEXT - 200;

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

export function ShopChatPanel({ open, onClose, product, department }: {
  open: boolean;
  /** `true` hands focus back to the button; following a link out does not. */
  onClose: (refocus: boolean) => void;
  /** The product the shopper is looking at, when they are on one. */
  product: { brief: ProductBrief; image: string | null } | null;
  /** The department the page is in, by its catalogue name. */
  department: string | null;
}) {
  const { t } = useTranslation();
  const wide = useMediaQuery("(min-width: 1024px)");
  const chat = useAIChat({ product: product?.brief ?? null, persist: CHAT_KEY });
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [behind, setBehind] = useState(false);
  const [viewport, setViewport] = useState<{ top: number; height: number } | null>(null);
  const busy = chat.status !== "idle";
  const problem = chatDraftProblem(draft);
  const last = chat.messages[chat.messages.length - 1];
  const failed = last?.role === "assistant" && last.state === "failed" ? last : null;

  const close = () => onClose(true);
  useOverlay(open && !wide, close);

  /* Into the box on opening, so the first key pressed is the first word typed. */
  useEffect(() => {
    if (open) field.current?.focus({ preventScroll: true });
  }, [open]);

  /* The phone's panel is what the keyboard leaves of the screen. */
  useLayoutEffect(() => {
    if (!open || wide) return;
    const view = window.visualViewport;
    if (!view) return;
    const place = () => setViewport({ top: Math.round(view.offsetTop), height: Math.round(view.height) });
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

  const send = (text: string) => {
    if (busy || chatDraftProblem(text)) return;
    setDraft("");
    pinned.current = true;
    setBehind(false);
    void chat.send(text);
    field.current?.focus({ preventScroll: true });
  };

  /* Following something out of an answer on a phone puts the chat away so the page shows. */
  const leave = wide ? undefined : () => onClose(false);

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
  return (
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
      style={!wide && viewport ? { top: viewport.top, height: viewport.height } : undefined}
      className={`${open ? "flex" : "hidden"} glass-panel chat-panel flex-col ${wide
        ? "fixed bottom-24 end-6 z-50 h-[min(640px,calc(100dvh-8rem))] w-[400px] rounded-[28px] border border-white/70 shadow-[0_24px_60px_rgba(10,40,90,.28)]"
        : "fixed inset-x-0 top-0 z-[70] h-[100dvh]"}`}
    >
      {/* The header's glass, behind everything in the panel and inside its corners. */}
      <span aria-hidden className="glass-bar-surface glass-bar-round">
        <span className="glass-bar-bend" />
        <span className="glass-bar-face" />
      </span>

      <div className="chat-panel-body flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-3 px-4 pb-3 pt-[max(0.875rem,env(safe-area-inset-top))] lg:pt-4">
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
          <button type="button" onClick={close} aria-label={t("shopChat.close")} title={t("shopChat.close")} className={iconButton}>
            <X className="size-5" aria-hidden />
          </button>
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
              <p key={message.id} dir="auto" className="ms-auto w-fit max-w-[85%] whitespace-pre-line rounded-[20px] rounded-se-md bg-[#0a285a] px-4 py-2.5 text-[14px] leading-6 font-medium text-white shadow-[0_4px_12px_rgba(10,40,90,.2)]">
                <span className="sr-only">{t("shopChat.you")} </span>{message.text}
              </p>
            ) : message.text || message.state === "streaming" || message === failed ? (
              <div key={message.id} className="flex items-start gap-2">
                <span className="mt-1"><Mark size="sm" /></span>
                <div className="min-w-0 flex-1 space-y-2">
                  <span className="sr-only">{t("shopChat.them")}</span>
                  {message.text ? (
                    <ChatAnswer message={message} note="shopChat.generated" onNavigate={leave} />
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
            ) : null}
          </div>
          <div className="flex items-end gap-2 rounded-[26px] bg-white p-1.5 ps-4 shadow-[0_6px_20px_rgba(10,40,90,.12)] ring-1 ring-[#0a285a]/10 focus-within:ring-2 focus-within:ring-[#0a285a]/45">
            <textarea
              ref={field}
              dir="auto"
              rows={1}
              value={draft}
              maxLength={MAX_CHAT_TEXT + 1}
              onChange={event => { setDraft(event.target.value); if (chat.error && !failed) chat.dismissError(); }}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send(draft);
                }
              }}
              placeholder={t("shopChat.placeholder")}
              aria-label={t("shopChat.inputLabel")}
              aria-invalid={Boolean(problem && problem.kind !== "empty") || undefined}
              className="min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 text-[14px] leading-6 text-[#0a285a] outline-none placeholder:text-[#5b6b82]"
            />
            {draft.length >= COUNT_FROM ? (
              <span dir="ltr" className={`self-center text-[12px] font-semibold ${draft.length > MAX_CHAT_TEXT ? "text-[#8c2f22]" : "ink-muted"}`}>
                {draft.length}/{MAX_CHAT_TEXT}
              </span>
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
  );
}
