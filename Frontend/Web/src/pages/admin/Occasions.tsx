/**
 * NetLet's occasions desk — on the owner's word ("a way for you to curate an
 * occasion by hand in the admin portal: your own banner picture, your own
 * dates, and products you pick").
 *
 * Two lists. **Your occasions** are the ones NetLet wrote, each with where it
 * stands today and whether it has enough to be drawn. **The calendar's** are
 * the ten in code (`Shared/commerce/occasions.ts`), which come round by
 * themselves from the stores' tags: each says whether it is in season, how
 * many products are tagged for it, and what stands over it — nothing, a draft
 * of NetLet's, NetLet's own published in its place, or switched off.
 *
 * The desk is `platform.configure`, the switchboard's: an occasion is NetLet's
 * own front page. Hiding asks first, since it takes a section off the home
 * page; everything else here is a link to the editor.
 */
import { useState } from "react";
import { CalendarDays, EyeOff, Plus } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, EmptyState, Notice, PageHeader, Pill, SectionHeading, smallButtonClass, surfaceClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MAX_OCCASIONS, MIN_SHELF_PRODUCTS } from "@/content/homeLayout";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { occasionName, type OccasionSeason, type OccasionStatus } from "@shared/commerce/occasionDesk";
import { occasionFromSlug } from "@shared/commerce/occasions";
import type { MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";

export default function AdminOccasions() {
  usePageMeta(privatePageMeta("Occasions"));
  return <AdminShell need="platform.configure">{() => <Desk />}</AdminShell>;
}

export const STATUS_LABEL: Record<OccasionStatus, MessageKey> = {
  draft: "occasions.status.draft",
  published: "occasions.status.published",
  hidden: "occasions.status.hidden",
};
export const STATUS_TONE: Record<OccasionStatus, "neutral" | "good" | "warning"> = { draft: "neutral", published: "good", hidden: "warning" };

/** Where an occasion stands today, as a pill: running, still to come, over, or out of the calendar's season. */
export function SeasonPill({ season, startsOn, endsOn }: { season: OccasionSeason; startsOn: string | null; endsOn: string | null }) {
  const { t } = useTranslation();
  const formatDate = useDateFormat();
  if (season.state === "on") return <Pill tone="good">{t("occasions.seasonOn")}</Pill>;
  if (season.state === "upcoming" && startsOn) return <Pill tone="navy">{t("occasions.seasonUpcoming", { date: formatDate(startsOn) })}</Pill>;
  if (season.state === "ended" && endsOn) return <Pill>{t("occasions.seasonEnded", { date: formatDate(endsOn) })}</Pill>;
  return <Pill>{t("occasions.seasonOut")}</Pill>;
}

function Desk() {
  const { t, isArabic, tError } = useTranslation();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const desk = trpc.occasions.list.useQuery();
  /** The calendar occasion being hidden, by its address. */
  const [hiding, setHiding] = useState<string | null>(null);

  const refresh = () => utils.occasions.list.invalidate();
  const hide = trpc.occasions.hide.useMutation({
    onSuccess: () => { toast.success(t("occasions.hiddenToast")); setHiding(null); void refresh(); },
    onError: error => toast.error(tError(error.message)),
  });
  const show = trpc.occasions.setStatus.useMutation({
    onSuccess: () => { toast.success(t("occasions.shownAgain")); void refresh(); },
    onError: error => toast.error(tError(error.message)),
  });

  const add = <Link href="/admin/occasions/new" className={buttonClass.primary}><Plus className="size-4" aria-hidden />{t("occasions.new")}</Link>;
  const hidingName = hiding ? t(occasionFromSlug(hiding)?.label ?? "occasions.title") : "";

  return (
    <>
      <PageHeader title={t("occasions.title")} description={t("occasions.note")} actions={add} />
      <QueryGate queries={[desk]}>
        {() => {
          const data = desk.data!;
          if (!data.ready) return <Notice tone="warning">{t("occasions.unavailable")}</Notice>;
          /* A calendar occasion switched off is in the calendar's list alone. */
          const mine = data.rows.filter(row => row.status !== "hidden");
          return (
            <div className="grid gap-8">
              <Notice>{t("occasions.capNote", { most: MAX_OCCASIONS, floor: MIN_SHELF_PRODUCTS })}</Notice>

              <section aria-labelledby="occasions-yours">
                <SectionHeading><span id="occasions-yours">{t("occasions.yours")}</span></SectionHeading>
                {mine.length === 0 ? (
                  <EmptyState title={t("occasions.yoursNone")} action={add} />
                ) : (
                  <ul className="mt-3 grid gap-3">
                    {mine.map(row => {
                      const has = row.live + (row.includeTagged ? row.tagged : 0);
                      const name = occasionName(row, isArabic);
                      return (
                        <li key={row.id} className={`${surfaceClass} flex flex-wrap items-start gap-4 p-4`}>
                          {row.imageUrl ? (
                            <img src={row.imageUrl} alt="" loading="lazy" decoding="async" className="aspect-[3/1] w-36 shrink-0 rounded-xl bg-[#eef2f8] object-cover" />
                          ) : (
                            <span className="grid aspect-[3/1] w-36 shrink-0 place-items-center rounded-xl bg-[#eef2f8] text-[#0a285a]"><CalendarDays className="size-5" aria-hidden /></span>
                          )}
                          <div className="min-w-0 flex-1 basis-56">
                            <p className="flex flex-wrap items-center gap-2">
                              <Link href={`/admin/occasions/${row.id}`} className="text-[15px] font-semibold text-[#0a285a] underline-offset-2 hover:underline"><bdi>{name}</bdi></Link>
                              <Pill tone={STATUS_TONE[row.status]}>{t(STATUS_LABEL[row.status])}</Pill>
                              <SeasonPill season={row.season} startsOn={row.startsOn} endsOn={row.endsOn} />
                            </p>
                            <p className="mt-1 text-[13px] leading-5 ink-muted">
                              {row.startsOn && row.endsOn
                                ? t("occasions.runs", { from: formatDate(row.startsOn), to: formatDate(row.endsOn) })
                                : t("occasions.followsCalendar")}
                              {" · "}
                              {t("occasions.counts", { chosen: row.chosen, tagged: row.includeTagged ? row.tagged : 0 })}
                            </p>
                            {has < MIN_SHELF_PRODUCTS ? (
                              <p className="mt-1 text-[13px] leading-5 font-semibold text-[#6b4f1d]">{t("occasions.needsMore", { have: has, floor: MIN_SHELF_PRODUCTS })}</p>
                            ) : null}
                          </div>
                          <Link href={`/admin/occasions/${row.id}`} aria-label={`${t("occasions.edit")}: ${name}`} className={smallButtonClass.secondary}>{t("occasions.edit")}</Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section aria-labelledby="occasions-calendar">
                <SectionHeading description={t("occasions.calendarNote")}><span id="occasions-calendar">{t("occasions.calendarTitle")}</span></SectionHeading>
                <ul className="mt-3 grid gap-3 md:grid-cols-2">
                  {data.calendar.map(entry => {
                    const occasion = occasionFromSlug(entry.slug);
                    if (!occasion) return null;
                    const name = t(occasion.label);
                    const status = entry.row?.status ?? null;
                    /* Taken over, it runs on NetLet's days, so that is the season to say. */
                    const mineNow = status === "published" ? data.rows.find(row => row.id === entry.row?.id) : undefined;
                    const state: MessageKey = status === "hidden"
                      ? "occasions.switchedOff"
                      : status === "published" ? "occasions.customised" : status === "draft" ? "occasions.customDraft" : "occasions.asBuilt";
                    return (
                      <li key={entry.slug} className={`${surfaceClass} flex flex-wrap items-start gap-3 p-4`}>
                        <div className="min-w-0 flex-1 basis-48">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="text-[15px] font-semibold text-[#0a285a]">{name}</span>
                            {status === "hidden"
                              ? <Pill tone="warning">{t("occasions.status.hidden")}</Pill>
                              : mineNow
                                ? <SeasonPill season={mineNow.season} startsOn={mineNow.startsOn} endsOn={mineNow.endsOn} />
                                : <Pill tone={entry.on ? "good" : "neutral"}>{t(entry.on ? "occasions.seasonOn" : "occasions.seasonOut")}</Pill>}
                          </p>
                          <p className="mt-1 text-[13px] leading-5 ink-muted">{t(state)} · {t("occasions.taggedCount", { count: entry.tagged })}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {entry.row ? (
                            <Link href={`/admin/occasions/${entry.row.id}`} aria-label={`${t("occasions.edit")}: ${name}`} className={smallButtonClass.secondary}>{t("occasions.edit")}</Link>
                          ) : (
                            <Link href={`/admin/occasions/new?from=${entry.slug}`} aria-label={`${t("occasions.customise")}: ${name}`} className={smallButtonClass.secondary}>{t("occasions.customise")}</Link>
                          )}
                          {status === "hidden" && entry.row ? (
                            <button
                              type="button"
                              disabled={show.isPending}
                              onClick={() => show.mutate({ id: entry.row!.id, status: "draft" })}
                              aria-label={`${t("occasions.showAgain")}: ${name}`}
                              className={smallButtonClass.secondary}
                            >
                              {t("occasions.showAgain")}
                            </button>
                          ) : (
                            <button type="button" onClick={() => setHiding(entry.slug)} aria-label={`${t("occasions.hide")}: ${name}`} className={smallButtonClass.quietDanger}>
                              <EyeOff className="size-3.5" aria-hidden />{t("occasions.hide")}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          );
        }}
      </QueryGate>

      <ConfirmDialog
        open={hiding !== null}
        tone="danger"
        title={t("occasions.hideTitle", { name: hidingName })}
        body={t("occasions.hideBody")}
        confirmLabel={t("occasions.hide")}
        pending={hide.isPending}
        onConfirm={() => { if (hiding) hide.mutate({ slug: hiding }); }}
        onClose={() => setHiding(null)}
      />
    </>
  );
}
