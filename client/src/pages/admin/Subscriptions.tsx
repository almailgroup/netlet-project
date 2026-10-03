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
      <h1 className="text-xl font-extrabold">{t("subscriptions.adminTitle")}</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("subscriptions.adminNote")}</p>
      <QueryGate queries={[overview]}>
        {() => {
          const data = overview.data!;
          return (
            <>
              <p className={`mt-4 max-w-2xl rounded-xl px-4 py-3 text-[13px] font-bold ${data.scheduled ? "bg-[#e6f2e7] text-[#2f5d33]" : "bg-[#fbf3ef] text-[#8c2f22]"}`}>
                {t(data.scheduled ? "subscriptions.scheduled" : "subscriptions.notScheduled")}
              </p>
              <dl className="mt-4 grid max-w-2xl grid-cols-3 gap-3 text-[#0a285a]">
                {([["active", data.active], ["paused", data.paused], ["due", data.due]] as const).map(([key, value]) => (
                  <div key={key} className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
                    <dt className="text-[11px] font-extrabold ink-muted">{t(key === "active" ? "subscriptions.countActive" : key === "paused" ? "subscriptions.countPaused" : "subscriptions.countDue")}</dt>
                    <dd className="mt-1 text-2xl font-extrabold"><bdi dir="ltr">{value}</bdi></dd>
                  </div>
                ))}
              </dl>
              <button type="button" onClick={() => run.mutate()} disabled={run.isPending} className="glass-navy pressable type-control mt-5 rounded-full px-5 py-2 disabled:opacity-60">
                {t("subscriptions.runNow")}
              </button>
            </>
          );
        }}
      </QueryGate>
    </>
  );
}
