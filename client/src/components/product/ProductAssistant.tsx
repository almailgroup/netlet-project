/**
 * "Ask about this product."
 *
 * A specification block is written for somebody who already knows the
 * category — "Nine microphones total", "Apple H1 headphone chip (each ear
 * cup)" — and the shopper who needs it most is the one who does not. This
 * turns the listing into an answer to the question they actually have.
 *
 * **It does nothing until it is pressed.** Summarising every product on load
 * would spend a model call on every page view, most of them for somebody who
 * came to look at the photograph — and it would put a paragraph of generated
 * text above the merchant's own words by default. The openers make the first
 * press one tap rather than a blank box.
 *
 * **It answers through the AI gateway**, streamed: the listing goes as the
 * product brief (`briefFor`, the page's own public text and nothing about the
 * shopper), and the gateway's prompt holds the model to it — answer from the
 * listing, never a price, stock or a date.
 *
 * **The panel is absent, not broken, when the gateway is not set up** or the
 * shop assistant is switched off. `available` is asked once and the whole
 * section is skipped if the server says no. That
 * is deliberately unlike voice and photo search, which render every state
 * because there is a *design* to review; an assistant with nothing behind it
 * has nothing to show, and a box reading "not configured" is noise on a shop.
 *
 * Answers carry a line saying they came from a model and from this listing.
 * The same argument the recommendation rail makes for its badge: a generated
 * sentence that looks like the shop's own copy is a sentence a shopper will
 * hold the shop to.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Send, Sparkles, Square } from "lucide-react";
import { ASSISTANT_OPENERS, MAX_QUESTION, acceptableQuestion, briefFor } from "@shared/commerce/assistant";
import type { Product } from "@shared/commerce/types";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ChatAnswer } from "@/components/assistant/ChatAnswer";
import { chatDraftProblem, useAIChat } from "@/hooks/useAIChat";
import { useTranslation } from "@/hooks/useTranslation";
import { gatewayErrorMessage } from "@/lib/aiGateway";

export function ProductAssistant({ product }: { product: Pick<Product, "title" | "productType" | "vendor" | "description" | "attributes"> }) {
  const { t } = useTranslation();
  const brief = useMemo(() => briefFor(product), [product]);
  const chat = useAIChat({ product: brief });
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const contact = chatDraftProblem(draft)?.kind === "contact";
  const busy = chat.status !== "idle";

  /* The newest turn, not the top: a log that grows downward and does not
     follow leaves the answer somebody asked for below the fold. */
  const last = chat.messages[chat.messages.length - 1];
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [chat.messages.length, last?.text]);

  if (!chat.available) return null;

  const send = (question: string) => {
    if (!acceptableQuestion(question) || busy) return;
    setDraft("");
    void chat.send(question);
  };

  return (
    <section className="mt-8 rounded-[1.25rem] border border-[#d5dfeb] bg-white/60 p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] border border-[#0a285a]/12 bg-[#0a285a]/8 text-[#0a285a]">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-sm font-extrabold text-[#0a285a]">{t("assistant.heading")}</h2>
          <p className="text-[12px] leading-5 ink-muted">{t("assistant.note")}</p>
        </div>
      </div>

      {chat.messages.length ? (
        <div
          ref={logRef}
          role="log"
          /* Busy while an answer streams, so a screen reader reads it once,
             whole, rather than a word at a time. */
          aria-busy={busy}
          aria-label={t("assistant.heading")}
          className="hide-scrollbar mt-4 max-h-[340px] space-y-3 overflow-y-auto"
        >
          {chat.messages.map(message => message.role === "user" ? (
            <p key={message.id} dir="auto" className="ms-auto w-fit max-w-[85%] rounded-2xl bg-[#0a285a] px-3.5 py-2 text-[13px] font-semibold text-white">
              {message.text}
            </p>
          ) : message.text ? (
            <ChatAnswer key={message.id} message={message} onAsk={message === last && !busy ? send : undefined} />
          ) : message.state === "streaming" ? (
            <p key={message.id} className="flex items-center gap-2 text-[13px] ink-muted">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
              {t("assistant.thinking")}
            </p>
          ) : null)}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {ASSISTANT_OPENERS.map(key => (
            <button
              key={key}
              onClick={() => send(t(key as MessageKey))}
              disabled={busy}
              className="glass pressable rounded-full border border-[#0a285a]/12 px-3.5 py-2 text-[12px] font-bold text-[#0a285a] disabled:opacity-50"
            >
              {t(key as MessageKey)}
            </button>
          ))}
        </div>
      )}

      <div aria-live="polite">
        {contact ? <p className="mt-3 text-[13px] font-semibold text-[#8c2f22]">{t("ai.error.contact")}</p> : null}
        {chat.error && !contact ? <p className="mt-3 text-[13px] font-semibold text-[#8c2f22]">{t(gatewayErrorMessage(chat.error))}</p> : null}
      </div>

      <form
        onSubmit={event => { event.preventDefault(); send(draft); }}
        className="mt-4 flex items-center gap-2"
      >
        <input
          dir="auto"
          value={draft}
          maxLength={MAX_QUESTION}
          onChange={event => { setDraft(event.target.value); if (chat.error) chat.dismissError(); }}
          placeholder={t("assistant.placeholder")}
          aria-label={t("assistant.inputLabel")}
          aria-invalid={contact || undefined}
          className="type-body h-11 min-w-0 flex-1 rounded-full border border-[#d5dfeb] bg-white px-4 text-[13px] text-[#0a285a] outline-none focus:border-[#f2683a]"
        />
        {busy ? (
          <button
            type="button"
            onClick={chat.stop}
            aria-label={t("assistant.stop")}
            className="glass glass-navy pressable grid size-11 shrink-0 place-items-center rounded-full"
          >
            <Square className="size-3.5 fill-current" aria-hidden />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!acceptableQuestion(draft) || contact}
            aria-label={t("assistant.send")}
            className="glass glass-navy pressable grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-50"
          >
            <Send className="size-4 rtl:-scale-x-100" aria-hidden />
          </button>
        )}
      </form>
    </section>
  );
}
