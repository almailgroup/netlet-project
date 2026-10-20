/**
 * "Ask about this product."
 *
 * A specification block is written for somebody who already knows the
 * category — "Nine microphones total", "Apple H1 headphone chip (each ear
 * cup)" — and the shopper who needs it most is the one who does not. This
 * turns the listing into an answer to the question they actually have.
 *
 * **It sits under the photo, where somebody looking at the thing wonders
 * about it** — on a wide screen; on a phone it follows the buy buttons, so it
 * never pushes the price and Add to cart below the first screen (see
 * ProductDetail). It was the last thing in the buy box, under four policy
 * sections, and the owner could not find it.
 *
 * **It is one card: a line saying what it is, the questions to start from,
 * and one field.** It had an icon tile, a two-line explanation and a send
 * disc beside the box. The explanation is one short line now — every answer
 * still says it came from a model, on the answer — and the send button sits
 * inside the field, the way the search box's does.
 *
 * **It does nothing until it is pressed.** Summarising every product on load
 * would spend a model call on every page view, most of them for somebody who
 * came to look at the photograph — and it would put a paragraph of generated
 * text above the merchant's own words by default. The suggestions make the
 * first press one tap rather than a blank box, and are fitted to the product
 * (`suggestedQuestions`); after an answer the model's own follow-ups take
 * their place, in the same row above the box (`ChatSuggestions`) — never at
 * the foot of the scrolling log, where they arrived after it had scrolled and
 * were cut off.
 *
 * **It answers through the AI gateway**, streamed: the listing goes as the
 * product brief (`briefFor`, the page's own public text and nothing about the
 * shopper), and the gateway's prompt holds the model to it — answer from the
 * listing, never a price, stock or a date.
 *
 * **The panel is absent, not broken, when the gateway is not set up** or the
 * shop assistant is switched off. `available` is asked once and the whole
 * section is skipped if the server says no. That is deliberately unlike voice
 * and photo search, which render every state because there is a *design* to
 * review; an assistant with nothing behind it has nothing to show, and a box
 * reading "not configured" is noise on a shop.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUp, LoaderCircle, Sparkles, Square } from "lucide-react";
import { MAX_QUESTION, acceptableQuestion, briefFor, suggestedQuestions } from "@shared/commerce/assistant";
import type { Product } from "@shared/commerce/types";
import { nextQuestions } from "@shared/ai/chatText";
import { ChatAnswer } from "@/components/assistant/ChatAnswer";
import { ChatSuggestions } from "@/components/assistant/ChatSuggestions";
import { CARD } from "@/components/layout/Page";
import { chatDraftProblem, useAIChat } from "@/hooks/useAIChat";
import { useTranslation } from "@/hooks/useTranslation";
import { gatewayErrorMessage } from "@/lib/aiGateway";

export function ProductAssistant({ product, className = "" }: {
  product: Pick<Product, "title" | "productType" | "vendor" | "description" | "attributes">;
  className?: string;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const brief = useMemo(() => briefFor(product), [product]);
  const suggestions = useMemo(() => suggestedQuestions(brief), [brief]);
  const chat = useAIChat({ product: brief });
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  /* A press on a suggestion takes the suggestions away, so focus goes to the
     conversation rather than to <body>; never into the box, whose keyboard on
     a phone would cover the answer being waited for. */
  const focusLog = useRef(false);
  const contact = chatDraftProblem(draft)?.kind === "contact";
  const busy = chat.status !== "idle";

  /* The newest turn, not the top: a log that grows downward and does not
     follow leaves the answer somebody asked for below the fold. Again when it
     finishes, since a finished answer gains its note and Copy. */
  const last = chat.messages[chat.messages.length - 1];
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTo({ top: log.scrollHeight });
    if (focusLog.current) {
      focusLog.current = false;
      log.focus({ preventScroll: true });
    }
  }, [chat.messages.length, last?.text, last?.state]);
  const offer = nextQuestions(chat.messages, suggestions.map(key => t(key)));

  if (!chat.available) return null;

  const send = (question: string) => {
    if (!acceptableQuestion(question) || busy) return;
    setDraft("");
    void chat.send(question);
  };

  return (
    <section aria-labelledby={headingId} className={`${CARD} p-4 sm:p-5 ${className}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-[#fdeee8] ink-accent">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="text-[15px] font-extrabold leading-5 text-[#0a285a]">{t("assistant.heading")}</h2>
          <p className="mt-0.5 text-[12px] leading-4 ink-muted">{t("assistant.note")}</p>
        </div>
      </div>

      {chat.messages.length ? (
        <div
          ref={logRef}
          role="log"
          tabIndex={-1}
          /* Busy while an answer streams, so a screen reader reads it once,
             whole, rather than a word at a time. */
          aria-busy={busy}
          aria-label={t("assistant.heading")}
          /* Room inside the edge, so an answer's rim is not cut by the scroll. */
          className="hide-scrollbar -mx-1 mt-3 max-h-[360px] space-y-3 overflow-y-auto rounded-xl px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-[#0a285a]/30"
        >
          {chat.messages.map(message => message.role === "user" ? (
            <p key={message.id} dir="auto" className="ms-auto w-fit max-w-[85%] rounded-2xl rounded-ee-md bg-[#0a285a] px-3.5 py-2 text-[14px] leading-6 text-white">
              {message.text}
            </p>
          ) : message.text ? (
            <ChatAnswer key={message.id} message={message} />
          ) : message.state === "streaming" ? (
            <p key={message.id} className="flex items-center gap-2 text-[13px] ink-muted">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
              {t("assistant.thinking")}
            </p>
          ) : null)}
        </div>
      ) : null}

      {/* The questions to start from, then each answer's own: one row above the box. */}
      {busy ? null : (
        <ChatSuggestions
          questions={offer.questions}
          label={t(offer.followUps ? "shopChat.followUps" : "assistant.suggestions")}
          onAsk={question => { focusLog.current = true; send(question); }}
          rise={chat.messages.length > 0}
          className={chat.messages.length ? "mt-3" : "mt-4"}
        />
      )}

      <div aria-live="polite">
        {contact ? <p className="mt-3 text-[13px] font-semibold text-[#8c2f22]">{t("ai.error.contact")}</p> : null}
        {chat.error && !contact ? <p className="mt-3 text-[13px] font-semibold text-[#8c2f22]">{t(gatewayErrorMessage(chat.error))}</p> : null}
      </div>

      {/* One field with its button inside, the search box's shape. The rim is
          a wrapper in the page's direction and the field inside it takes the
          question's own (`dir="auto"`): padding on the field itself resolved
          against that, so on the Arabic page an empty box put its room on the
          wrong side and the words ran under the button. The shop chat's box
          has the same shape for the same reason. */}
      <form onSubmit={event => { event.preventDefault(); send(draft); }} className="mt-3">
        <div className="flex items-center gap-2 rounded-full border border-[#d5dfeb] bg-white p-1.5 ps-4 focus-within:border-[#0a285a] focus-within:ring-2 focus-within:ring-[#0a285a]/20">
          <input
            dir="auto"
            value={draft}
            maxLength={MAX_QUESTION}
            onChange={event => { setDraft(event.target.value); if (chat.error) chat.dismissError(); }}
            placeholder={t("assistant.placeholder")}
            aria-label={t("assistant.inputLabel")}
            aria-invalid={contact || undefined}
            className="type-body h-9 min-w-0 flex-1 bg-transparent text-[14px] text-[#0a285a] outline-none placeholder:text-[#5b6b82]"
          />
          {busy ? (
            <button
              type="button"
              onClick={chat.stop}
              aria-label={t("assistant.stop")}
              className="glass glass-navy grid size-9 shrink-0 place-items-center rounded-full"
            >
              <Square className="size-3 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!acceptableQuestion(draft) || contact}
              aria-label={t("assistant.send")}
              className="glass glass-navy grid size-9 shrink-0 place-items-center rounded-full disabled:opacity-40"
            >
              <ArrowUp className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
