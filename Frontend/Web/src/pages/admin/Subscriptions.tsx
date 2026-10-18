/**
 * Standing orders, from NetLet's side (3.1.19).
 *
 * Counts and one button. The scheduler is what normally runs due orders —
 * Vercel Cron, daily, with `CRON_SECRET` — and this page says whether one is
 * configured at all, because a shop whose standing orders silently never run
 * looks exactly like one where nobody subscribed. "Run due now" is for a
 * deployment with no scheduler, or for checking one; pressing it twice is
 * harmless, since each run is claimed before it is placed.
 */
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, Notice, PageHeader, Stat, StatGrid } from "@/components/admin/ui";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { privatePageMeta } from "@shared/seo";

export default function AdminSubscriptions() {
  usePageMeta(privatePageMeta("Subscriptions"));
  return <AdminShell need="platform.configure">{() => <Overview />}</AdminShell>;
}

function Overview() {
  const { t, tError } = useTranslation();
  const overview = trpc.subscriptions.overview.useQuery();
  const utils = trpc.useUtils();
  const run = trpc.subscriptions.runDue.useMutation({
    onSuccess: summary => {
      toast.success(t("subscriptions.ran", { placed: String(summary.placed), outOfStock: String(summary.outOfStock), paused: String(summary.paused) }));
      void utils.subscriptions.overview.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
  });

  return (
    <>
      <PageHeader
        title={t("subscriptions.adminTitle")}
        description={t("subscriptions.adminNote")}
        actions={
          <button type="button" onClick={() => run.mutate()} disabled={run.isPending || !overview.data} className={buttonClass.primary}>
            {t("subscriptions.runNow")}
          </button>
        }
      />
      <QueryGate queries={[overview]}>
        {() => {
          const data = overview.data!;
          return (
            <div className="max-w-3xl space-y-5">
              <Notice tone={data.scheduled ? "success" : "warning"}>
                {t(data.scheduled ? "subscriptions.scheduled" : "subscriptions.notScheduled")}
              </Notice>
              <StatGrid className="sm:grid-cols-3 lg:grid-cols-3">
                <Stat label={t("subscriptions.countActive")} value={<bdi dir="ltr">{data.active}</bdi>} />
                <Stat label={t("subscriptions.countPaused")} value={<bdi dir="ltr">{data.paused}</bdi>} />
                <Stat label={t("subscriptions.countDue")} value={<bdi dir="ltr">{data.due}</bdi>} tone={data.due > 0 ? "warning" : "normal"} />
              </StatGrid>
            </div>
          );
        }}
      </QueryGate>
    </>
  );
}
