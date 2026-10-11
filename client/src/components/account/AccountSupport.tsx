/**
 * Talking to NetLet (3.5.1), on the account page.
 *
 * Asking is one small form — what it is about, which order if any, and the
 * message — and the answer arrives at once: an automatic one computed from the
 * order's own facts, labelled as automatic, with a line saying a person will
 * read the message anyway. NetLet's replies land in the same conversation, and
 * "This answered it" closes it from the shopper's side.
 *
 * The automatic answer is stored as message keys, so it reads in whichever
 * language the shopper is using when they come back to it.
 */
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, LifeBuoy, MessageCircle, Phone, Sparkles } from "lucide-react";
import { QueryGate } from "@/components/admin/QueryGate";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { SUPPORT_TOPICS, MAX_SUPPORT_MESSAGE, messageProblem, phoneLink, whatsappLink, type SupportStatus, type SupportTopic } from "@shared/commerce/support";
import type { MessageKey } from "@shared/i18n/dictionary";

export const TOPIC_LABEL: Record<SupportTopic, MessageKey> = {
  order: "support.topicOrder",
  delivery: "support.topicDelivery",
  return: "support.topicReturn",
  payment: "support.topicPayment",
  account: "support.topicAccount",
  other: "support.topicOther",
};

export const STATUS_LABEL: Record<SupportStatus, MessageKey> = {
  open: "support.statusOpen",
  waiting: "support.statusWaiting",
  resolved: "support.statusResolved",
};

const field = "glass-field mt-1 w-full rounded-xl px-4 py-3 text-[14px] outline-none";

