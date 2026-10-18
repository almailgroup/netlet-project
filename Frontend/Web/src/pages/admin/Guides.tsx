/**
 * NetLet's guides (3.5.3): every one, drafts included, newest edit first.
 *
 * A guide is NetLet speaking to every shopper or every seller, so the desk is
 * `platform.configure` — the switchboard's — and a store's people never see
 * it. Each row opens the editor; "New guide" opens it empty.
 */
import { useState } from "react";
import { BookOpen, Plus } from "lucide-react";
import { Link } from "wouter";
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, EmptyState, PageHeader, Pill, tableClass } from "@/components/admin/ui";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { privatePageMeta } from "@shared/seo";

export default function AdminGuides() {
  usePageMeta(privatePageMeta("Guides"));
  return <AdminShell need="platform.configure">{() => <List />}</AdminShell>;
}

function List() {
  const { t, isArabic } = useTranslation();
  const formatDate = useDateFormat();
  const [page, setPage] = useState(1);
  const guides = trpc.guides.list.useQuery({ page }, { placeholderData: previous => previous });

  return (
    <>
      <PageHeader
        title={t("guides.adminTitle")}
        description={t("guides.adminIntro")}
        actions={<Link href="/admin/guides/new" className={buttonClass.primary}><Plus className="size-4" aria-hidden />{t("guides.new")}</Link>}
      />
      <QueryGate queries={[guides]}>
        {() => {
          const data = guides.data!;
          if (data.total === 0) {
            return (
              <EmptyState
                title={t("guides.adminEmpty")}
                action={<Link href="/admin/guides/new" className={buttonClass.primary}><Plus className="size-4" aria-hidden />{t("guides.new")}</Link>}
              >
                {t("guides.adminEmptyNote")}
              </EmptyState>
            );
          }
          return (
            <>
              <div className={`${tableClass.wrap} hidden md:block`}>
                <table className={tableClass.table}>
                  <thead className={tableClass.head}>
                    <tr>
                      <th className={tableClass.th}>{t("guides.colTitle")}</th>
                      <th className={tableClass.th}>{t("guides.colFor")}</th>
                      <th className={tableClass.th}>{t("guides.colStatus")}</th>
                      <th className={tableClass.thEnd}>{t("guides.colSteps")}</th>
                      <th className={tableClass.thEnd}>{t("guides.colUpdated")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(guide => (
                      <tr key={guide.id} className={tableClass.row}>
                        <td className={tableClass.td}>
                          <Link href={`/admin/guides/${guide.id}`} className="font-semibold text-[#0a285a] underline-offset-2 hover:underline">
                            <bdi>{(isArabic ? guide.titleAr : guide.title) || guide.title || guide.titleAr || t("guides.untitled")}</bdi>
                          </Link>
                        </td>
                        <td className={tableClass.td}>{t(guide.audience === "seller" ? "guides.forSellers" : "guides.forShoppers")}</td>
                        <td className={tableClass.td}><Pill tone={guide.status === "published" ? "good" : "neutral"}>{t(guide.status === "published" ? "guides.published" : "guides.draft")}</Pill></td>
                        <td className={`${tableClass.td} text-end`}>{guide.steps.length}</td>
                        <td className={`${tableClass.td} text-end whitespace-nowrap`}>{formatDate(guide.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="grid gap-3 md:hidden">
                {data.rows.map(guide => (
                  <li key={guide.id}>
                    <Link href={`/admin/guides/${guide.id}`} className="flex items-start gap-3 rounded-2xl border border-[#e1e7ef] bg-white p-4 hover:bg-[#f0f2f5]">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#eef2f8] text-[#0a285a]"><BookOpen className="size-4" aria-hidden /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-[#0a285a]"><bdi>{(isArabic ? guide.titleAr : guide.title) || guide.title || guide.titleAr || t("guides.untitled")}</bdi></span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-[13px] ink-muted">
                          <Pill tone={guide.status === "published" ? "good" : "neutral"}>{t(guide.status === "published" ? "guides.published" : "guides.draft")}</Pill>
                          {t(guide.audience === "seller" ? "guides.forSellers" : "guides.forShoppers")} · {t("guides.stepCount", { count: guide.steps.length })}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Pager page={data} onPage={setPage} />
            </>
          );
        }}
      </QueryGate>
    </>
  );
}
