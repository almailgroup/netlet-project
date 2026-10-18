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
import { ArrowLeft, Headset, LoaderCircle, Sparkles } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, EmptyState, PageHeader, Pill, Segmented, SkeletonRows, textareaClass } from "@/components/admin/ui";
import { STATUS_LABEL, TOPIC_LABEL } from "@/components/account/AccountSupport";
import { useDateFormat, useDateTimeFormat } from "@/hooks/useDateFormat";
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
      <PageHeader title={t("support.inboxTitle")} description={t("support.inboxNote")} />
      <Segmented
        label={t("support.inboxTitle")}
        className="mb-4 w-fit"
        value={filter}
        onChange={entry => { setFilter(entry); setPage(1); setSelected(null); }}
        options={FILTERS.map(entry => ({ value: entry, label: entry === "all" ? t("support.filterAll") : t(STATUS_LABEL[entry]) }))}
      />

      {/* Side by side on a wide screen; on a phone the open conversation
          replaces the list, with a way back. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className={`min-w-0 ${selected !== null ? "hidden lg:block" : ""}`}>
          {inbox.isLoading ? (
            <SkeletonRows rows={4} label={t("admin.loading")} />
          ) : (
            <QueryGate queries={[inbox]}>
              {() => {
                const result = inbox.data!;
                if (result.rows.length === 0) return <EmptyState title={t("support.inboxEmpty")} />;
                return (
                  <>
                    <ul className="divide-y divide-[#eef1f5] overflow-hidden rounded-2xl border border-[#e1e7ef] bg-white">
                      {result.rows.map(row => {
                        const current = selected === row.id;
                        return (
                          <li key={row.id}>
                            <button
                              type="button"
                              aria-pressed={current}
                              onClick={() => setSelected(row.id)}
                              className={`w-full border-s-[3px] px-4 py-3 text-start text-[#0a285a] transition ${current ? "border-s-[#0a285a] bg-[#f4f7fb]" : "border-s-transparent hover:bg-[#0a285a]/[.06]"}`}
                            >
                              <span className="flex flex-wrap items-center justify-between gap-2">
                                <span className={`text-[14px] ${row.unread ? "font-bold" : "font-semibold"}`}>
                                  {t(TOPIC_LABEL[row.topic])}
                                  {row.orderReference ? <> · <bdi dir="ltr">{row.orderReference}</bdi></> : null}
                                </span>
                                {row.unread ? <Pill tone="navy">{t("support.unreadStaff")}</Pill> : <span className="text-[12px] ink-muted">{t(STATUS_LABEL[row.status])}</span>}
                              </span>
                              <span className="mt-0.5 block truncate text-[13px] ink-muted"><bdi dir="ltr">{row.shopperEmail ?? "—"}</bdi> · {formatDate(row.lastMessageAt)}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <Pager page={result} onPage={setPage} />
                  </>
                );
              }}
            </QueryGate>
          )}
        </div>
        <div className={`min-w-0 ${selected === null ? "hidden lg:block" : ""}`}>
          {selected ? (
            <>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#536b8c] hover:text-[#0a285a] lg:hidden"
              >
                <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />{t("admin.messagesBack")}
              </button>
              <StaffThread key={selected} id={selected} />
            </>
          ) : (
            <div className="grid h-full min-h-60 place-items-center rounded-2xl border border-dashed border-[#cfd9e6] bg-white px-5 py-10 text-center">
              <div>
                <Headset className="mx-auto size-8 text-[#8a9bb3]" aria-hidden />
                <p className="mt-3 text-[14px] text-[#536b8c]">{t("support.pickOne")}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function StaffThread({ id }: { id: number }) {
  const { t, tError } = useTranslation();
  const formatDate = useDateTimeFormat();
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
          <section aria-label={t("support.thread")} className="rounded-2xl border border-[#e1e7ef] bg-white p-4 text-[#0a285a] sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#eef1f5] pb-3">
              <div className="min-w-0">
                <h2 className="text-[16px] font-bold">
                  {t(TOPIC_LABEL[data.topic])}
                  {data.orderReference ? <> · <bdi dir="ltr">{data.orderReference}</bdi></> : null}
                </h2>
                <p className="mt-0.5 text-[13px] ink-muted">{data.shopperName ? <><bdi>{data.shopperName}</bdi> · </> : null}<bdi dir="ltr">{data.shopperEmail ?? ""}</bdi></p>
              </div>
              <Pill tone={data.status === "resolved" ? "good" : data.status === "open" ? "warning" : "neutral"}>{t(STATUS_LABEL[data.status])}</Pill>
            </div>
            <ol className="mt-4 space-y-3">
              {data.messages.map(message => (
                <li key={message.id} className={message.author === "staff" ? "flex justify-end" : "flex justify-start"}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-6 ${message.author === "staff" ? "bg-[#0a285a] text-white" : message.author === "automatic" ? "border border-[#cfd9e6] bg-[#f6f8fb]" : "bg-[#e7edf5]"}`}>
                    <p className={`text-[12px] font-semibold ${message.author === "staff" ? "text-[#d9e7f7]" : "ink-muted"}`}>
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
            <form className="mt-5 border-t border-[#eef1f5] pt-4" onSubmit={event => { event.preventDefault(); if (!messageProblem(body)) reply.mutate({ id, body }); }}>
              <label htmlFor={`support-reply-${id}`} className="block text-[13px] font-semibold text-[#0a285a]">{t("support.replyAsNetlet")}</label>
              <textarea
                id={`support-reply-${id}`}
                value={body}
                maxLength={MAX_SUPPORT_MESSAGE}
                dir="auto"
                aria-describedby={drafted ? "support-draft-note" : undefined}
                onChange={event => { setBody(event.target.value); if (!event.target.value) setDrafted(false); }}
                className={`${textareaClass} mt-1.5`}
              />
              {drafted ? (
                <p id="support-draft-note" className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-5 ink-muted">
                  <Sparkles className="mt-1 size-3 shrink-0" aria-hidden />{t("support.draftNote")}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="submit" disabled={Boolean(messageProblem(body)) || reply.isPending} className={buttonClass.primary}>
                  {reply.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}{t("support.send")}
                </button>
                {canDraft.data && !body ? (
                  <button type="button" onClick={() => draft.mutate({ id })} disabled={draft.isPending} className={buttonClass.secondary}>
                    {draft.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                    {t(draft.isPending ? "support.drafting" : "support.draft")}
                  </button>
                ) : null}
                {data.status !== "resolved" ? (
                  <button type="button" onClick={() => resolve.mutate({ id })} disabled={resolve.isPending} className={buttonClass.secondary}>{t("support.resolve")}</button>
                ) : null}
              </div>
            </form>
          </section>
        );
      }}
    </QueryGate>
  );
}
