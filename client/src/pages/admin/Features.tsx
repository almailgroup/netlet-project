/**
 * The feature switchboard (2.3): every advanced feature, on or off for the
 * whole shop.
 *
 * Each row says what turning it off actually does, in the words a shopper or
 * a seller would notice — "price requests stop; prices already agreed are
 * still honoured" — because the useful question before pressing a switch is
 * what breaks, and "Price offers: on" does not answer it. Turning one off asks
 * first; turning one back on does not, since that only restores what the shop
 * had before.
 *
 * A switch is `role="switch"` with `aria-checked`, so a screen reader says
 * "on" or "off" rather than "button".
 */
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import type { FeatureKey } from "@shared/features";
import type { MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";

const NAME: Record<FeatureKey, MessageKey> = {
  ai: "features.ai",
  assistant: "features.assistant",
  recommendations: "features.recommendations",
  boughtTogether: "features.boughtTogether",
  chat: "features.chat",
  priceOffers: "features.priceOffers",
  returns: "features.returns",
  deliveryRatings: "features.deliveryRatings",
  damageClaims: "features.damageClaims",
  wishlists: "features.wishlists",
  giftCards: "features.giftCards",
  affiliates: "features.affiliates",
};

const WHEN_OFF: Record<FeatureKey, MessageKey> = {
  ai: "features.aiOff",
  assistant: "features.assistantOff",
  recommendations: "features.recommendationsOff",
  boughtTogether: "features.boughtTogetherOff",
  chat: "features.chatOff",
  priceOffers: "features.priceOffersOff",
  returns: "features.returnsOff",
  deliveryRatings: "features.deliveryRatingsOff",
  damageClaims: "features.damageClaimsOff",
  wishlists: "features.wishlistsOff",
  giftCards: "features.giftCardsOff",
  affiliates: "features.affiliatesOff",
};

export default function AdminFeatures() {
  usePageMeta(privatePageMeta("Features"));
  return <AdminShell need="platform.configure">{() => <Features />}</AdminShell>;
}

function Features() {
  const { t, tError } = useTranslation();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const list = trpc.features.list.useQuery();
  const [confirming, setConfirming] = useState<FeatureKey | null>(null);

  const set = trpc.features.set.useMutation({
    onSuccess: (_reply, input) => {
      setConfirming(null);
      toast.success(t(input.enabled ? "features.turnedOn" : "features.turnedOff", { name: t(NAME[input.key]) }));
      void utils.features.list.invalidate();
      void utils.features.states.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
  });

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("admin.features")}</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("features.note")}</p>

      <QueryGate queries={[list]}>
        {() => (
          <ul className="mt-5 divide-y divide-[#e6e9ef] rounded-2xl border border-[#e6e9ef] bg-white">
            {(list.data ?? []).map(row => {
              const key = row.key as FeatureKey;
              const labelId = `feature-${key}`;
              return (
                <li key={key} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 p-4">
                  <div className="min-w-0 flex-1 basis-[260px]">
                    <p id={labelId} className="text-sm font-extrabold">{t(NAME[key])}</p>
                    <p className="mt-1 text-[12px] leading-5 text-[#536b8c]">{t(WHEN_OFF[key])}</p>
                    {row.updatedAt ? (
                      <p className="mt-1 text-[11px] text-[#536b8c]">
                        {t("features.changedBy", { date: formatDate(row.updatedAt) })}{" "}
                        {row.updatedByEmail ? <bdi dir="ltr">{row.updatedByEmail}</bdi> : t("features.someone")}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={row.enabled}
                    aria-labelledby={labelId}
                    disabled={set.isPending}
                    onClick={() => (row.enabled ? setConfirming(key) : set.mutate({ key, enabled: true }))}
                    className={`pressable inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-extrabold disabled:opacity-60 ${row.enabled ? "bg-[#0a285a] text-white" : "bg-[#eef1f6] text-[#536b8c]"}`}
                  >
                    <span aria-hidden className={`relative h-4 w-7 rounded-full ${row.enabled ? "bg-white/30" : "bg-[#c3ccda]"}`}>
                      <span className={`absolute top-0.5 size-3 rounded-full bg-white transition-[inset-inline-start] ${row.enabled ? "start-3.5" : "start-0.5"}`} />
                    </span>
                    {t(row.enabled ? "features.stateOn" : "features.stateOff")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </QueryGate>

      <ConfirmDialog
        open={confirming !== null}
        title={confirming ? t("features.confirmTitle", { name: t(NAME[confirming]) }) : ""}
        body={confirming ? t(WHEN_OFF[confirming]) : ""}
        confirmLabel={t("features.turnOff")}
        tone="danger"
        pending={set.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => confirming && set.mutate({ key: confirming, enabled: false })}
      />
    </>
  );
}
