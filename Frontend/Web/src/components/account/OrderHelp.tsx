/**
 * "Get help with this order" — on the opened order, never a trip to the help
 * centre (on the owner's word: "access support directly for a specific order
 * … try to let the AI resolve the issue before having any real reaction").
 *
 * **NetLet AI answers first, from this order's facts** (`support.orderHelp`):
 * where each item is, what can still be cancelled or changed, whether a
 * return or a warranty claim is open to it. When the shopper can do it
 * themselves, the answer carries the button (`onAction` opens that panel on
 * the page); it never claims to have done anything. Every answer says it came
 * from a model.
 *
 * **A person is one press away, always** — and the next step when the model
 * hands over (`[[person]]`), cannot answer, or is switched off: the
 * conversation goes to NetLet's own support (`support.open`) with the order
 * attached and what was asked, where a person reads every message and the
 * reply arrives under Help from NetLet and the bell.
 */
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Bot, LoaderCircle, Send, UserRound } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import {
  MAX_ORDER_HELP_QUESTION,
  ORDER_HELP_STARTERS,
  orderHelpProblem,
  type OrderHelpAction,
  type OrderHelpTurn,
} from "@shared/commerce/orderHelp";
import type { MessageKey } from "@shared/i18n/dictionary";

/** What each button an answer offers is called, in the page's words. */
export const HELP_ACTION_LABEL: Record<OrderHelpAction, MessageKey> = {
  track: "orders.track",
  refund: "orders.requestRefund",
  warranty: "warranty.title",
  cancel: "orders.cancelOrder",
  modify: "orders.modify",
  address: "orders.changeAddress",
  buyAgain: "orders.buyAgain",
  rate: "orders.rateItems",
};

type Turn = OrderHelpTurn & { actions?: OrderHelpAction[] };

