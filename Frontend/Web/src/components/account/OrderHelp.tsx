/**
 * "Get help with this order" — on the opened order, never a trip to the help
 * centre (on the owner's word: "access support directly for a specific order
 * … the AI assistant should understand customer issues and provide immediate
 * solutions … perform authorized actions directly after receiving customer
 * confirmation … support should be the last resort, but easily accessible").
 *
 * **It starts from what happened**: the issues (`Shared/commerce/selfService.ts`),
 * the item when it is about one — already chosen when opened from an item's
 * ⋯ — and the answer from this order's own facts (`support.selfHelp`), with
 * the acts that would settle it as cards that do it on Confirm: a return for
 * the reason given, cancelling before a driver has it, buying again.
 *
 * **NetLet AI answers what that did not**, from the same facts
 * (`support.orderHelp`, told the issue and the item), and may propose an act
 * of its own — drawn as the same card, done only on Confirm. Every answer
 * says it came from a model.
 *
 * **A person is one press away, always** — and the next step when the answer
 * says so, the model hands over or cannot answer: the conversation goes to
 * NetLet's own support with the order, the issue, the item and every act
 * already done (`support.open`'s handover), so nobody asks the shopper to say
 * it again.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Bot, LoaderCircle, Send } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { HelpAnswer, HelpOffers, IssueChips, ItemPicker, PersonCard, type DoneAct, type HelpItem } from "@/components/help/SelfHelp";
import { MAX_ORDER_HELP_QUESTION, orderHelpProblem, type OrderHelpAction, type OrderHelpTurn } from "@shared/commerce/orderHelp";
import { issueNeeds, type HelpIssue, type HelpOffer, type HelpPanel } from "@shared/commerce/selfService";
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

/** A panel an answer opens, as the order page's own actions name it. */
const PANEL_ACTION: Record<HelpPanel, OrderHelpAction> = {
  track: "track",
  refund: "refund",
  returnForm: "refund",
  warranty: "warranty",
  address: "address",
  modify: "modify",
  rate: "rate",
};

/** The issues an order can have, and the ones about one item. */
const ORDER_ISSUES: readonly HelpIssue[] = ["late", "damaged", "wrong", "return", "exchange", "warranty", "payment"];
const ITEM_ISSUES: readonly HelpIssue[] = ["damaged", "wrong", "return", "exchange", "warranty", "late"];

type Turn = OrderHelpTurn & { offers?: HelpOffer[] };

