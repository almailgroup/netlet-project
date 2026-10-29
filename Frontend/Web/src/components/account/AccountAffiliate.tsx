/**
 * Affiliate marketing on the account page (3.7): join in one press, share
 * products, earn NetLet points on what sells — on the owner's word ("users
 * can enroll for affiliate marketing easily and earn NetLet points").
 *
 * **Joining is the one card a non-member sees**: what the programme is in a
 * sentence, how it works in three steps (share, somebody buys, you earn),
 * what a point is worth, the name shoppers will see — the account's first
 * name, ready to change — and the one condition, saying the links are paid.
 * There is no review to wait for.
 *
 * **A member's page is what they came back for**: how to share, what their
 * links have done (orders, points earned, points still held for returns), the
 * balance and converting it (`PointsWallet`, the points page's own card), the
 * products whose stores pay extra, and the sales one by one. Money from the
 * programme before it paid in points keeps its own small card and payout
 * button, for the few who have some.
 */
import { useState, type ReactNode } from "react";
import { appPath } from "@/lib/basePath";
import { BadgeCheck, Copy, Megaphone, Share2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import { PANEL } from "@/components/account/profileParts";
import { PointsWallet } from "@/components/account/PointsWallet";
import { QueryGate } from "@/components/admin/QueryGate";
import { Pager } from "@/components/admin/Pager";
import { Thumb } from "@/components/product/Thumb";
import { PointsCoin } from "@/components/ui/PointsCoin";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useFeature } from "@/hooks/useFeature";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { formatCount } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { MIN_AFFILIATE_PAYOUT_FILS, suggestedDisplayName } from "@shared/commerce/affiliate";
import { PRODUCT_LINK_DAYS } from "@shared/commerce/referral";
import type { MessageKey } from "@shared/i18n/dictionary";
import { fromFils } from "@shared/money";
import type { AppRouter } from "../../../../../Backend/src/routes";
import type { inferRouterOutputs } from "@trpc/server";

type Dashboard = NonNullable<inferRouterOutputs<AppRouter>["affiliates"]["mine"]>;

const EARLIER_REASON: Record<string, MessageKey> = {
  affiliate_commission: "affiliate.reasonCommission",
  affiliate_reversal: "affiliate.reasonReversal",
  cashed_out: "affiliate.reasonPayout",
};

export function AccountAffiliate() {
  const { t } = useTranslation();
  const mine = trpc.affiliates.mine.useQuery();
  const on = useFeature("affiliates");

  return (
    <QueryGate audience="shopper" queries={[mine]}>
      {() => (mine.data ? <MemberPage view={mine.data} /> : on ? <Join /> : <p className={`${PANEL} p-5 text-sm ink-muted`}>{t("affiliate.switchedOff")}</p>)}
    </QueryGate>
  );
}

/** How it works, in three steps — the join card's and nothing else's. */
function Steps() {
  const { t } = useTranslation();
  const steps: { icon: ReactNode; title: MessageKey; body: MessageKey }[] = [
    { icon: <Share2 className="size-5" />, title: "affiliate.step1Title", body: "affiliate.step1" },
    { icon: <ShoppingBag className="size-5" />, title: "affiliate.step2Title", body: "affiliate.step2" },
    { icon: <PointsCoin size={24} />, title: "affiliate.step3Title", body: "affiliate.step3" },
  ];
  return (
    <ol className="mt-5 grid gap-3 sm:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.title} className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
          <span className="flex items-center gap-2.5">
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-[#eef2f8] text-[#0a285a]">{step.icon}</span>
            <span className="text-[12px] font-bold ink-muted">{t("affiliate.stepNumber", { number: index + 1 })}</span>
          </span>
          <span className="mt-2.5 block text-[15px] font-bold text-[#0a285a]">{t(step.title)}</span>
          <span className="mt-1 block text-[13px] leading-5 text-[#536b8c]">{t(step.body, { days: PRODUCT_LINK_DAYS })}</span>
        </li>
      ))}
    </ol>
  );
}

