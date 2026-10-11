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
import { Card, PageHeader, SkeletonCards } from "@/components/admin/ui";
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
  ads: "features.ads",
  subscriptions: "features.subscriptions",
  fulfilment: "features.fulfilment",
  membership: "features.membership",
  voiceSearch: "features.voiceSearch",
  photoSearch: "features.photoSearch",
  appBanner: "features.appBanner",
  articles: "features.articles",
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
  ads: "features.adsOff",
  subscriptions: "features.subscriptionsOff",
  fulfilment: "features.fulfilmentOff",
  membership: "features.membershipOff",
  voiceSearch: "features.voiceSearchOff",
  photoSearch: "features.photoSearchOff",
  appBanner: "features.appBannerOff",
  articles: "features.articlesOff",
};

/* Twenty switches in one column read as a wall; grouped by what a shopper or
   a seller would notice them as. `Record` so a feature added to the list and
   not to a group is a compile error rather than a switch nobody can find. */
type Group = "search" | "shopping" | "afterSale" | "selling" | "content";
const GROUP_OF: Record<FeatureKey, Group> = {
  ai: "search",
  assistant: "search",
  recommendations: "search",
  boughtTogether: "search",
  voiceSearch: "search",
  photoSearch: "search",
  priceOffers: "shopping",
  wishlists: "shopping",
  giftCards: "shopping",
  subscriptions: "shopping",
  membership: "shopping",
  returns: "afterSale",
  chat: "afterSale",
  deliveryRatings: "afterSale",
  damageClaims: "afterSale",
  ads: "selling",
  affiliates: "selling",
  fulfilment: "selling",
  appBanner: "content",
  articles: "content",
};
const GROUPS: { key: Group; title: MessageKey }[] = [
  { key: "search", title: "features.groupSearch" },
  { key: "shopping", title: "features.groupShopping" },
  { key: "afterSale", title: "features.groupAfterSale" },
  { key: "selling", title: "features.groupSelling" },
  { key: "content", title: "features.groupContent" },
];

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
  const rows = list.data ?? [];
  const on = rows.filter(row => row.enabled).length;

  return (
    <>
      <PageHeader
        title={t("admin.features")}
        description={t("features.note")}
        meta={list.data ? <span className="font-semibold text-[#3d5376]">{t("features.summary", { on: String(on), total: String(rows.length) })}</span> : null}
      />

      {list.isLoading ? (
        <SkeletonCards label={t("admin.loading")} />
      ) : (
        <QueryGate queries={[list]}>
          {() => (
            <div className="space-y-5">
              {GROUPS.map(group => {
                const members = rows.filter(row => GROUP_OF[row.key as FeatureKey] === group.key);
                if (members.length === 0) return null;
                return (
                  <Card key={group.key} title={t(group.title)}>
                    <ul className="-my-3 divide-y divide-[#eef1f5]">
                      {members.map(row => {
                        const key = row.key as FeatureKey;
                        const labelId = `feature-${key}`;
                        return (
                          <li key={key} className="flex items-start justify-between gap-4 py-3.5">
                            <div className="min-w-0 flex-1">
                              <p id={labelId} className="text-[14px] font-bold text-[#0a285a]">{t(NAME[key])}</p>
                              <p className="mt-0.5 text-[13px] leading-5 text-[#536b8c]">{t(WHEN_OFF[key])}</p>
                              {row.updatedAt ? (
                                <p className="mt-1 text-[12px] ink-muted">
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
                              className="inline-flex shrink-0 items-center gap-2.5 rounded-full py-1 text-[13px] font-semibold text-[#0a285a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a285a] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <span className={row.enabled ? "" : "text-[#536b8c]"}>{t(row.enabled ? "features.stateOn" : "features.stateOff")}</span>
                              <span aria-hidden className={`relative h-6 w-11 rounded-full transition-colors ${row.enabled ? "bg-[#0a285a]" : "bg-[#c3ccda]"}`}>
                                <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[inset-inline-start] ${row.enabled ? "start-[22px]" : "start-0.5"}`} />
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </Card>
                );
              })}
            </div>
          )}
        </QueryGate>
      )}

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
