/**
 * NetLet's support inbox (3.5.1).
 *
 * Conversations waiting on NetLet come first, filtered and paged on the server
 * like every admin list. Each opens beside the list with the shopper's own
 * words, the automatic answer they were already given — so nobody repeats it
 * back to them — and a reply box. Replying hands the turn to the shopper;
 * resolving closes it, and the shopper writing again reopens it.
 */
import { useState } from "react";
import { toast } from "sonner";
import { LoaderCircle, Sparkles } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { STATUS_LABEL, TOPIC_LABEL } from "@/components/account/AccountSupport";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { MAX_SUPPORT_MESSAGE, messageProblem, type SupportStatus } from "@shared/commerce/support";
import { privatePageMeta } from "@shared/seo";

const FILTERS: (SupportStatus | "all")[] = ["open", "waiting", "resolved", "all"];

export default function AdminSupport() {
  usePageMeta(privatePageMeta("Support"));
  return <AdminShell need="support.answer">{() => <Inbox />}</AdminShell>;
}

function Inbox() {
  const { t } = useTranslation();
  const formatDate = useDateFormat();
  const [filter, setFilter] = useState<SupportStatus | "all">("open");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const inbox = trpc.support.inbox.useQuery({ status: filter === "all" ? undefined : filter, page }, { placeholderData: previous => previous });

  return (
    <>
      <h1 className="text-[22px] leading-8 font-extrabold sm:text-[24px]">{t("support.inboxTitle")}</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("support.inboxNote")}</p>
      <div role="tablist" aria-label={t("support.inboxTitle")} className="mt-5 inline-flex flex-wrap gap-1 rounded-2xl bg-[#eef1f6] p-1">
        {FILTERS.map(entry => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={filter === entry}
            onClick={() => { setFilter(entry); setPage(1); setSelected(null); }}
            className={`rounded-xl px-4 py-2 text-[12px] font-extrabold ${filter === entry ? "bg-white text-[#0a285a] shadow-sm" : "text-[#536b8c]"}`}
          >
            {entry === "all" ? t("support.filterAll") : t(STATUS_LABEL[entry])}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <QueryGate queries={[inbox]}>
          {() => {
            const result = inbox.data!;
            if (result.rows.length === 0) return <p className="rounded-xl border border-[#d5dfeb] bg-white/60 px-4 py-5 text-[13px] text-[#536b8c]">{t("support.inboxEmpty")}</p>;
            return (
              <div className="min-w-0 space-y-2">
                <ul className="space-y-2">
                  {result.rows.map(row => (
                    <li key={row.id}>
                      <button
                        type="button"
                        aria-pressed={selected === row.id}
                        onClick={() => setSelected(row.id)}
                        className={`w-full rounded-2xl border px-4 py-3 text-start text-[12px] text-[#0a285a] ${selected === row.id ? "border-[#0a285a] bg-[#eaf1fb]" : "border-[#e6e9ef] bg-white"}`}
                      >
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-extrabold">
                            {t(TOPIC_LABEL[row.topic])}
                            {row.orderReference ? <> · <bdi dir="ltr">{row.orderReference}</bdi></> : null}
                          </span>
                          {row.unread ? <span className="rounded-full bg-[#0a285a] px-2 py-0.5 text-[10px] font-extrabold text-white">{t("support.unreadStaff")}</span> : <span className="ink-muted">{t(STATUS_LABEL[row.status])}</span>}
                        </span>
                        <span className="mt-1 block ink-muted"><bdi dir="ltr">{row.shopperEmail ?? "—"}</bdi> · {formatDate(row.lastMessageAt)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Pager page={result} onPage={setPage} />
              </div>
            );
          }}
        </QueryGate>
        <div className="min-w-0">{selected ? <StaffThread key={selected} id={selected} /> : <p className="text-[13px] ink-muted">{t("support.pickOne")}</p>}</div>
      </div>
    </>
  );
}

function StaffThread({ id }: { id: number }) {
  const { t, tError } = useTranslation();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const thread = trpc.support.staffThread.useQuery({ id });
  const [body, setBody] = useState("");
  const refresh = () => { void utils.support.staffThread.invalidate({ id }); void utils.support.inbox.invalidate(); void utils.support.waiting.invalidate(); };
  const reply = trpc.support.staffReply.useMutation({ onSuccess: () => { setBody(""); setDrafted(false); toast.success(t("support.sent")); refresh(); }, onError: error => toast.error(tError(error.message)) });
  const resolve = trpc.support.staffResolve.useMutation({ onSuccess: () => { toast.success(t("support.resolvedToast")); refresh(); }, onError: error => toast.error(tError(error.message)) });
  const canDraft = trpc.support.draftAvailable.useQuery(undefined, { staleTime: 60_000 });
  /* Whether what is in the box came from a model, so the note stays beside it until a person has sent it. */
  const [drafted, setDrafted] = useState(false);
  const draft = trpc.support.draft.useMutation({
    onSuccess: reply => {
      if (reply.kind === "draft") { setBody(reply.text); setDrafted(true); }
      else toast.message(t(reply.kind === "nothingToAnswer" ? "support.nothingToAnswer" : "support.draftUnavailable"));
    },
    onError: error => toast.error(tError(error.message)),
  });

  return (
    <QueryGate queries={[thread]}>
      {() => {
        const data = thread.data!;
        return (
          <section aria-label={t("support.thread")} className="rounded-2xl border border-[#e6e9ef] bg-white p-4 text-[#0a285a]">
            <p className="text-[13px] font-extrabold">
              {t(TOPIC_LABEL[data.topic])}
              {data.orderReference ? <> · <bdi dir="ltr">{data.orderReference}</bdi></> : null}
              {" · "}{t(STATUS_LABEL[data.status])}
            </p>
            <p className="mt-0.5 text-[12px] ink-muted">{data.shopperName ? <bdi>{data.shopperName}</bdi> : null} <bdi dir="ltr">{data.shopperEmail ?? ""}</bdi></p>
            <ol className="mt-3 space-y-2">
              {data.messages.map(message => (
                <li key={message.id} className={message.author === "staff" ? "flex justify-end" : "flex justify-start"}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-6 ${message.author === "staff" ? "bg-[#0a285a] text-white" : message.author === "automatic" ? "border border-[#d5dfeb] bg-[#f6f8fb]" : "bg-[#e7edf5]"}`}>
                    <p className={`text-[10px] font-extrabold tracking-[.08em] uppercase ${message.author === "staff" ? "text-[#d9e7f7]" : "ink-muted"}`}>
                      {message.author === "automatic" ? <span className="inline-flex items-center gap-1"><Sparkles className="size-3" aria-hidden />{t("support.automaticSent")}</span> : t(message.author === "staff" ? "support.netlet" : "support.shopper")}
                      {" · "}{formatDate(message.createdAt)}
                    </p>
                    {message.answer
                      ? message.answer.map((part, index) => <p key={index} className="mt-1">{t(part.key, part.params)}</p>)
                      : <p dir="auto" className="mt-1 whitespace-pre-wrap">{message.body}</p>}
                  </div>
                </li>
              ))}
            </ol>
            <form className="mt-3" onSubmit={event => { event.preventDefault(); if (!messageProblem(body)) reply.mutate({ id, body }); }}>
              <label className="block text-[11px] font-extrabold ink-muted">
                {t("support.replyAsNetlet")}
                <textarea
                  value={body}
                  maxLength={MAX_SUPPORT_MESSAGE}
                  dir="auto"
                  aria-describedby={drafted ? "support-draft-note" : undefined}
                  onChange={event => { setBody(event.target.value); if (!event.target.value) setDrafted(false); }}
                  className="glass-field mt-1 min-h-24 w-full rounded-xl px-4 py-3 text-[14px] font-normal outline-none"
                />
              </label>
              {drafted ? (
                <p id="support-draft-note" className="mt-1 flex items-start gap-1.5 text-[11px] leading-5 ink-muted">
                  <Sparkles className="mt-1 size-3 shrink-0" aria-hidden />{t("support.draftNote")}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="submit" disabled={Boolean(messageProblem(body)) || reply.isPending} className="glass-navy pressable type-control rounded-full px-4 py-2 disabled:opacity-50">{t("support.send")}</button>
                {canDraft.data && !body ? (
                  <button type="button" onClick={() => draft.mutate({ id })} disabled={draft.isPending} className="glass pressable type-control inline-flex items-center gap-2 rounded-full px-4 py-2">
                    {draft.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                    {t(draft.isPending ? "support.drafting" : "support.draft")}
                  </button>
                ) : null}
                {data.status !== "resolved" ? (
                  <button type="button" onClick={() => resolve.mutate({ id })} disabled={resolve.isPending} className="glass pressable type-control rounded-full px-4 py-2">{t("support.resolve")}</button>
                ) : null}
              </div>
            </form>
          </section>
        );
      }}
    </QueryGate>
  );
}