function Join() {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [displayName, setDisplayName] = useState(() => suggestedDisplayName(user?.name) ?? "");
  const [agreed, setAgreed] = useState(false);
  const [refused, setRefused] = useState(false);
  const join = trpc.affiliates.join.useMutation({
    onSuccess: () => {
      toast.success(t("affiliate.joined"));
      void utils.affiliates.mine.invalidate();
      void utils.rewards.mine.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
  });

  return (
    <div className="space-y-3">
      <section aria-labelledby="affiliate-join" className="overflow-hidden rounded-[1.35rem] border border-[#e6e9ef] bg-[#f3f2ed] p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <PointsCoin size={52} />
          <div className="min-w-0">
            <h3 id="affiliate-join" className="text-[20px] font-extrabold leading-tight text-[#0a285a]">{t("affiliate.title")}</h3>
            <p className="mt-1.5 max-w-prose text-[14px] leading-6 text-[#3b4a63]">{t("affiliate.pitch")}</p>
          </div>
        </div>
        <Steps />
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-[#0a285a]">
          <BadgeCheck className="size-4 shrink-0 text-[#2f5d33]" aria-hidden />
          {t("affiliate.free")} · {t("rewards.pointValue", { value: money({ amount: "1.000", currencyCode: "KWD" }) })}
        </p>
      </section>

      <form
        className={`${PANEL} space-y-4 p-5 sm:p-6`}
        onSubmit={event => {
          event.preventDefault();
          if (!agreed) { setRefused(true); return; }
          join.mutate({ displayName: displayName.trim() || null, acceptDisclosure: true });
        }}
      >
        <label className="block">
          <span className="block text-[13px] font-bold text-[#0a285a]">{t("affiliate.displayName")}</span>
          <input
            value={displayName}
            onChange={event => setDisplayName(event.target.value)}
            maxLength={80}
            required
            autoComplete="given-name"
            dir="auto"
            aria-describedby="affiliate-name-hint"
            className="glass-field mt-1.5 h-11 w-full rounded-xl px-4 text-[15px]"
          />
          <span id="affiliate-name-hint" className="mt-1.5 block text-[12px] leading-5 ink-muted">{t("affiliate.displayNameHint")}</span>
        </label>
        <div>
          <label className="flex items-start gap-2.5 text-[14px] leading-6 text-[#1f2a44]">
            <input
              type="checkbox"
              checked={agreed}
              onChange={event => { setAgreed(event.target.checked); setRefused(false); }}
              aria-invalid={refused || undefined}
              aria-describedby={refused ? "affiliate-agree-error" : undefined}
              className="mt-1 size-[18px] shrink-0 accent-[#0a285a]"
            />
            {t("affiliate.disclosure")}
          </label>
          {refused ? <p id="affiliate-agree-error" className="mt-1.5 text-[13px] font-semibold text-[#b3261e]">{t("affiliate.disclosureRequired")}</p> : null}
        </div>
        <button
          type="submit"
          disabled={!displayName.trim() || join.isPending}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#0a285a] px-6 text-[15px] font-bold text-white hover:bg-[#0d3372] disabled:opacity-60 sm:w-auto"
        >
          <Megaphone className="size-4" aria-hidden />
          {join.isPending ? t("affiliate.joining") : t("affiliate.joinNow")}
        </button>
      </form>
    </div>
  );
}

function MemberPage({ view }: { view: Dashboard }) {
  const { t, locale } = useTranslation();
  const formatDate = useDateFormat();
  const rewards = trpc.rewards.mine.useQuery();
  const active = view.status === "active";

  const stats: [MessageKey, string, boolean][] = [
    ["affiliate.paidOrders", formatCount(view.paidOrders, locale), false],
    ["affiliate.waitingOrders", formatCount(view.waitingOrders, locale), false],
    ["affiliate.pointsEarned", formatCount(view.earnedPoints - view.reversedPoints, locale), true],
    ["affiliate.pointsHeld", formatCount(view.heldPoints, locale), true],
  ];

  return (
    <div className="space-y-3">
      <section aria-labelledby="affiliate-status" className={`${PANEL} p-5 sm:p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="affiliate-status" className="flex items-center gap-2 text-[17px] font-extrabold text-[#0a285a]">
            <Megaphone className="size-5 shrink-0 ink-accent" aria-hidden />{t("affiliate.section")}
          </h3>
          <span className={`rounded-full px-3 py-1 text-[12px] font-extrabold ${active ? "bg-[#e7f2e8] text-[#2f5d33]" : "bg-[#fdecea] text-[#b3261e]"}`}>
            {t(active ? "affiliate.statusActive" : "affiliate.statusSuspended")}
          </span>
        </div>
        <p className="mt-1 text-[13px] ink-muted">
          {t("affiliate.memberSince", { date: formatDate(view.joinedAt) })} · {t("affiliate.shownAs", { name: view.displayName })}
        </p>
        {active ? (
          <>
            <p className="mt-3 max-w-prose text-[14px] leading-6 text-[#3b4a63]">{t("affiliate.howToShare", { days: PRODUCT_LINK_DAYS })}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-[12px] font-semibold ink-muted">{t("affiliate.yourCode")}</span>
              <bdi dir="ltr" className="rounded-xl bg-[#f3f2ed] px-4 py-2 font-mono text-lg font-bold tracking-[.2em] text-[#0a285a]">{view.code}</bdi>
              <Link href="/category/all" className="glass type-control pressable inline-flex items-center gap-2 rounded-full px-4 py-2">
                <Share2 className="size-4" aria-hidden />{t("affiliate.findProducts")}
              </Link>
            </div>
          </>
        ) : (
          <p className="mt-3 text-[14px] leading-6 text-[#3b4a63]">{t("affiliate.suspendedNote")}</p>
        )}
      </section>

      <dl className="grid grid-cols-2 gap-3">
        {stats.map(([label, value, coin]) => (
          <div key={label} className={`${PANEL} p-4`}>
            <dt className="text-[12px] font-bold ink-muted">{t(label)}</dt>
            <dd className="mt-1 flex items-center gap-1.5 text-[20px] font-extrabold text-[#0a285a]">
              {coin ? <PointsCoin size={20} /> : null}<bdi>{value}</bdi>
            </dd>
          </div>
        ))}
      </dl>

      {rewards.data ? <PointsWallet view={rewards.data} /> : null}

      {active ? <ProductsPayingExtra code={view.code} /> : null}

      <section aria-labelledby="affiliate-sales" className={`${PANEL} p-4 sm:p-5`}>
        <h3 id="affiliate-sales" className="text-[15px] font-bold text-[#0a285a]">{t("affiliate.salesTitle")}</h3>
        {view.sales.length === 0 ? (
          <p className="mt-2 text-[14px] leading-6 ink-muted">{t("affiliate.salesEmpty")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-dashed divide-[#e3e6ec]">
            {view.sales.map(sale => (
              <li key={sale.id} className="flex items-start gap-3 py-3">
                <PointsCoin size={22} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-[14px] font-semibold text-[#1f2a44]">
                    {sale.productTitle ?? t(sale.reversed ? "rewards.reasonProductReferralReversal" : "rewards.reasonProductReferral")}
                  </span>
                  <span className="block text-[12px] leading-5 ink-muted">
                    {sale.reversed ? <>{t("affiliate.saleReturned")} · </> : null}
                    {formatDate(sale.createdAt)}
                    {sale.orderReference ? <> · <bdi dir="ltr">{sale.orderReference}</bdi></> : null}
                    {sale.availableAt ? <> · {t("rewards.availableFrom", { date: formatDate(sale.availableAt) })}</> : null}
                  </span>
                </span>
                <span className={`shrink-0 text-[15px] font-extrabold ${sale.points < 0 ? "text-[#536b8c]" : "text-[#2f5d33]"}`}>
                  <bdi dir="ltr">{sale.points > 0 ? "+" : "−"}{formatCount(Math.abs(sale.points), locale)}</bdi>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {view.earlier ? <EarlierEarnings earlier={view.earlier} /> : null}
    </div>
  );
}

/**
 * The products whose stores pay a share of the sale on top (3.7.1), each with
 * a link carrying this member's code. Highest rate first; a page at a time,
 * because a shop can offer hundreds.
 */
function ProductsPayingExtra({ code }: { code: string }) {
  const { t, isArabic } = useTranslation();
  const money = useMoney();
  const [page, setPage] = useState(1);
  const offered = trpc.affiliates.products.useQuery({ page }, { placeholderData: previous => previous });
  const copy = async (handle: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${appPath(`/products/${encodeURIComponent(handle)}`)}?ref=${code}`);
      toast.success(t("affiliate.copied"));
    } catch {
      toast.error(t("affiliate.copyFailed"));
    }
  };

  return (
    <section aria-labelledby="affiliate-products" className={`${PANEL} p-4 sm:p-5`}>
      <h3 id="affiliate-products" className="text-[15px] font-bold text-[#0a285a]">{t("affiliate.productsTitle")}</h3>
      <p className="mt-0.5 text-[13px] leading-5 ink-muted">{t("affiliate.productsNote")}</p>
      <QueryGate audience="shopper" queries={[offered]}>
        {() => {
          const result = offered.data;
          if (!result || result.rows.length === 0) return <p className="mt-3 text-[14px] leading-6 ink-muted">{t("affiliate.productsEmpty")}</p>;
          return (
            <>
              <ul className="mt-2 divide-y divide-dashed divide-[#e3e6ec]">
                {result.rows.map(row => (
                  <li key={row.productId} className="flex items-center gap-3 py-3">
                    <Thumb src={row.image} alt="" className="size-12 shrink-0 rounded-lg border border-[#eef1f6] object-cover" />
                    <div className="min-w-0 flex-1">
                      <a href={`/products/${encodeURIComponent(row.handle)}`} dir="auto" className="line-clamp-2 text-[14px] font-bold text-[#0a285a] hover:underline">
                        {isArabic && row.titleAr ? row.titleAr : row.title}
                      </a>
                      <p className="text-[12px] text-[#536b8c]">
                        <bdi>{row.vendorName}</bdi> · {money({ amount: row.price, currencyCode: "KWD" })} ·{" "}
                        <span className="font-bold text-[#2f5d33]">{t("affiliate.productRate", { rate: row.percent })}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copy(row.handle)}
                      aria-label={`${t("affiliate.copyProductLink")}: ${isArabic && row.titleAr ? row.titleAr : row.title}`}
                      className="glass type-control pressable inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2"
                    >
                      <Copy className="size-4" aria-hidden /><span className="hidden min-[400px]:inline">{t("affiliate.copyProductLink")}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <Pager page={result} onPage={setPage} />
            </>
          );
        }}
      </QueryGate>
    </section>
  );
}

/** Money from the programme before it paid in points, and its payout. */
function EarlierEarnings({ earlier }: { earlier: NonNullable<Dashboard["earlier"]> }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });
  const payout = trpc.affiliates.payout.useMutation({
    onSuccess: reply => { toast.success(t("affiliate.payoutRequested", { amount: amount(reply.amount) })); void utils.affiliates.mine.invalidate(); },
    onError: error => toast.error(tError(error.message)),
  });

  return (
    <section aria-labelledby="affiliate-earlier" className={`${PANEL} p-4 sm:p-5`}>
      <h3 id="affiliate-earlier" className="text-[15px] font-bold text-[#0a285a]">{t("affiliate.earlierTitle")}</h3>
      <p className="mt-0.5 text-[13px] leading-5 ink-muted">{t("affiliate.earlierNote", { amount: amount(earlier.balance) })}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!earlier.payout.ok || payout.isPending}
          onClick={() => payout.mutate()}
          className="glass-navy type-control pressable rounded-full px-5 py-2 disabled:opacity-60"
        >
          {t("affiliate.requestPayout")}
        </button>
        <p className="text-[12px] ink-muted">
          {earlier.payout.ok
            ? t("affiliate.payoutNote")
            : t("affiliate.payoutShort", { minimum: amount(fromFils(MIN_AFFILIATE_PAYOUT_FILS)), short: amount(earlier.payout.shortBy) })}
        </p>
      </div>
      <ul className="mt-3 divide-y divide-dashed divide-[#e3e6ec]">
        {earlier.entries.map(entry => (
          <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-[13px]">
            <span className="text-[#1f2a44]">
              {t(EARLIER_REASON[entry.reason] ?? "affiliate.reasonCommission")}
              {entry.orderReference ? <> · <bdi dir="ltr">{entry.orderReference}</bdi></> : null}
              {entry.reason === "cashed_out" ? <span className="ink-muted"> · {t(entry.settledAt ? "affiliate.paid" : "affiliate.notYetPaid")}</span> : null}
            </span>
            <span className="font-bold text-[#0a285a]"><bdi dir="ltr">{amount(entry.amount)}</bdi> <span className="font-normal ink-muted">{formatDate(entry.createdAt)}</span></span>
          </li>
        ))}
      </ul>
    </section>
  );
}
