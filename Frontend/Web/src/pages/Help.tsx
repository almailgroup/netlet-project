/**
 * `/help`: where an order is, what people ask most, and how to reach a person.
 *
 * Help was a message form inside the account, so a shopper who was signed out
 * — or who only wanted to know how paying works — had nowhere to go. In the
 * order a lost shopper needs them:
 *
 * - **Find an order** by its number and the email it was placed with, for
 *   somebody signed out (`help.lookupOrder`, throttled on misses); signed in,
 *   the orders page is one press away.
 * - **The answers**, each a rule the shop applies (`HELP_GROUPS`), as
 *   disclosures a keyboard opens like a pointer does.
 * - **Ask a question**, answered by the shop assistant through the AI gateway
 *   from those answers and nothing else, and said to be — drawn only while the
 *   gateway is set up and the assistant is on, and refusing to send a question
 *   that carries contact details.
 * - **A person**: WhatsApp and the phone when NetLet has recorded them, and a
 *   message, which needs signing in because the answer comes to the account.
 */
import { FULFILMENT, PAYMENT, Pill } from "@/components/account/AccountOrders";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { CARD, PageBody, PageHeading } from "@/components/layout/Page";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { gatewayErrorMessage } from "@/lib/aiGateway";
import { useAIChat } from "@/hooks/useAIChat";
import { ChatAnswer } from "@/components/assistant/ChatAnswer";
import { contactFindings, type ContactKind } from "@shared/commerce/contactFilter";
import { HELP_GROUPS, MAX_HELP_QUESTION } from "@shared/commerce/helpArticles";
import { phoneLink, whatsappLink } from "@shared/commerce/support";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";
import { ArrowRight, ChevronDown, LoaderCircle, MessageCircle, Phone, Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { GuideCard } from "@/components/guides/GuideCard";

const KIND_LABEL: Record<ContactKind, MessageKey> = {
  phone: "chat.foundPhone",
  email: "chat.foundEmail",
  link: "chat.foundLink",
  handle: "chat.foundHandle",
};

const card = `${CARD} p-5 sm:p-6`;
const field = "mt-1.5 h-11 w-full rounded-xl border border-[#cfd9e6] bg-white px-3 text-[15px] text-[#0a285a] outline-none focus-visible:border-[#0a285a] focus-visible:ring-2 focus-visible:ring-[#0a285a]/25";

export default function Help() {
  const { t } = useTranslation();
  usePageMeta(privatePageMeta("Help"));
  return (
    <PageBody width="reading">
      <PageHeading title={t("help.title")} note={t("help.intro")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <OrderLookup />
        <Contact />
      </div>
      <Answers />
      <Guides />
      <Ask />
    </PageBody>
  );
}

function OrderLookup() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const formatDate = useDateFormat();
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const lookup = trpc.help.lookupOrder.useMutation();
  const error = lookup.error?.message;

  return (
    <section aria-labelledby="lookup-title" className={card}>
      <h2 id="lookup-title" className="flex items-center gap-2 text-lg font-extrabold"><Search className="size-5" aria-hidden />{t("help.lookupTitle")}</h2>
      {isAuthenticated ? (
        <>
          <p className="mt-2 text-[14px] leading-6 text-[#404553]">{t("help.lookupSignedIn")}</p>
          <Link href="/account/orders" className="glass glass-navy pressable mt-4 inline-flex items-center gap-2 rounded-full px-5 py-3 text-[14px] font-bold">
            {t("help.lookupOpenOrders")}<ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        </>
      ) : (
        <form
          className="mt-3"
          onSubmit={event => { event.preventDefault(); lookup.mutate({ reference, email }); }}
        >
          <label className="block text-[13px] font-semibold">
            {t("help.lookupReference")}
            <input dir="ltr" value={reference} onChange={event => setReference(event.target.value)} autoComplete="off" required maxLength={40} aria-describedby="lookup-note" className={field} />
          </label>
          <p id="lookup-note" className="mt-1 text-[12px] leading-5 ink-muted">{t("help.lookupNote")}</p>
          <label className="mt-3 block text-[13px] font-semibold">
            {t("help.lookupEmail")}
            <input dir="ltr" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required maxLength={320} className={field} />
          </label>
          <button type="submit" disabled={lookup.isPending} className="glass glass-navy pressable mt-4 inline-flex items-center gap-2 rounded-full px-5 py-3 text-[14px] font-bold disabled:opacity-60">
            {lookup.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}{t("help.lookupButton")}
          </button>
          <div aria-live="polite">
            {error ? <p className="mt-3 text-[13px] font-semibold text-[#8c2f22]">{isMessageKey(error) ? t(error) : t("help.lookupNone")}</p> : null}
            {lookup.isSuccess && !lookup.data ? <p className="mt-3 text-[13px] font-semibold text-[#8c2f22]">{t("help.lookupNone")}</p> : null}
            {lookup.data ? (
              <div className="mt-4 rounded-xl border border-[#e6e9ef] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold"><bdi dir="ltr">{lookup.data.reference}</bdi></p>
                  <Pill label={t((PAYMENT[lookup.data.status] ?? PAYMENT.pending_payment).label)} className={(PAYMENT[lookup.data.status] ?? PAYMENT.pending_payment).className} />
                </div>
                <p className="mt-0.5 text-[12px] ink-muted">{t("help.lookupPlaced", { date: formatDate(lookup.data.placedAt) })}</p>
                <ul className="mt-3 space-y-2">
                  {lookup.data.lines.map((line, index) => {
                    const state = FULFILMENT[line.fulfilment] ?? FULFILMENT.pending;
                    return (
                      <li key={index} className="flex items-center justify-between gap-3 text-[14px]">
                        <span className="min-w-0"><span dir="auto" className="block truncate font-semibold">{line.title}</span><span className="text-[12px] ink-muted">× {line.quantity}</span></span>
                        <Pill label={t(state.label)} className={state.className} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}

function Contact() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const channels = trpc.support.channels.useQuery(undefined, { staleTime: 300_000 });
  const whatsapp = channels.data?.whatsapp ?? null;
  const phone = channels.data?.phone ?? null;
  return (
    <section aria-labelledby="contact-title" className={card}>
      <h2 id="contact-title" className="flex items-center gap-2 text-lg font-extrabold"><MessageCircle className="size-5" aria-hidden />{t("help.contactTitle")}</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="/account/help" className="glass glass-navy pressable inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[14px] font-bold">
          {t("help.contactMessage")}
        </Link>
        {whatsapp ? (
          <a href={whatsappLink(whatsapp, t("support.whatsappHello"))} target="_blank" rel="noopener noreferrer" className="glass pressable inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[14px] font-bold">
            <MessageCircle className="size-4" aria-hidden />{t("support.whatsapp")}<span className="sr-only"> {t("support.opensNewTab")}</span>
          </a>
        ) : null}
        {phone ? (
          <a href={phoneLink(phone)} className="glass pressable inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[14px] font-bold">
            <Phone className="size-4" aria-hidden />{t("support.call")} <bdi dir="ltr">+{phone}</bdi>
          </a>
        ) : null}
      </div>
      {isAuthenticated ? null : <p className="mt-3 text-[13px] leading-6 ink-muted">{t("help.contactMessageNote")}</p>}
    </section>
  );
}

function Answers() {
  const { t } = useTranslation();
  return (
    <div className="mt-8 space-y-6">
      {HELP_GROUPS.map(group => (
        <section key={group.id} aria-labelledby={`help-${group.id}`}>
          <h2 id={`help-${group.id}`} className="text-lg font-extrabold">{t(group.title)}</h2>
          <div className="mt-3 divide-y divide-[#e6e9ef] rounded-2xl border border-[#e6e9ef] bg-white">
            {group.entries.map(entry => (
              <details key={entry.id} id={entry.id} className="group px-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-[15px] font-bold marker:hidden">
                  {t(entry.question)}
                  <ChevronDown className="size-4 shrink-0 text-[#536b8c] transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <div className="pb-4 text-[14px] leading-6 text-[#404553]">
                  <p>{t(entry.answer, entry.params)}</p>
                  {entry.link ? (
                    <Link href={entry.link.href} className="mt-2 inline-flex items-center gap-1 font-bold ink-accent hover:underline">
                      {t(entry.link.label)}<ArrowRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
                    </Link>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The step-by-step guides (3.5.3), the newest four, once one is published. */
function Guides() {
  const { t } = useTranslation();
  const guides = trpc.guides.published.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const list = (guides.data ?? []).slice(0, 4);
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="help-guides" className="mt-8">
      <div className="flex items-center justify-between gap-3">
        <h2 id="help-guides" className="text-lg font-extrabold">{t("guides.helpTitle")}</h2>
        <Link href="/guides" className="inline-flex items-center gap-1 text-[14px] font-bold ink-accent hover:underline">
          {t("guides.all")}<ArrowRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
        </Link>
      </div>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {list.map(guide => <li key={guide.slug} className="min-w-0"><GuideCard guide={guide} /></li>)}
      </ul>
    </section>
  );
}

function Ask() {
  const { t } = useTranslation();
  /* One question at a time — the shop assistant through the AI gateway,
     answering from these same help answers. */
  const chat = useAIChat({ single: true });
  const [question, setQuestion] = useState("");
  /* The gateway's own filter, asked as somebody types, so Ask never sends what it would refuse. */
  const found = contactFindings(question)[0];
  if (!chat.available) return null;
  const busy = chat.status !== "idle";
  const answer = chat.messages.find(message => message.role === "assistant");
  return (
    <section aria-labelledby="ask-title" className={`${card} mt-8`}>
      <h2 id="ask-title" className="flex items-center gap-2 text-lg font-extrabold"><Sparkles className="size-5 ink-accent" aria-hidden />{t("help.askTitle")}</h2>
      <p className="mt-1 text-[13px] leading-6 ink-muted">{t("help.askNote")}</p>
      <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={event => { event.preventDefault(); if (!found && !busy) void chat.send(question); }}>
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("help.askLabel")}</span>
          <input dir="auto" value={question} onChange={event => setQuestion(event.target.value)} maxLength={MAX_HELP_QUESTION} placeholder={t("help.askLabel")} aria-invalid={Boolean(found)} aria-describedby={found ? "ask-problem" : undefined} className={`${field} mt-0`} />
        </label>
        <button type="submit" disabled={busy || question.trim().length < 2 || Boolean(found)} className="glass glass-navy pressable inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-[14px] font-bold disabled:opacity-60">
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}{t("help.askButton")}
        </button>
      </form>
      <div aria-live="polite" aria-busy={busy}>
        {found ? <p id="ask-problem" className="mt-2 text-[13px] font-semibold text-[#8c2f22]">{t("help.askContact", { kind: t(KIND_LABEL[found]) })}</p> : null}
        {chat.error && !found ? <p className="mt-3 text-[13px] font-semibold text-[#8c2f22]">{t(gatewayErrorMessage(chat.error))}</p> : null}
        {answer?.text ? <div className="mt-4"><ChatAnswer message={answer} note="help.askAnswerNote" /></div> : null}
      </div>
    </section>
  );
}
