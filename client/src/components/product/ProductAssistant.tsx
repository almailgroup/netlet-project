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
 * **The panel is absent, not broken, when no key is configured.** `available`
 * is asked once and the whole section is skipped if the server says no. That
 * is deliberately unlike voice and photo search, which render every state
 * because there is a *design* to review; an assistant with nothing behind it
 * has nothing to show, and a box reading "not configured" is noise on a shop.
 *
 * Answers carry a line saying they came from a model and from this listing.
 * The same argument the recommendation rail makes for its badge: a generated
 * sentence that looks like the shop's own copy is a sentence a shopper will
 * hold the shop to.
 */
import { useRef, useState } from "react";
import { LoaderCircle, Send, Sparkles } from "lucide-react";
import { ASSISTANT_OPENERS, MAX_QUESTION, acceptableQuestion } from "@shared/commerce/assistant";
import type { MessageKey } from "@shared/i18n/dictionary";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";

type Turn = { question: string; answer: string | null };

export function ProductAssistant({ handle }: { handle: string }) {
  const { t, locale } = useTranslation();
  const { data } = trpc.assistant.available.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const ask = trpc.assistant.ask.useMutation({
    onSuccess: reply => {
      setFailed(null);
      setTurns(list => {
        const next = [...list];
        const last = next[next.length - 1];
        if (last) last.answer = reply.kind === "answer" ? reply.text : null;
        return next;
      });
    },
    onError: error => {
      setFailed(error.message === "assistant.tooMany" ? t("assistant.tooMany") : t("assistant.failed"));
      setTurns(list => list.slice(0, -1));
    },
  });

  if (!data?.available) return null;

  const send = (question: string) => {
    if (!acceptableQuestion(question) || ask.isPending) return;
    setFailed(null);
    setTurns(list => [...list, { question, answer: null }]);
    setDraft("");
    ask.mutate({ handle, question, locale });
    // The newest turn, not the top: a log that grows downward and does not
    // follow leaves the answer somebody asked for below the fold.
    requestAnimationFrame(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }));
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

      {turns.length ? (
        <div
          ref={logRef}
          className="hide-scrollbar mt-4 max-h-[340px] space-y-3 overflow-y-auto"
          /* Polite, so an answer is announced without interrupting whatever a
             screen reader is already partway through reading. */
          aria-live="polite"
        >
          {turns.map((turn, index) => (
            <div key={index} className="space-y-2">
              <p dir="auto" className="ms-auto w-fit max-w-[85%] rounded-2xl bg-[#0a285a] px-3.5 py-2 text-[13px] font-semibold text-white">
                {turn.question}
              </p>
              {turn.answer === null ? (
                ask.isPending && index === turns.length - 1 ? (
                  <p className="flex items-center gap-2 text-[13px] ink-muted">
                    <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                    {t("assistant.thinking")}
                  </p>
                ) : (
                  <p className="text-[13px] leading-6 text-[#8c2f22]">{t("assistant.failed")}</p>
                )
              ) : (
                <div className="w-fit max-w-[92%] rounded-2xl border border-[#d5dfeb] bg-white px-3.5 py-2.5">
                  <p dir="auto" className="text-[13px] leading-6 text-[#404553]">{turn.answer}</p>
                  {/* Said on every answer, not once at the top: a shopper
                      scrolling the log reads the sentence, not the header. */}
                  <p className="mt-1.5 text-[10px] font-bold tracking-[.04em] ink-muted uppercase">{t("assistant.generated")}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {ASSISTANT_OPENERS.map(key => (
            <button
              key={key}
              onClick={() => send(t(key as MessageKey))}
              disabled={ask.isPending}
              className="glass pressable rounded-full border border-[#0a285a]/12 px-3.5 py-2 text-[12px] font-bold text-[#0a285a] disabled:opacity-50"
            >
              {t(key as MessageKey)}
            </button>
          ))}
        </div>
      )}

      {failed ? <p className="mt-3 text-[13px] font-semibold text-[#8c2f22]">{failed}</p> : null}

      <form
        onSubmit={event => { event.preventDefault(); send(draft); }}
        className="mt-4 flex items-center gap-2"
      >
        <input
          dir="auto"
          value={draft}
          maxLength={MAX_QUESTION}
          onChange={event => setDraft(event.target.value)}
          placeholder={t("assistant.placeholder")}
          aria-label={t("assistant.inputLabel")}
          className="type-body h-11 min-w-0 flex-1 rounded-full border border-[#d5dfeb] bg-white px-4 text-[13px] text-[#0a285a] outline-none focus:border-[#f2683a]"
        />
        <button
          type="submit"
          disabled={!acceptableQuestion(draft) || ask.isPending}
          aria-label={t("assistant.send")}
          className="glass glass-navy pressable grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-50"
        >
          {ask.isPending
            ? <LoaderCircle className="size-4 animate-spin" aria-hidden />
            : <Send className="size-4 rtl:-scale-x-100" aria-hidden />}
        </button>
      </form>
    </section>
  );
}
