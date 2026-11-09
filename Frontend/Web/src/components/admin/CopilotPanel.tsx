/**
 * The portal's co-pilot, the page half (`Shared/ai/copilot.ts` is the rule,
 * `services/copilot.ts` the server's).
 *
 * **A panel at the page's end, opened from the bar.** On a wide screen it sits
 * beside a page that stays usable — Escape from inside it closes it and the
 * keyboard goes back to the bar's button; below `lg` it is a sheet over a
 * dimmed page and a modal (`useOverlay`).
 *
 * **The brief first, and it needs no model**: what has run out, what runs out
 * this week, what waits and how sales are going, each with the one act that
 * answers it. Then a question box while NetLet AI is on, with a few questions
 * to start from; an answer says it is the model's, and may carry up to two
 * proposals.
 *
 * **A proposal is done only on Confirm, by the page.** Opening a page is a
 * link; setting a reorder point asks first, in a sentence saying what will
 * change, and then calls the procedure the stock page calls — which asks its
 * own permission again. The conversation lives as long as the frame does, so
 * it survives moving between pages and not a reload.
 */
import { useOverlay } from "@/hooks/useOverlay";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import type { CopilotAction, CopilotTurn, Insight } from "@shared/ai/copilot";
import { copilotProblem, MAX_COPILOT_QUESTION } from "@shared/ai/copilot";
import type { MessageKey } from "@shared/i18n/dictionary";
import { AlertTriangle, ArrowUpRight, CheckCircle2, CircleAlert, Info, Loader2, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Link } from "wouter";

type Turn = CopilotTurn & { actions?: CopilotAction[]; failed?: boolean };

const TONE = {
  good: { icon: CheckCircle2, ink: "text-[#0a7a0a]", plate: "bg-[#e9f7e9]" },
  warning: { icon: CircleAlert, ink: "text-[#8a5a00]", plate: "bg-[#fff4dc]" },
  critical: { icon: AlertTriangle, ink: "text-[#b42318]", plate: "bg-[#fdecea]" },
  info: { icon: Info, ink: "text-[#4338ca]", plate: "bg-[#eef0fd]" },
} as const;

