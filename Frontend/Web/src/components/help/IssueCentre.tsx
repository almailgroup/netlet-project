/**
 * The top of `/help`: what happened, answered from the shopper's own order
 * before anybody is asked (on the owner's word: "self-service options for
 * common issues … support should be the last resort, but easily accessible").
 *
 * Choose the issue, then the order and the item where it is about one; the
 * answer is `support.selfHelp`, the opened order's own, with its acts done on
 * Confirm right here. A panel that needs words or photos — a warranty claim,
 * another address — opens the order on it. A person is one press away under
 * every answer, handed the issue, the item and what was done.
 *
 * Signed out there is no order to read, so the issues are drawn and a press
 * asks to sign in, coming back here.
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { LoaderCircle, PackageSearch } from "lucide-react";
import { Thumb } from "@/components/product/Thumb";
import { HelpAnswer, ISSUE_ICON, ItemPicker, PersonCard, type DoneAct } from "@/components/help/SelfHelp";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { HELP_ISSUES, issueNeeds, type HelpIssue, type HelpPanel } from "@shared/commerce/selfService";

export function IssueCentre({ className }: { className: string }) {
  const { t, tError, locale } = useTranslation();
  const formatDate = useDateFormat();
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [issue, setIssue] = useState<HelpIssue | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [lineId, setLineId] = useState<number | null>(null);
  const [done, setDone] = useState<DoneAct[]>([]);

  const aboutOrder = issue !== null && issueNeeds(issue) !== "nothing";
  const orders = trpc.orders.list.useQuery({ page: 1, pageSize: 10 }, { enabled: isAuthenticated && aboutOrder && !reference });
  const ready = isAuthenticated && issue !== null && (!aboutOrder || reference !== null);
  const answer = trpc.support.selfHelp.useQuery(
    { issue: issue ?? "account", reference, lineId, locale },
    { enabled: ready, staleTime: Infinity, refetchOnWindowFocus: false },
  );
  const pickingItem = answer.data?.say[0]?.key === "help.pickItem" && answer.data.items.length > 0;

  const choose = (next: HelpIssue | null) => { setIssue(next); setReference(null); setLineId(null); setDone([]); };
  /* A panel opens the order on it, where the words and photos it needs are asked for. */
  const open = (panel: HelpPanel) => {
    if (!reference) return;
    const extra = panel === "track" ? "&track=1" : panel === "refund" ? "&refund=1" : "";
    navigate(`/account/orders?order=${encodeURIComponent(reference)}${extra}`);
  };

  return (
    <section aria-labelledby="issues-title" className={className}>
      <h2 id="issues-title" className="text-lg font-extrabold">{t("help.issuesTitle")}</h2>
      <p className="mt-1 text-[14px] leading-6 text-[#404553]">{t("help.issuesIntro")}</p>

      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {HELP_ISSUES.map(each => {
          const Icon = ISSUE_ICON[each];
          const chosen = issue === each;
          return (
            <li key={each} className="min-w-0">
              <button
                type="button"
                aria-pressed={chosen}
                onClick={() => choose(chosen ? null : each)}
                className={`flex h-full min-h-[76px] w-full flex-col items-start gap-2 rounded-2xl border px-3 py-3 text-start ${chosen ? "border-[#0a285a] bg-[#eef2f8]" : "border-[#e3e6ec] bg-white hover:bg-[#f0f2f5]"}`}
              >
                <span className="grid size-9 place-items-center rounded-xl bg-[#eef2f8] text-[#0a285a]"><Icon className="size-[18px]" aria-hidden /></span>
                <span className="text-[13px] font-bold leading-5 text-[#0a285a]">{t(`help.issue.${each}`)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {issue !== null && !isAuthenticated ? (
        <div className="mt-4 rounded-2xl bg-[#f4f6fa] p-4">
          <p className="text-[13px] leading-6 text-[#1f2a44]">{t("help.signInForOrders")}</p>
          <Link href={`/signin?next=${encodeURIComponent("/help")}`} className="glass-navy type-control pressable mt-2 inline-flex min-h-11 items-center rounded-full px-4 py-2 pointer-fine:min-h-9">
            {t("header.signIn")}
          </Link>
        </div>
      ) : null}

      {isAuthenticated && aboutOrder && !reference ? (
        <fieldset className="mt-4">
          <legend className="text-[13px] font-extrabold text-[#0a285a]">{t("help.chooseOrder")}</legend>
          {orders.isLoading ? <LoaderCircle className="mt-2 size-4 animate-spin" aria-hidden /> : null}
          {orders.data && orders.data.rows.length === 0 ? <p className="mt-2 text-[13px] ink-muted">{t("help.noOrders")}</p> : null}
          <ul className="mt-2 space-y-2">
            {(orders.data?.rows ?? []).map(row => (
              <li key={row.reference}>
                <button type="button" onClick={() => setReference(row.reference)} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-[#e7edf5] bg-white px-3 py-2 text-start hover:bg-[#f0f2f5]">
                  <Thumb src={row.summary?.photos[0] ?? null} alt="" className="size-10 shrink-0 rounded-lg border border-[#e7edf5] bg-white object-contain" icon={<PackageSearch className="size-4" />} />
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="block truncate text-[13px] font-bold text-[#0a285a]">{row.summary?.first?.title ?? row.reference}</span>
                    <span className="block truncate text-[12px] ink-muted"><bdi dir="ltr">{row.reference}</bdi> · {formatDate(row.placedAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      {ready ? (
        <div className="mt-4 space-y-3">
          {answer.isLoading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          {answer.error ? <p role="alert" className="text-[13px] font-semibold text-[#8c2f22]">{tError(answer.error.message)}</p> : null}
          {pickingItem && answer.data ? <ItemPicker items={answer.data.items} onPick={setLineId} /> : null}
          {answer.data && !pickingItem ? (
            <HelpAnswer reference={reference} answer={answer.data} items={answer.data.items} onOpen={open} onDone={act => setDone(current => [...current, act])} />
          ) : null}
          {answer.data && !pickingItem ? (
            <PersonCard
              reference={reference}
              issue={issue}
              lineId={lineId}
              done={done}
              body={() => t(`help.issue.${issue!}`)}
              emphasis={answer.data.person === "next"}
              ready
            />
          ) : null}
          {aboutOrder ? (
            <button type="button" onClick={() => { setReference(null); setLineId(null); setDone([]); }} className="text-[12px] font-bold text-[#0a285a] underline underline-offset-2">
              {t("help.otherOrder")}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
