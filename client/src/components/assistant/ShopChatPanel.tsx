/**
 * The shop assistant's conversation: the whole screen on a phone, a card in
 * the end corner on a wide screen. Fetched the first time the button is
 * pressed and kept mounted after, hidden while closed, so the conversation
 * survives closing it and moving between pages.
 *
 * **On a phone it is the whole screen, sized to what the keyboard leaves.** A
 * keyboard covers the screen without shrinking the layout, so a panel sized
 * to the screen put its own box under the keys; it follows the visual
 * viewport instead, the search sheet's rule, and the box stays in sight.
 * There it is a modal (`useOverlay`: Escape, focus back, the page held
 * still); a wide screen's card leaves the page usable beside it, closes on
 * Escape from inside it and hands focus back to the button.
 *
 * What it says first is what it can do — delivery, returns, paying, finding
 * something — as presses, and on a product page that product, by name, since
 * that is what the answer will be about. A search the model offers is a link
 * to NetLet's own results (`ChatAnswer`), and following one on a phone puts
 * the chat away so the results can be seen.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MessageCircle, RotateCcw, Send, Square, X } from "lucide-react";
import { ChatAnswer } from "@/components/assistant/ChatAnswer";
import { chatDraftProblem, useAIChat } from "@/hooks/useAIChat";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { gatewayErrorMessage } from "@/lib/aiGateway";
import type { ProductBrief } from "@shared/commerce/assistant";
import { MAX_CHAT_TEXT } from "@shared/ai/gateway";
import type { MessageKey } from "@shared/i18n/dictionary";

const SUGGESTIONS: MessageKey[] = ["shopChat.askDelivery", "shopChat.askReturns", "shopChat.askPay", "shopChat.askFind"];

export function ShopChatPanel({ open, onClose, product }: {
  open: boolean;
  /** `true` hands focus back to the button; following a search does not. */
  onClose: (refocus: boolean) => void;
  /** The product the shopper is looking at, when they are on one. */
  product: ProductBrief | null;
}) {
  const { t } = useTranslation();
  const wide = useMediaQuery("(min-width: 1024px)");
  const chat = useAIChat({ product });
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<{ top: number; height: number } | null>(null);
  const busy = chat.status !== "idle";
  const problem = chatDraftProblem(draft);
  const contact = problem?.kind === "contact";

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

  /* Follow the newest words as they arrive. */
  const last = chat.messages[chat.messages.length - 1];
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [chat.messages.length, last?.text, open]);

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
    void chat.send(text);
    field.current?.focus({ preventScroll: true });
  };

  const titleId = "shop-chat-title";
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
      className={`${open ? "flex" : "hidden"} ${wide
        ? "fixed bottom-24 end-6 z-50 h-[min(620px,calc(100dvh-8rem))] w-[392px] flex-col overflow-hidden rounded-2xl border border-[#d5dfeb] bg-white shadow-[0_24px_60px_rgba(10,40,90,.25)]"
        : "fixed inset-x-0 top-0 z-[70] h-[100dvh] flex-col bg-white"}`}
    >
      <div className="flex items-start gap-3 border-b border-[#e6e9ef] px-4 py-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-[#0a285a] text-white">
          <MessageCircle className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-[15px] font-extrabold text-[#0a285a]">{t("shopChat.title")}</h2>
          <p className="text-[12px] leading-5 ink-muted">{t("shopChat.note")}</p>
        </div>
        {chat.messages.length ? (
          <button
            type="button"
            onClick={() => { chat.reset(); setDraft(""); field.current?.focus(); }}
            aria-label={t("shopChat.newChat")}
            title={t("shopChat.newChat")}
            className="grid size-11 shrink-0 place-items-center rounded-full text-[#0a285a] pointer-fine:size-9"
          >
            <RotateCcw className="size-[18px]" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          onClick={close}
          aria-label={t("shopChat.close")}
          title={t("shopChat.close")}
          className="grid size-11 shrink-0 place-items-center rounded-full text-[#0a285a] pointer-fine:size-9"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      <div
        ref={log}
        role="log"
        aria-busy={busy}
        aria-label={t("shopChat.title")}
        className="flex-1 space-y-3 overflow-y-auto overscroll-contain bg-background px-4 py-4"
      >
        {product ? (
          <p className="text-[12px] font-semibold ink-muted">
            {t("shopChat.aboutProduct")} <bdi dir="auto" className="text-[#0a285a]">{product.title}</bdi>
          </p>
        ) : null}
        {chat.messages.length === 0 ? (
          <>
            <p dir="auto" className="w-fit max-w-[92%] rounded-2xl border border-[#d5dfeb] bg-white px-3.5 py-2.5 text-[14px] leading-6 text-[#2b3242]">
              {t("shopChat.greeting")}
            </p>
            <div>
              <p className="mb-2 text-[12px] font-bold ink-muted">{t("shopChat.suggestions")}</p>
              <div className="flex flex-wrap gap-2">
                {(product ? (["shopChat.askProduct", ...SUGGESTIONS] as MessageKey[]) : SUGGESTIONS).map(key => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => send(t(key))}
                    className="min-h-11 rounded-full border border-[#0a285a]/15 bg-white px-3.5 py-2 text-start text-[13px] font-bold text-[#0a285a] hover:bg-[#f0f2f5] pointer-fine:min-h-9"
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
        {chat.messages.map(message => message.role === "user" ? (
          <p key={message.id} dir="auto" className="ms-auto w-fit max-w-[85%] whitespace-pre-line rounded-2xl bg-[#0a285a] px-3.5 py-2 text-[14px] font-semibold leading-6 text-white">
            <span className="sr-only">{t("shopChat.you")} </span>{message.text}
          </p>
        ) : message.text || message.state === "streaming" ? (
          <div key={message.id}>
            <span className="sr-only">{t("shopChat.them")}</span>
            {message.text
              ? <ChatAnswer message={message} note="shopChat.generated" onSearch={wide ? undefined : () => onClose(false)} />
              : (
                <span className="inline-flex gap-1 rounded-2xl border border-[#d5dfeb] bg-white px-4 py-3.5" aria-hidden>
                  {[0, 1, 2].map(dot => <span key={dot} className="size-1.5 animate-pulse rounded-full bg-[#0a285a]/45" style={{ animationDelay: `${dot * 160}ms` }} />)}
                </span>
              )}
          </div>
        ) : null)}
      </div>

      <form
        onSubmit={event => { event.preventDefault(); send(draft); }}
        className="border-t border-[#e6e9ef] bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 lg:pb-3"
      >
        <div aria-live="polite">
          {contact ? <p className="mb-2 px-1 text-[13px] font-semibold text-[#8c2f22]">{t("ai.error.contact")}</p> : null}
          {problem?.kind === "tooLong" ? <p className="mb-2 px-1 text-[13px] font-semibold text-[#8c2f22]">{t("ai.error.tooLarge")}</p> : null}
          {chat.error && !problem ? <p className="mb-2 px-1 text-[13px] font-semibold text-[#8c2f22]">{t(gatewayErrorMessage(chat.error))}</p> : null}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={field}
            dir="auto"
            rows={1}
            value={draft}
            maxLength={MAX_CHAT_TEXT + 1}
            onChange={event => { setDraft(event.target.value); if (chat.error) chat.dismissError(); }}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send(draft);
              }
            }}
            placeholder={t("shopChat.placeholder")}
            aria-label={t("shopChat.inputLabel")}
            aria-invalid={Boolean(problem && problem.kind !== "empty") || undefined}
            className="min-h-11 min-w-0 flex-1 resize-none rounded-[22px] border border-[#d5dfeb] bg-white px-4 py-2.5 text-[14px] leading-6 text-[#0a285a] outline-none focus:border-[#0a285a]"
          />
          {busy ? (
            <button type="button" onClick={chat.stop} aria-label={t("assistant.stop")} title={t("assistant.stop")} className="glass glass-navy grid size-11 shrink-0 place-items-center rounded-full">
              <Square className="size-3.5 fill-current" aria-hidden />
            </button>
          ) : (
            <button type="submit" disabled={Boolean(problem)} aria-label={t("shopChat.send")} title={t("shopChat.send")} className="glass glass-navy grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-50">
              <Send className="size-4 rtl:-scale-x-100" aria-hidden />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
