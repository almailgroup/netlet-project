/**
 * The help centre's self-service on the web (`Shared/commerce/selfService.ts`
 * is the rule; `support.selfHelp` the server's answer): the issues a shopper
 * can name, the answer from their own order, the acts that would settle it —
 * each done on Confirm, by the same call the item's own form makes — and the
 * hand-off to a person carrying the issue, the item and what was done.
 *
 * Drawn on an opened order (`OrderHelp`) and on `/help` (`IssueCentre`); both
 * read the same answer, so the two offer the same.
 */
import { useId, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import {
  Banknote,
  CheckCircle2,
  Clock,
  ListChecks,
  LoaderCircle,
  PackageSearch,
  PackageX,
  Repeat,
  RotateCcw,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Thumb } from "@/components/product/Thumb";
import { Select } from "@/components/ui/Select";
import { REASON_LABEL } from "@/components/account/LineReturn";
import { useCart } from "@/contexts/CartContext";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import {
  doneForReturn,
  topicFor,
  type HelpDone,
  type HelpIssue,
  type HelpOffer,
  type HelpPage,
  type HelpPanel,
  type HelpResolution,
} from "@shared/commerce/selfService";
import type { ReturnKind, ReturnReason } from "@shared/commerce/returnRequests";
import type { MessageKey } from "@shared/i18n/dictionary";

export const ISSUE_ICON: Record<HelpIssue, LucideIcon> = {
  late: Clock,
  damaged: PackageX,
  wrong: PackageSearch,
  return: RotateCcw,
  exchange: Repeat,
  warranty: ShieldCheck,
  payment: Banknote,
  account: UserRound,
};

/** What a panel an answer opens is called, in the page's words. */
export const PANEL_LABEL: Record<HelpPanel, MessageKey> = {
  track: "orders.track",
  refund: "orders.requestRefund",
  returnForm: "help.offer.otherReason",
  warranty: "warranty.title",
  address: "orders.changeAddress",
  modify: "orders.modify",
  rate: "orders.rateItems",
};

const PAGE: Record<HelpPage, { href: string; label: MessageKey }> = {
  profile: { href: "/account/details", label: "help.page.profile" },
  notifications: { href: "/account/preferences", label: "help.page.notifications" },
  addresses: { href: "/account/addresses", label: "help.page.addresses" },
  returns: { href: "/account/returns", label: "help.page.returns" },
};

export type HelpItem = { id: number; title: string; variant?: string | null; photo: string | null; variantId: number | null; quantity: number };
export type DoneAct = { act: HelpDone; lineId: number | null };

const PILL = "glass type-control pressable inline-flex min-h-11 items-center gap-2 rounded-full px-3.5 py-1.5 pointer-fine:min-h-9";
const NAVY = "glass-navy type-control pressable inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 disabled:opacity-60 pointer-fine:min-h-9";

/** The issues as presses, each with its picture. */
export function IssueChips({ issues, onPick, label }: { issues: readonly HelpIssue[]; onPick: (issue: HelpIssue) => void; label: string }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {issues.map(issue => {
        const Icon = ISSUE_ICON[issue];
        return (
          <button key={issue} type="button" onClick={() => onPick(issue)} className={PILL}>
            <Icon className="size-4 shrink-0" aria-hidden />{t(`help.issue.${issue}`)}
          </button>
        );
      })}
    </div>
  );
}