export function OrderHelp({ reference, onAction, onClose }: {
  reference: string;
  onAction: (action: OrderHelpAction) => void;
  onClose: () => void;
}) {
  const { t, tError, locale } = useTranslation();
  const ids = useId();
  const available = trpc.support.orderHelpAvailable.useQuery(undefined, { staleTime: 5 * 60_000 });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  /* Where a person takes over: offered after a hand-off, an answer that did not come, or the model off. */
  const [toPerson, setToPerson] = useState(false);
  const [sentToPerson, setSentToPerson] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);

  const ask = trpc.support.orderHelp.useMutation({
    onSuccess: answer => {
      if (answer.kind === "answer") {
        setTurns(current => [...current, { role: "assistant", text: answer.text, actions: answer.actions }]);
        if (answer.person) setToPerson(true);
        return;
      }
      if (answer.kind === "refused") { setProblem(answer.reason); return; }
      /* No model, the hour spent, or no answer: straight to a person. */
      setToPerson(true);
      if (answer.kind === "tooMany") setProblem("orderHelp.tooMany");
    },
    onError: error => { setProblem(error.message); setToPerson(true); },
  });
  const open = trpc.support.open.useMutation({
    onSuccess: () => { setSentToPerson(true); toast.success(t("orderHelp.sentToPerson")); },
    onError: error => toast.error(tError(error.message)),
  });

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [turns.length]);

  const modelOff = available.isSuccess && !available.data;
  const send = (text: string) => {
    const words = text.trim();
    const issue = orderHelpProblem(words);
    if (issue) { setProblem(issue); box.current?.focus(); return; }
    setProblem(null);
    const next: Turn[] = [...turns, { role: "shopper", text: words }];
    setTurns(next);
    setDraft("");
    if (modelOff) { setToPerson(true); return; }
    ask.mutate({ reference, locale, turns: next.map(({ role, text: said }) => ({ role, text: said })) });
  };

  /* What a person reads: the shopper's questions, and what NetLet AI said, briefly. */
  const transcript = () => {
    const lines = turns.map(turn => `${turn.role === "shopper" ? "Me" : "NetLet AI"}: ${turn.text}`);
    return lines.join("\n").slice(-1800) || draft.trim();
  };

  const shopperAsked = turns.some(turn => turn.role === "shopper") || draft.trim().length > 0;

  return (
    <section aria-labelledby={`${ids}-title`} className="mt-3 rounded-2xl border border-[#d5dfeb] bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 id={`${ids}-title`} className="text-[14px] font-extrabold text-[#0a285a]">{t("orders.getHelp")}</h4>
          <p className="mt-1 text-[12px] leading-5 ink-muted">{t(modelOff ? "orderHelp.notePerson" : "orderHelp.note")}</p>
        </div>
        <button type="button" onClick={onClose} className="glass type-control pressable min-h-11 shrink-0 rounded-full px-3 py-1.5 pointer-fine:min-h-8">
          {t("common.close")}
        </button>
      </div>

      {turns.length ? (
        <div ref={log} role="log" aria-live="polite" className="mt-3 max-h-80 space-y-2 overflow-y-auto pe-1">
          {turns.map((turn, index) => (
            <div key={index} className={turn.role === "shopper" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-5 ${turn.role === "shopper" ? "bg-[#0a285a] text-white" : "border border-[#e7edf5] bg-[#f8f9fc] text-[#1f2a44]"}`}>
                {turn.role === "assistant" ? (
                  <span className="mb-1 flex items-center gap-1 text-[11px] font-bold text-[#536b8c]"><Bot className="size-3.5" aria-hidden />{t("orderHelp.fromModel")}</span>
                ) : null}
                <p dir="auto" className="whitespace-pre-line">{turn.text}</p>
                {turn.actions?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {turn.actions.map(action => (
                      <button key={action} type="button" onClick={() => onAction(action)} className="glass type-control pressable min-h-11 rounded-full px-3 py-1.5 pointer-fine:min-h-8">
                        {t(HELP_ACTION_LABEL[action])}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {ask.isPending ? (
            <p className="flex items-center gap-2 text-[12px] ink-muted"><LoaderCircle className="size-3.5 animate-spin" aria-hidden />{t("orderHelp.thinking")}</p>
          ) : null}
        </div>
      ) : null}

      {/* The starters, before anything is asked. */}
      {!turns.length && !sentToPerson ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {ORDER_HELP_STARTERS.map(key => (
            <button key={key} type="button" onClick={() => send(t(key))} className="glass type-control pressable min-h-11 rounded-full px-3.5 py-1.5 pointer-fine:min-h-9">
              {t(key)}
            </button>
          ))}
        </div>
      ) : null}

      {sentToPerson ? (
        <p role="status" className="mt-3 rounded-xl bg-[#e9f4ee] px-3.5 py-2.5 text-[13px] leading-5 text-[#1f5e3a]">
          {t("orderHelp.personWill")} <Link href="/account/help" className="font-bold underline underline-offset-2">{t("orderHelp.followThere")}</Link>
        </p>
      ) : (
        <form
          className="mt-3"
          onSubmit={event => { event.preventDefault(); send(draft); }}
        >
          <label htmlFor={`${ids}-box`} className="sr-only">{t("orderHelp.ask")}</label>
          <div className="flex items-end gap-2">
            <textarea
              id={`${ids}-box`}
              ref={box}
              value={draft}
              onChange={event => { setDraft(event.target.value); if (problem) setProblem(null); }}
              onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(draft); } }}
              placeholder={t("orderHelp.ask")}
              maxLength={MAX_ORDER_HELP_QUESTION}
              rows={2}
              dir="auto"
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${ids}-problem` : undefined}
              className="glass-field min-w-0 flex-1 resize-none rounded-2xl px-3 py-2 text-sm"
            />
            <button type="submit" disabled={ask.isPending} aria-label={t("orderHelp.send")} className="grid size-11 shrink-0 place-items-center rounded-full bg-[#0a285a] text-white disabled:opacity-50">
              <Send className="size-4 rtl:-scale-x-100" aria-hidden />
            </button>
          </div>
          {problem ? <p id={`${ids}-problem`} role="alert" className="mt-1 text-[12px] font-semibold text-[#8c2f22]">{tError(problem)}</p> : null}
        </form>
      )}

      {!sentToPerson && (toPerson || turns.some(turn => turn.role === "assistant")) ? (
        <div className={`mt-3 rounded-xl px-3.5 py-3 ${toPerson ? "bg-[#fdf1d6]" : "bg-[#f4f6fa]"}`}>
          <p className="text-[12px] leading-5 text-[#1f2a44]">{t(toPerson ? "orderHelp.personNext" : "orderHelp.personAlways")}</p>
          <button
            type="button"
            disabled={open.isPending || !shopperAsked}
            onClick={() => open.mutate({ topic: "order", orderReference: reference, body: transcript() })}
            className="glass-navy type-control pressable mt-2 inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 disabled:opacity-50 pointer-fine:min-h-9"
          >
            {open.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <UserRound className="size-4" aria-hidden />}
            {t("orderHelp.toPerson")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