export function AccountSupport() {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const mine = trpc.support.mine.useQuery();
  const orders = trpc.orders.list.useQuery({ pageSize: 20 });
  const [topic, setTopic] = useState<SupportTopic>("order");
  const [reference, setReference] = useState("");
  const [body, setBody] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const open = trpc.support.open.useMutation({
    onSuccess: reply => {
      setBody("");
      setOpenId(reply.id);
      void utils.support.mine.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
  });
  const problem = body ? messageProblem(body) : null;

  return (
    <div className="space-y-4">
      <form
        className="rounded-2xl border border-[#e6e9ef] bg-white p-5"
        onSubmit={event => {
          event.preventDefault();
          if (!messageProblem(body)) open.mutate({ topic, orderReference: reference || null, body });
        }}
      >
        <h3 className="flex items-center gap-2 text-[13px] font-extrabold text-[#0a285a]">
          <LifeBuoy className="size-4" aria-hidden />{t("support.askTitle")}
        </h3>
        <p className="mt-1 text-[12px] leading-5 ink-muted">{t("support.askNote")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-[12px] font-bold text-[#536b8c]">
            {t("support.about")}
            <select aria-label={t("support.about")} value={topic} onChange={event => setTopic(event.target.value as SupportTopic)} className={field}>
              {SUPPORT_TOPICS.map(option => <option key={option} value={option}>{t(TOPIC_LABEL[option])}</option>)}
            </select>
          </label>
          <label className="text-[12px] font-bold text-[#536b8c]">
            {t("support.whichOrder")}
            <select aria-label={t("support.whichOrder")} value={reference} onChange={event => setReference(event.target.value)} className={field}>
              <option value="">{t("support.noOrder")}</option>
              {(orders.data?.rows ?? []).map(order => <option key={order.id} value={order.reference}>{order.reference}</option>)}
            </select>
          </label>
          <label className="text-[12px] font-bold text-[#536b8c] sm:col-span-2">
            {t("support.message")}
            <textarea value={body} maxLength={MAX_SUPPORT_MESSAGE} onChange={event => setBody(event.target.value)} className={`${field} min-h-24 font-normal`} />
          </label>
        </div>
        {problem === "support.tooLong" ? <p className="mt-2 text-[12px] font-bold text-[#8c2f22]">{t(problem)}</p> : null}
        <button type="submit" disabled={Boolean(messageProblem(body)) || open.isPending} className="glass-navy pressable type-control mt-3 rounded-full px-5 py-2 disabled:opacity-50">{t("support.send")}</button>
      </form>

      <OtherChannels reference={reference} />

      <QueryGate audience="shopper" queries={[mine]}>
        {() => {
          const rows = mine.data ?? [];
          if (rows.length === 0) return <p className="text-[12px] ink-muted">{t("support.none")}</p>;
          return (
            <ul className="space-y-2">
              {rows.map(row => (
                <li key={row.id} className="rounded-2xl border border-[#e6e9ef] bg-white">
                  <button
                    type="button"
                    aria-expanded={openId === row.id}
                    onClick={() => setOpenId(openId === row.id ? null : row.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-start text-[12px] text-[#0a285a]"
                  >
                    <span className="font-extrabold">
                      {t(TOPIC_LABEL[row.topic])}
                      {row.orderReference ? <> · <bdi dir="ltr">{row.orderReference}</bdi></> : null}
                      {row.unread ? <span className="ms-2 rounded-full bg-[#0a285a] px-2 py-0.5 text-[10px] text-white">{t("support.newReply")}</span> : null}
                    </span>
                    <span className="rounded-full bg-[#e7edf5] px-3 py-1 text-[11px] font-extrabold">{t(STATUS_LABEL[row.status])}</span>
                  </button>
                  {openId === row.id ? <Thread id={row.id} /> : null}
                </li>
              ))}
            </ul>
          );
        }}
      </QueryGate>
    </div>
  );
}

function Thread({ id }: { id: number }) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const formatDate = useDateFormat();
  const thread = trpc.support.thread.useQuery({ id });
  const [body, setBody] = useState("");
  const refresh = () => { void utils.support.thread.invalidate({ id }); void utils.support.mine.invalidate(); void utils.support.unread.invalidate(); };
  const reply = trpc.support.reply.useMutation({ onSuccess: () => { setBody(""); refresh(); }, onError: error => toast.error(tError(error.message)) });
  const resolve = trpc.support.resolve.useMutation({ onSuccess: () => { toast.success(t("support.resolvedToast")); refresh(); }, onError: error => toast.error(tError(error.message)) });

  return (
    <div className="border-t border-[#eef1f6] px-4 py-3">
      <QueryGate audience="shopper" queries={[thread]}>
        {() => {
          const data = thread.data!;
          return (
            <>
              <ol className="space-y-2">
                {data.messages.map(message => (
                  <li key={message.id} className={message.author === "shopper" ? "flex justify-end" : "flex justify-start"}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-6 ${message.author === "shopper" ? "bg-[#0a285a] text-white" : message.author === "automatic" ? "border border-[#d5dfeb] bg-[#f6f8fb] text-[#0a285a]" : "bg-[#e7edf5] text-[#0a285a]"}`}>
                      <p className={`text-[12px] font-semibold ${message.author === "shopper" ? "text-[#d9e7f7]" : "ink-muted"}`}>
                        {message.author === "automatic" ? <span className="inline-flex items-center gap-1"><Sparkles className="size-3" aria-hidden />{t("support.automatic")}</span> : t(message.author === "shopper" ? "support.you" : "support.netlet")}
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
                  {t("support.reply")}
                  <textarea value={body} maxLength={MAX_SUPPORT_MESSAGE} onChange={event => setBody(event.target.value)} className={`${field} min-h-20`} />
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="submit" disabled={Boolean(messageProblem(body)) || reply.isPending} className="glass-navy pressable type-control rounded-full px-4 py-2 disabled:opacity-50">{t("support.send")}</button>
                  {data.status !== "resolved" ? (
                    <button type="button" onClick={() => resolve.mutate({ id })} disabled={resolve.isPending} className="glass pressable type-control inline-flex items-center gap-2 rounded-full px-4 py-2">
                      <CheckCircle2 className="size-4" aria-hidden />{t("support.answered")}
                    </button>
                  ) : null}
                </div>
              </form>
            </>
          );
        }}
      </QueryGate>
    </div>
  );
}

/**
 * NetLet's WhatsApp and phone (3.5.1), drawn only when configured — a channel
 * with no number behind it is not one. WhatsApp opens with the chosen order's
 * reference written in; the conversation happens there, not in this inbox,
 * and the line under the links says so.
 */
function OtherChannels({ reference }: { reference: string }) {
  const { t } = useTranslation();
  const channels = trpc.support.channels.useQuery(undefined, { staleTime: 300_000 });
  const whatsapp = channels.data?.whatsapp ?? null;
  const phone = channels.data?.phone ?? null;
  if (!whatsapp && !phone) return null;
  const text = reference ? t("support.whatsappAboutOrder", { reference }) : t("support.whatsappHello");
  return (
    <div className="rounded-2xl border border-[#e6e9ef] bg-white p-5">
      <h3 className="text-[13px] font-extrabold text-[#0a285a]">{t("support.otherChannels")}</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {whatsapp ? (
          <a href={whatsappLink(whatsapp, text)} target="_blank" rel="noopener noreferrer" className="glass pressable type-control inline-flex items-center gap-2 rounded-full px-4 py-2">
            <MessageCircle className="size-4" aria-hidden />{t("support.whatsapp")}<span className="sr-only"> {t("support.opensNewTab")}</span>
          </a>
        ) : null}
        {phone ? (
          <a href={phoneLink(phone)} className="glass pressable type-control inline-flex items-center gap-2 rounded-full px-4 py-2">
            <Phone className="size-4" aria-hidden />{t("support.call")} <bdi dir="ltr">+{phone}</bdi>
          </a>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] leading-5 ink-muted">{t("support.otherChannelsNote")}</p>
    </div>
  );
}