/** The order's items to choose from, for an issue about one of them. */
export function ItemPicker({ items, onPick }: { items: readonly HelpItem[]; onPick: (lineId: number) => void }) {
  const { t } = useTranslation();
  return (
    <fieldset>
      <legend className="text-[13px] font-extrabold text-[#0a285a]">{t("help.chooseItem")}</legend>
      <ul className="mt-2 space-y-2">
        {items.map(item => (
          <li key={item.id}>
            <button type="button" onClick={() => onPick(item.id)} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-[#e7edf5] bg-white px-3 py-2 text-start hover:bg-[#f0f2f5]">
              <Thumb src={item.photo} alt="" className="size-10 shrink-0 rounded-lg border border-[#e7edf5] bg-white object-contain" icon={<PackageSearch className="size-4" />} />
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate text-[13px] font-bold text-[#0a285a]">{item.title}</span>
                {item.variant ? <span dir="auto" className="block truncate text-[12px] ink-muted">{item.variant}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** Refreshes what an act changed: the order, the list and the returns. */
function useOrderRefresh(reference: string) {
  const utils = trpc.useUtils();
  return () => {
    void utils.orders.get.invalidate({ reference });
    void utils.orders.list.invalidate();
    void utils.orders.onTheWay.invalidate();
    void utils.orders.myReturns.invalidate();
  };
}

/**
 * The answer from the order: what is true now, then what would settle it.
 * `onOpen` opens a panel the act needs words for; `onDone` hears each act
 * done, so a person is told what was already tried.
 */
export function HelpAnswer({ reference, answer, items, onOpen, onDone }: {
  reference: string | null;
  answer: HelpResolution;
  items: readonly HelpItem[];
  onOpen: (panel: HelpPanel, lineId: number | null) => void;
  onDone: (done: DoneAct) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-[#e7edf5] bg-[#f8f9fc] p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#536b8c]"><ListChecks className="size-3.5" aria-hidden />{t("help.fromOrder")}</p>
      <div className="mt-1 space-y-1.5 text-[13px] leading-5 text-[#1f2a44]">
        {answer.say.map((part, index) => <p key={index}>{t(part.key, part.params)}</p>)}
      </div>
      {answer.offers.length ? (
        <HelpOffers reference={reference} offers={answer.offers} items={items} onOpen={onOpen} onDone={onDone} />
      ) : null}
    </div>
  );
}

/** Acts first, as cards with Confirm; then the panels and pages, as presses. */
export function HelpOffers({ reference, offers, items, onOpen, onDone }: {
  reference: string | null;
  offers: readonly HelpOffer[];
  items: readonly HelpItem[];
  onOpen: (panel: HelpPanel, lineId: number | null) => void;
  onDone: (done: DoneAct) => void;
}) {
  const { t } = useTranslation();
  const titleOf = (lineId: number | null) => items.find(item => item.id === lineId)?.title ?? "";
  const acts = offers.filter(offer => offer.kind !== "open" && offer.kind !== "page");
  const links = offers.filter(offer => offer.kind === "open" || offer.kind === "page");
  return (
    <div className="mt-3 space-y-2">
      {reference ? acts.map((offer, index) => (
        <ActCard key={`${offer.kind}-${index}`} reference={reference} offer={offer} item={items.find(item => "lineId" in offer && item.id === offer.lineId) ?? null} title={titleOf("lineId" in offer ? offer.lineId : null)} onDone={onDone} />
      )) : null}
      {links.length ? (
        <div className="flex flex-wrap gap-1.5">
          {links.map((offer, index) => offer.kind === "page" ? (
            <Link key={`page-${offer.to}`} href={PAGE[offer.to].href} className={PILL}>{t(PAGE[offer.to].label)}</Link>
          ) : offer.kind === "open" ? (
            <button key={`open-${offer.panel}-${index}`} type="button" onClick={() => onOpen(offer.panel, offer.lineId)} className={PILL}>
              {t(offer.panel === "track" && offer.lineId !== null ? "orders.trackItem" : PANEL_LABEL[offer.panel])}
            </button>
          ) : null)}
        </div>
      ) : null}
      {acts.length && reference ? <p className="text-[11px] leading-4 ink-muted">{t("help.offer.note")}</p> : null}
    </div>
  );
}

type Outcome = { tone: "done" | "refused"; text: string };

/** One act, said in full, done on Confirm. */
function ActCard({ reference, offer, item, title, onDone }: {
  reference: string;
  offer: Exclude<HelpOffer, { kind: "open" } | { kind: "page" }>;
  item: HelpItem | null;
  title: string;
  onDone: (done: DoneAct) => void;
}) {
  const { t, tError } = useTranslation();
  const ids = useId();
  const refresh = useOrderRefresh(reference);
  const { cartId, adoptCart, addItem } = useCart();
  const [, navigate] = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [kind, setKind] = useState<ReturnKind>(offer.kind === "return" ? offer.returnKinds[0] : "refund");
  const [reason, setReason] = useState<ReturnReason>(offer.kind === "return" ? offer.reasons[0] : "damaged");
  const lineId = "lineId" in offer ? offer.lineId : null;

  const failed = (message: string) => {
    setOutcome({ tone: "refused", text: tError(message) });
    onDone({ act: "failed", lineId });
    refresh();
  };
  const ask = trpc.orders.requestReturn.useMutation({
    onSuccess: reply => {
      const act = doneForReturn(kind, reply.status);
      setOutcome(reply.status === "declined"
        ? { tone: "refused", text: t("help.result.declined", { reason: reply.declineReason ? tError(reply.declineReason) : "" }) }
        : { tone: "done", text: t(reply.status === "approved" ? "help.result.approved" : "help.result.waiting") });
      onDone({ act, lineId });
      refresh();
    },
    onError: error => failed(error.message),
  });
  const cancel = trpc.orders.cancel.useMutation({
    onSuccess: () => { setOutcome({ tone: "done", text: t("help.result.cancelOrder") }); onDone({ act: "cancelOrder", lineId: null }); refresh(); },
    onError: error => failed(error.message),
  });
  const quote = trpc.orders.changeQuote.useQuery(
    { reference, changes: [{ lineId: lineId ?? 0, quantity: 0 }] },
    { enabled: offer.kind === "cancelItem" && lineId !== null && !outcome && !dismissed, retry: false, refetchOnWindowFocus: false },
  );
  const change = trpc.orders.change.useMutation({
    onSuccess: () => { setOutcome({ tone: "done", text: t("help.result.cancelItem", { item: title }) }); onDone({ act: "cancelItem", lineId }); refresh(); },
    onError: error => { if (error.message === "orders.changeMoved") void quote.refetch(); failed(error.message); },
  });
  const again = trpc.orders.buyAgain.useMutation({
    onSuccess: async answer => {
      if (answer.cartId) await adoptCart(answer.cartId);
      if (answer.added > 0) {
        setOutcome({ tone: "done", text: t("help.result.buyAgain") });
        onDone({ act: "buyAgain", lineId: null });
      } else failed("orders.buyAgainNone");
    },
    onError: error => failed(error.message),
  });
  const [adding, setAdding] = useState(false);

  if (dismissed) return null;
  if (outcome) {
    return (
      <p role="status" className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] leading-5 ${outcome.tone === "done" ? "bg-[#e9f4ee] text-[#1f5e3a]" : "bg-[#fdecea] text-[#8c2f22]"}`}>
        {outcome.tone === "done" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
        <span>{outcome.text}</span>
        {outcome.tone === "done" && offer.kind === "buyAgain" ? (
          <button type="button" onClick={() => navigate("/cart")} className="ms-auto shrink-0 font-bold underline underline-offset-2">{t("product.viewCart")}</button>
        ) : null}
      </p>
    );
  }

  let heading: string;
  let body: ReactNode;
  let confirm: string;
  let pending: boolean;
  let run: () => void;
  let disabled = false;
  let choices: ReactNode = null;
  switch (offer.kind) {
    case "return":
      heading = t("help.offer.returnTitle", { item: title });
      body = t(kind === "exchange" ? "help.offer.exchangeBody" : "help.offer.returnBody");
      confirm = t(kind === "exchange" ? "help.offer.confirmExchange" : "help.offer.confirmReturn");
      pending = ask.isPending;
      run = () => ask.mutate({ reference, orderItemId: offer.lineId, kind, reason, note: null });
      choices = (
        <div className="mt-2 space-y-2">
          {offer.returnKinds.length > 1 ? (
            <div role="group" aria-label={heading} className="inline-flex rounded-full border border-[#d5dfeb] bg-white p-0.5">
              {offer.returnKinds.map(option => (
                <button key={option} type="button" aria-pressed={kind === option} onClick={() => setKind(option)} className={`min-h-10 rounded-full px-3.5 text-[13px] font-bold ${kind === option ? "bg-[#0a285a] text-white" : "text-[#0a285a]"}`}>
                  {t(option === "exchange" ? "help.offer.exchange" : "help.offer.refund")}
                </button>
              ))}
            </div>
          ) : null}
          {offer.reasons.length > 1 ? (
            <label className="block">
              <span className="block text-[12px] font-extrabold ink-muted">{t("help.offer.why")}</span>
              <Select value={reason} onChange={event => setReason(event.target.value as ReturnReason)} className="mt-1 h-11 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] text-[#0a285a]">
                {offer.reasons.map(option => <option key={option} value={option}>{t(REASON_LABEL[option])}</option>)}
              </Select>
            </label>
          ) : null}
        </div>
      );
      break;
    case "cancelOrder":
      heading = t("help.offer.cancelOrder");
      body = t("help.offer.cancelOrderBody");
      confirm = t("help.offer.cancelOrder");
      pending = cancel.isPending;
      run = () => cancel.mutate({ reference });
      break;
    case "cancelItem":
      heading = t("help.offer.cancelItem", { item: title });
      body = quote.data
        ? t("help.offer.cancelItemBody", { owed: quote.data.owedAfter, was: quote.data.owedBefore })
        : quote.error ? tError(quote.error.message) : <LoaderCircle className="size-4 animate-spin" aria-hidden />;
      confirm = t("help.offer.cancelItem", { item: title });
      pending = change.isPending;
      disabled = !quote.data;
      run = () => { if (quote.data) change.mutate({ reference, changes: [{ lineId: offer.lineId, quantity: 0 }], expectOwed: quote.data.owedAfter }); };
      break;
    default:
      heading = t(offer.lineId === null ? "help.offer.buyAgainAll" : "help.offer.buyAgain");
      body = t("help.offer.buyAgainBody");
      confirm = heading;
      pending = again.isPending || adding;
      disabled = offer.lineId !== null && !item?.variantId;
      run = () => {
        if (offer.lineId === null) { again.mutate({ reference, cartId }); return; }
        if (!item?.variantId) return;
        setAdding(true);
        addItem(String(item.variantId), item.quantity, { reveal: false }).then(
          () => { setAdding(false); setOutcome({ tone: "done", text: t("help.result.buyAgain") }); onDone({ act: "buyAgain", lineId }); },
          () => { setAdding(false); failed("orders.buyAgainNone"); },
        );
      };
  }

  return (
    <section aria-labelledby={`${ids}-act`} className="rounded-xl border border-[#d5dfeb] bg-white p-3">
      {/* Named by its heading, but a paragraph: the card is drawn under an h2
          on /help and an h4 on an order, and a fixed level skipped one there. */}
      <p id={`${ids}-act`} dir="auto" className="text-[13px] font-extrabold text-[#0a285a]">{heading}</p>
      <p className="mt-1 text-[12px] leading-5 text-[#404553]">{body}</p>
      {choices}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={run} disabled={pending || disabled} className={NAVY}>
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}{confirm}
        </button>
        <button type="button" onClick={() => setDismissed(true)} className={PILL}>{t("help.offer.notNow")}</button>
      </div>
    </section>
  );
}

/**
 * A person, one press away: the conversation goes to NetLet's own support
 * with the order, the issue, the item and what was already done, so nobody
 * asks the shopper to say it again.
 */
export function PersonCard({ reference, issue, lineId, done, body, emphasis, ready }: {
  reference: string | null;
  issue: HelpIssue | null;
  lineId: number | null;
  done: readonly DoneAct[];
  /** The shopper's own words and what NetLet AI said, or the issue's name. */
  body: () => string;
  /** A person is the next step, not only there if this did not help. */
  emphasis: boolean;
  ready: boolean;
}) {
  const { t, tError } = useTranslation();
  const [sent, setSent] = useState(false);
  const open = trpc.support.open.useMutation({
    onSuccess: () => { setSent(true); toast.success(t("orderHelp.sentToPerson")); },
    onError: error => toast.error(tError(error.message)),
  });
  if (sent) {
    return (
      <p role="status" className="rounded-xl bg-[#e9f4ee] px-3.5 py-2.5 text-[13px] leading-5 text-[#1f5e3a]">
        {t("orderHelp.personWill")} <Link href="/account/help" className="font-bold underline underline-offset-2">{t("orderHelp.followThere")}</Link>
      </p>
    );
  }
  return (
    <div className={`rounded-xl px-3.5 py-3 ${emphasis ? "bg-[#fdf1d6]" : "bg-[#f4f6fa]"}`}>
      <p className="text-[12px] leading-5 text-[#1f2a44]">{t(emphasis ? "orderHelp.personNext" : "orderHelp.personAlways")}</p>
      <button
        type="button"
        disabled={open.isPending || !ready}
        onClick={() => open.mutate({
          topic: topicFor(issue),
          orderReference: reference,
          body: body().slice(0, 1800),
          handover: issue || done.length || lineId !== null ? { issue, lineId, done: [...done] } : null,
        })}
        className={`${NAVY} mt-2`}
      >
        {open.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <UserRound className="size-4" aria-hidden />}
        {t("orderHelp.toPerson")}
      </button>
    </div>
  );
}