export function OrderHelp({ reference, items, lineId = null, onAction, onClose }: {
  reference: string;
  items: readonly HelpItem[];
  /** Opened from an item's ⋯: the item it is about. */
  lineId?: number | null;
  onAction: (action: OrderHelpAction, lineId?: number) => void;
  onClose: () => void;
}) {
  const { t, tError, locale } = useTranslation();
  const ids = useId();
  const available = trpc.support.orderHelpAvailable.useQuery(undefined, { staleTime: 5 * 60_000 });
  const [issue, setIssue] = useState<HelpIssue | null>(null);
  const [itemId, setItemId] = useState<number | null>(lineId);
  const [done, setDone] = useState<DoneAct[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  /* Where a person takes over: offered after a hand-off, an answer that did not come, or the model off. */
  const [toPerson, setToPerson] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);

  const needsItem = issue !== null && issueNeeds(issue) === "item" && itemId === null;
  const answer = trpc.support.selfHelp.useQuery(
    { issue: issue ?? "late", reference, lineId: itemId, locale },
    { enabled: issue !== null && !needsItem, staleTime: Infinity, refetchOnWindowFocus: false },
  );

  const ask = trpc.support.orderHelp.useMutation({
    onSuccess: reply => {
      if (reply.kind === "answer") {
        setTurns(current => [...current, { role: "assistant", text: reply.text, offers: reply.offers }]);
        if (reply.person) setToPerson(true);
        return;
      }
      if (reply.kind === "refused") { setProblem(reply.reason); return; }
      /* No model, the hour spent, or no answer: straight to a person. */
      setToPerson(true);
      if (reply.kind === "tooMany") setProblem("orderHelp.tooMany");
    },
    onError: error => { setProblem(error.message); setToPerson(true); },
  });

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [turns.length]);

  const modelOff = available.isSuccess && !available.data;
  const send = (text: string) => {
    const words = text.trim();
    const issueWithIt = orderHelpProblem(words);
    if (issueWithIt) { setProblem(issueWithIt); box.current?.focus(); return; }
    setProblem(null);
    const next: Turn[] = [...turns, { role: "shopper", text: words }];
    setTurns(next);
    setDraft("");
    if (modelOff) { setToPerson(true); return; }
    ask.mutate({ reference, locale, issue, lineId: itemId, turns: next.map(({ role, text: said }) => ({ role, text: said })) });
  };

  const open = (panel: HelpPanel, line: number | null) => onAction(PANEL_ACTION[panel], line ?? undefined);
  const record = (act: DoneAct) => setDone(current => [...current, act]);

  /* What a person reads: the shopper's questions and what NetLet AI said, or the issue's name. */
  const transcript = () => {
    const lines = turns.map(turn => `${turn.role === "shopper" ? "Me" : "NetLet AI"}: ${turn.text}`);
    return lines.join("\n").slice(-1800) || draft.trim() || (issue ? t(`help.issue.${issue}`) : "");
  };
  const ready = issue !== null || turns.some(turn => turn.role === "shopper") || draft.trim().length > 0;
  const personNext = toPerson || answer.data?.person === "next";

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

      <div className="mt-3 space-y-3">
        {issue === null ? (
          <>
            <p className="text-[13px] font-extrabold text-[#0a285a]">{t("help.issuesTitle")}</p>
            <IssueChips issues={lineId === null ? ORDER_ISSUES : ITEM_ISSUES} onPick={setIssue} label={t("help.issuesTitle")} />
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-extrabold text-[#0a285a]">{t(`help.issue.${issue}`)}</p>
            <button type="button" onClick={() => { setIssue(null); setItemId(lineId); }} className="text-[12px] font-bold text-[#0a285a] underline underline-offset-2">
              {t("help.otherIssue")}
            </button>
          </div>
        )}

        {needsItem ? <ItemPicker items={items} onPick={setItemId} /> : null}

        {issue !== null && !needsItem ? (
          answer.isLoading ? (
            <p className="flex items-center gap-2 text-[12px] ink-muted"><LoaderCircle className="size-3.5 animate-spin" aria-hidden />{t("orderHelp.thinking")}</p>
          ) : answer.data ? (
            <HelpAnswer reference={reference} answer={answer.data} items={answer.data.items} onOpen={open} onDone={record} />
          ) : answer.error ? (
            <p role="alert" className="text-[12px] font-semibold text-[#8c2f22]">{tError(answer.error.message)}</p>
          ) : null
        ) : null}

        {turns.length ? (
          <div ref={log} role="log" aria-live="polite" className="max-h-96 space-y-2 overflow-y-auto pe-1">
            {turns.map((turn, index) => (
              <div key={index} className={turn.role === "shopper" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-5 ${turn.role === "shopper" ? "bg-[#0a285a] text-white" : "border border-[#e7edf5] bg-[#f8f9fc] text-[#1f2a44]"}`}>
                  {turn.role === "assistant" ? (
                    <span className="mb-1 flex items-center gap-1 text-[11px] font-bold text-[#536b8c]"><Bot className="size-3.5" aria-hidden />{t("orderHelp.fromModel")}</span>
                  ) : null}
                  <p dir="auto" className="whitespace-pre-line">{turn.text}</p>
                  {turn.offers?.length ? <HelpOffers reference={reference} offers={turn.offers} items={items} onOpen={open} onDone={record} /> : null}
                </div>
              </div>
            ))}
            {ask.isPending ? (
              <p className="flex items-center gap-2 text-[12px] ink-muted"><LoaderCircle className="size-3.5 animate-spin" aria-hidden />{t("orderHelp.thinking")}</p>
            ) : null}
          </div>
        ) : null}

        <form onSubmit={event => { event.preventDefault(); send(draft); }}>
          <label htmlFor={`${ids}-box`} className="block text-[12px] font-extrabold ink-muted">{t(issue ? "help.askAI" : "orderHelp.ask")}</label>
          <div className="mt-1 flex items-end gap-2">
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

        {ready ? (
          <PersonCard reference={reference} issue={issue} lineId={itemId} done={done} body={transcript} emphasis={personNext} ready={ready} />
        ) : null}
      </div>
    </section>
  );
}