export function CopilotPanel({ open, onClose, opener, pageLabel }: {
  open: boolean;
  onClose: () => void;
  /** The bar's button, which the keyboard goes back to on closing. */
  opener: RefObject<HTMLButtonElement | null>;
  /** A portal page's name, from the menu, for "Open …". */
  pageLabel: (href: string) => string;
}) {
  const { t } = useTranslation();
  const wide = useMediaQuery("(min-width: 1024px)");
  useOverlay(open && !wide, onClose);
  const panel = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const brief = trpc.inventory.copilot.brief.useQuery(undefined, { enabled: open, staleTime: 60_000, retry: false });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const ask = trpc.inventory.copilot.ask.useMutation();
  const log = useRef<HTMLDivElement>(null);
  const { locale } = useTranslation();

  /* Focus into the panel as it opens, and back to the bar's button as it closes. */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      requestAnimationFrame(() => (box.current ?? panel.current?.querySelector<HTMLElement>("[data-close]"))?.focus());
    } else if (wasOpen.current) {
      wasOpen.current = false;
      opener.current?.focus();
    }
  }, [open, opener]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, ask.isPending]);

  if (!open) return null;

  const send = async (text: string) => {
    const refused = copilotProblem(text);
    if (refused) {
      setProblem(refused);
      box.current?.focus();
      return;
    }
    setProblem(null);
    const next: Turn[] = [...turns, { role: "admin", text: text.trim() }];
    setTurns(next);
    setDraft("");
    try {
      const answer = await ask.mutateAsync({ turns: next.filter(turn => !turn.failed).map(({ role, text: words }) => ({ role, text: words })), locale });
      if (answer.kind === "answer") setTurns([...next, { role: "copilot", text: answer.text, actions: answer.actions }]);
      else {
        const key: MessageKey = answer.kind === "tooMany" ? "copilot.tooMany" : answer.kind === "refused" ? (answer.reason as MessageKey) : "copilot.unavailable";
        setTurns([...next, { role: "copilot", text: t(key), failed: true }]);
      }
    } catch {
      setTurns([...next, { role: "copilot", text: t("copilot.unavailable"), failed: true }]);
    }
  };

  const canAsk = brief.data?.ask ?? false;
  const suggestions: MessageKey[] = [
    "copilot.suggest.waiting",
    "copilot.suggest.restock",
    "copilot.suggest.week",
    "copilot.suggest.forecast",
    ...(brief.data && brief.data.inquiries > 0 ? ["copilot.suggest.inquiries" as const] : []),
  ];

  const body = (
    <div
      ref={panel}
      role={wide ? "complementary" : "dialog"}
      aria-modal={wide ? undefined : true}
      aria-labelledby="copilot-title"
      onKeyDown={event => {
        if (wide && event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      className={`copilot-panel flex flex-col bg-white ${wide
        ? "fixed inset-y-0 end-0 z-40 w-[400px] border-s border-[#e3e8f0] shadow-[-24px_0_60px_-30px_rgba(10,40,90,0.35)] rtl:shadow-[24px_0_60px_-30px_rgba(10,40,90,0.35)]"
        : "absolute inset-y-0 end-0 w-[min(420px,100vw)] shadow-2xl"}`}
    >
      {/* A plain block, not <header>: inside the panel that would be a second
          banner for the whole page. */}
      <div className="flex items-start gap-3 border-b border-[#eef1f6] px-5 pt-5 pb-4">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#0a285a] text-white">
          <Sparkles className="size-5 text-[#ffab85]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="copilot-title" className="text-[16px] leading-6 font-bold text-[#0a285a]">{t("copilot.title")}</h2>
          <p className="mt-0.5 text-[12px] leading-5 ink-muted">{t("copilot.intro")}</p>
        </div>
        <button data-close type="button" onClick={onClose} aria-label={t("copilot.close")} className="grid size-10 shrink-0 place-items-center rounded-xl text-[#536b8c] hover:bg-[#0a285a]/[.06] hover:text-[#0a285a]">
          <X className="size-5" aria-hidden />
        </button>
      </div>

      <div ref={log} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <section aria-labelledby="copilot-brief">
          <h3 id="copilot-brief" className="text-[13px] font-semibold ink-muted">{t("copilot.briefTitle")}</h3>
          {brief.isLoading ? (
            <div role="status" className="mt-3 space-y-2">
              <span className="sr-only">{t("admin.loading")}</span>
              {[0, 1, 2].map(index => <div key={index} aria-hidden className="portal-shimmer h-16 rounded-xl" />)}
            </div>
          ) : brief.isError ? (
            <p className="mt-3 text-[14px] ink-muted">{t("copilot.unavailable")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {(brief.data?.insights ?? []).map((insight, index) => (
                <InsightRow key={`${insight.key}-${index}`} insight={insight} pageLabel={pageLabel} onLeave={wide ? undefined : onClose} />
              ))}
            </ul>
          )}
        </section>

        {turns.length > 0 ? (
          <section aria-label={t("copilot.askTitle")} className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold ink-muted">{t("copilot.askTitle")}</h3>
              <button type="button" onClick={() => setTurns([])} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-semibold text-[#536b8c] hover:bg-[#0a285a]/[.06] hover:text-[#0a285a]">
                <RotateCcw className="size-3.5" aria-hidden />{t("copilot.newChat")}
              </button>
            </div>
            {turns.map((turn, index) => (
              turn.role === "admin" ? (
                <div key={index} className="copilot-rise flex justify-end">
                  <p dir="auto" className="max-w-[85%] rounded-2xl rounded-ee-md bg-[#0a285a] px-3.5 py-2.5 text-[14px] leading-6 whitespace-pre-wrap text-white">
                    <span className="sr-only">{t("copilot.you")}: </span>{turn.text}
                  </p>
                </div>
              ) : (
                <div key={index} className="copilot-rise">
                  <div className={`rounded-2xl rounded-es-md border px-3.5 py-2.5 ${turn.failed ? "border-[#f3d6d1] bg-[#fdf3f1]" : "border-[#e3e8f0] bg-[#f8fafc]"}`}>
                    <p dir="auto" className={`text-[14px] leading-6 whitespace-pre-wrap ${turn.failed ? "text-[#8c2f22]" : "text-[#0a285a]"}`}>
                      <span className="sr-only">{t("copilot.title")}: </span>{turn.text}
                    </p>
                    {!turn.failed ? <p className="mt-2 text-[11px] leading-4 ink-muted">{t("copilot.aiNote")}</p> : null}
                  </div>
                  {turn.actions?.length ? (
                    <ul className="mt-2 space-y-2">
                      {turn.actions.map((action, actionIndex) => (
                        <li key={actionIndex}><ActionButton action={action} pageLabel={pageLabel} onLeave={wide ? undefined : onClose} /></li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )
            ))}
            {ask.isPending ? (
              <p role="status" className="flex items-center gap-2 text-[13px] ink-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden />{t("copilot.thinking")}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>

      <div className="border-t border-[#eef1f6] px-5 pt-3 pb-4">
        {canAsk ? (
          <>
            {!ask.isPending ? (
              <div role="group" aria-label={t("copilot.askTitle")} className="mb-3 flex flex-wrap gap-1.5">
                {suggestions.map(key => (
                  <button key={key} type="button" onClick={() => void send(t(key))} className="rounded-full border border-[#dfe5ee] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#0a285a] hover:border-[#4f46e5]/40 hover:bg-[#f0f2f5]">
                    {t(key)}
                  </button>
                ))}
              </div>
            ) : null}
            <form
              onSubmit={event => {
                event.preventDefault();
                void send(draft);
              }}
              className="flex items-end gap-2 rounded-2xl border border-[#cfd9e6] bg-white p-1.5 focus-within:border-[#0a285a] focus-within:ring-2 focus-within:ring-[#0a285a]/15"
            >
              <textarea
                ref={box}
                dir="auto"
                rows={1}
                value={draft}
                maxLength={MAX_COPILOT_QUESTION + 200}
                aria-label={t("copilot.placeholder")}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? "copilot-problem" : undefined}
                placeholder={t("copilot.placeholder")}
                onChange={event => {
                  setDraft(event.target.value);
                  if (problem) setProblem(null);
                }}
                onKeyDown={event => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send(draft);
                  }
                }}
                className="max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-2.5 py-2 text-[14px] leading-6 text-[#0a285a] outline-none placeholder:text-[#6b7c93]"
              />
              <button type="submit" disabled={ask.isPending} aria-label={t("copilot.send")} className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#0a285a] text-white hover:bg-[#0d3372] disabled:opacity-60">
                <Send className="size-4 rtl:-scale-x-100" aria-hidden />
              </button>
            </form>
            {problem ? <p id="copilot-problem" className="mt-2 text-[12px] font-semibold text-[#8c2f22]">{t(problem)}</p> : null}
          </>
        ) : brief.data ? (
          <p className="text-[13px] leading-5 ink-muted">{t("copilot.noModel")}</p>
        ) : null}
      </div>
    </div>
  );

  if (wide) return body;
  return createPortal(
    <div className="fixed inset-0 z-50 lg:hidden">
      <button type="button" aria-label={t("copilot.close")} tabIndex={-1} onClick={onClose} className="sheet-scrim absolute inset-0 bg-[#06142e]/50" />
      {body}
    </div>,
    document.body,
  );
}

function InsightRow({ insight, pageLabel, onLeave }: { insight: Insight; pageLabel: (href: string) => string; onLeave?: () => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  const tone = TONE[insight.tone];
  const params: Record<string, string | number> = { ...insight.params };
  if (typeof params.amount === "string") params.amount = money(params.amount);
  for (const [name, key] of Object.entries(insight.words ?? {})) params[name] = t(key);
  return (
    <li className="rounded-xl border border-[#e8ecf3] bg-white p-3">
      <div className="flex items-start gap-3">
        <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-lg ${tone.plate} ${tone.ink}`}>
          <tone.icon className="size-4" />
        </span>
        <p dir="auto" className="min-w-0 flex-1 pt-1 text-[14px] leading-5 text-[#0a285a]">{t(insight.key, params)}</p>
        {insight.count !== undefined ? (
          <span className="mt-0.5 shrink-0 rounded-full bg-[#0a285a] px-2 py-0.5 text-[12px] font-bold tabular-nums text-white"><bdi dir="ltr">{insight.count}</bdi></span>
        ) : null}
      </div>
      {insight.action ? <div className="mt-2.5 ps-11"><ActionButton action={insight.action} pageLabel={pageLabel} onLeave={onLeave} /></div> : null}
    </li>
  );
}

/** One proposal: a link, or a reorder point set only after a second press. */
function ActionButton({ action, pageLabel, onLeave }: { action: CopilotAction; pageLabel: (href: string) => string; onLeave?: () => void }) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);
  const save = trpc.inventory.variants.setReorderPoint.useMutation();
  const quiet = "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#dfe5ee] bg-white px-3 py-1.5 text-start text-[13px] font-semibold text-[#0a285a] hover:border-[#4f46e5]/40 hover:bg-[#f0f2f5]";

  if (action.kind === "open") {
    return (
      <Link href={action.page} onClick={onLeave} className={quiet}>
        {t("copilot.actionOpen", { page: pageLabel(action.page) })}
        <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
      </Link>
    );
  }
  if (done) {
    return (
      <p role="status" className="flex items-center gap-1.5 text-[13px] font-semibold text-[#0a7a0a]">
        <CheckCircle2 className="size-4" aria-hidden />{t("copilot.reorderDone", { product: action.product, level: action.level })}
      </p>
    );
  }
  if (!asking) {
    return <button type="button" onClick={() => setAsking(true)} className={quiet}>{t("copilot.actionReorder", { product: action.product, level: action.level })}</button>;
  }
  return (
    <div className="rounded-xl border border-[#c7cdfa] bg-[#f5f6fe] p-3">
      <p dir="auto" className="text-[13px] leading-5 text-[#0a285a]">{t("copilot.confirmReorder", { product: action.product, level: action.level })}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={save.isPending}
          onClick={async () => {
            try {
              await save.mutateAsync({ variantId: action.variantId, lowStockAt: action.level });
              setDone(true);
              void utils.inventory.lowStock.invalidate();
              void utils.inventory.stockHealth.invalidate();
              void utils.inventory.overview.invalidate();
              void utils.inventory.copilot.brief.invalidate();
            } catch (error) {
              toast.error(error instanceof Error && error.message ? tError(error.message) : t("copilot.unavailable"));
            }
          }}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#0a285a] px-3 text-[13px] font-semibold text-white hover:bg-[#0d3372] disabled:opacity-60"
        >
          {save.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}{t("copilot.confirm")}
        </button>
        <button type="button" onClick={() => setAsking(false)} className="inline-flex min-h-9 items-center rounded-lg px-3 text-[13px] font-semibold text-[#536b8c] hover:bg-[#0a285a]/[.06]">
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
