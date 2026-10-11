/**
 * The delivery company's board.
 *
 * Requirements 2.2 and 3.4.2. Of the five parties the specification names, this
 * is the one that had no interface anywhere in NetLet — so `docs/REQUIREMENTS.md`
 * carried the same gap twice, under "easy for all five parties" and under
 * fulfilment.
 *
 * Three things decide what is on the page, and each is a rule rather than a
 * layout choice.
 *
 * **A parcel is one seller's goods going to one door**, so an order can be
 * several parcels and each is collected and handed over on its own. The board is
 * a list of parcels, never of orders: a driver given "order NL-…" would have to
 * work out for themselves which half of it is theirs.
 *
 * **A company sees only its own work.** An unassigned parcel is not theirs to
 * collect, and showing it would invite two companies to race for one box. The
 * server scopes it; this page never filters.
 *
 * **The vehicle is shown, including when it is unknown.** "Nothing measured"
 * is a real answer and is the one that gets a dispatcher to ring the seller
 * rather than send a motorcycle for a sofa.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { EmptyState, fieldClass, PageHeader, Pill, Segmented, SectionHeading, SkeletonRows, smallButtonClass } from "@/components/admin/ui";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { can, type Actor } from "@shared/inventory/permissions";
import { privatePageMeta } from "@shared/seo";
import { courierMoves, type Parcel } from "@shared/commerce/parcels";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ORDER_CEILING_NOTE } from "@/lib/dispatchCeiling";
import { BadgeCheck, PackageCheck, Truck, Warehouse } from "lucide-react";
import { StarRow } from "@/components/product/ProductReviews";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useState } from "react";
import { toast } from "sonner";
import { PinLink } from "@/components/map/PinLink";
import { ShareLocation } from "@/components/admin/ShareLocation";

const VEHICLE_LABEL = {
  bike: "vehicle.bike",
  car: "vehicle.car",
  van: "vehicle.van",
  truck: "vehicle.truck",
} as const satisfies Record<string, MessageKey>;

const TABS = [
  { id: "waiting", label: "dispatch.waiting" },
  { id: "transit", label: "dispatch.transit" },
  { id: "done", label: "dispatch.done" },
] as const satisfies { id: "waiting" | "transit" | "done"; label: MessageKey }[];

export default function AdminDispatch() {
  usePageMeta(privatePageMeta("Dispatch"));
  return <AdminShell need="delivery.view">{actor => <Dispatch actor={actor} />}</AdminShell>;
}

function Dispatch({ actor }: { actor: Actor }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("waiting");

  const board = trpc.dispatch.board.useQuery({ state: tab });
  /* Only somebody who may give work out needs the list of companies, and asking
     for it as a courier is a request the server would refuse. */
  const mayAssign = can(actor, "delivery.assign");
  const companies = trpc.dispatch.couriers.list.useQuery(undefined, { enabled: mayAssign });
  const utils = trpc.useUtils();

  const refresh = () => {
    void utils.dispatch.board.invalidate();
    void utils.dispatch.waiting.invalidate();
  };
  const refused = (error: { message: string }) => toast.error(tError(error.message));

  const move = trpc.dispatch.move.useMutation({
    onSuccess: () => { toast.success(t("dispatch.moved")); refresh(); },
    onError: refused,
  });
  const assign = trpc.dispatch.assign.useMutation({
    onSuccess: () => { toast.success(t("dispatch.assigned")); refresh(); },
    onError: refused,
  });

  /* Which parcel a press is for, so one press does not grey every button on
     the board. */
  const moving = move.isPending ? `${move.variables?.orderId}-${move.variables?.key}` : null;
  const assigning = assign.isPending ? `${assign.variables?.orderId}-${assign.variables?.key}` : null;

  return (
    <>
      <PageHeader title={t("admin.dispatch")} description={t("admin.dispatchNote")} />

      {/* Live tracking (3.4.3) is a driver's own choice, so only a driver sees it. */}
      {actor.kind === "courier" ? <ShareLocation /> : null}

      <Segmented
        label={t("admin.dispatch")}
        className="mb-4 w-fit"
        value={tab}
        onChange={setTab}
        options={TABS.map(entry => ({ value: entry.id, label: t(entry.label) }))}
      />

      {board.isLoading ? (
        <SkeletonRows rows={3} label={t("admin.loading")} />
      ) : (
        <QueryGate queries={[board]}>
          {() => {
            const parcels = board.data?.parcels ?? [];
            if (parcels.length === 0) {
              return <EmptyState title={actor.kind === "courier" ? t("dispatch.noneCourier") : t("dispatch.none")} />;
            }
            return (
              <>
                <ul className="space-y-3">
                  {parcels.map(parcel => {
                    const id = `${parcel.orderId}-${parcel.key}`;
                    const moves = courierMoves(parcel as Parcel);
                    return (
                      <li key={id} className="overflow-hidden rounded-2xl border border-[#e1e7ef] bg-white">
                        <div className="p-4 sm:p-5">
                          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                            <p className="min-w-0 text-[15px] font-bold text-[#0a285a]">
                              <bdi dir="ltr">{parcel.reference}</bdi>
                              <span className="ink-muted"> · </span>
                              <span className="font-semibold">
                                {t("dispatch.parcelOf", {
                                  seller: parcel.vendorName ?? "—",
                                  where: parcel.destination?.label ?? t("dispatch.toOrderAddress"),
                                })}
                              </span>
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              {/* A member's parcel (4.1): first on the board, and said so. */}
                              {parcel.member && parcel.state !== "delivered" ? (
                                <Pill tone="navy"><BadgeCheck className="size-3.5" aria-hidden />{t("membership.priority")}</Pill>
                              ) : null}
                              <Pill>{parcel.items === 1 ? t("dispatch.itemsOne") : t("dispatch.items", { count: parcel.items })}</Pill>
                            </div>
                          </div>

                          {/* Where it actually goes. The parcel's own frozen copy when
                              it has one, and the order's address otherwise — never a
                              guess at which. */}
                          <p className="mt-1.5 text-[14px] leading-6 text-[#3d5376]" dir="auto">
                            {parcel.destination
                              ? [parcel.destination.addressLine, parcel.destination.contactName, parcel.destination.contactPhone]
                                  .filter(Boolean)
                                  .join(" · ")
                              : [parcel.orderAddress.addressLine, parcel.orderAddress.contactName, parcel.orderAddress.contactPhone]
                                  .filter(Boolean)
                                  .join(" · ")}
                          </p>
                          {/* The pin goes with the same door the line above names:
                              the parcel's own when it has one, the order's otherwise. */}
                          <p className="mt-1">
                            <PinLink pin={parcel.destination ? parcel.destination.pin : parcel.orderAddress.pin} />
                          </p>

                          {/* Collected from a NetLet centre rather than the seller (4.2). */}
                          {parcel.collectFrom ? (
                            <p className="mt-2 flex items-start gap-1.5 text-[13px] font-semibold text-[#0a285a]">
                              <Warehouse className="mt-0.5 size-4 shrink-0" aria-hidden />
                              <span>{t("fulfilment.collectFrom")} <bdi>{parcel.collectFrom.name}</bdi> <span className="font-normal ink-muted">· <bdi>{parcel.collectFrom.addressLine}</bdi></span></span>
                            </p>
                          ) : null}
                          <p className="mt-3 flex flex-wrap items-center gap-2">
                            <Pill tone={parcel.vehicle ? "navy" : "warning"}>
                              <Truck className="size-3.5" aria-hidden />
                              {parcel.vehicle ? t("dispatch.vehicle", { vehicle: t(VEHICLE_LABEL[parcel.vehicle]) }) : t("dispatch.vehicleUnknown")}
                            </Pill>
                            {/* Cash is the driver's to collect, and the figure is the
                                whole order's rather than this parcel's: it is one
                                payment however many boxes it arrives in — which is why
                                the line says so. It read "collect KWD 247.500" on both
                                parcels of one order before that, which is an
                                instruction to collect it twice. Recording the cash
                                stays with the seller, who reconciles with the driver. */}
                            {parcel.paymentMethod === "cod" ? (
                              <Pill tone={parcel.paymentCollectedAt ? "good" : "warning"}>
                                {parcel.paymentCollectedAt ? t("dispatch.cashPaid") : t("dispatch.collectCash", { amount: money({ amount: parcel.orderTotal, currencyCode: "KWD" }) })}
                              </Pill>
                            ) : null}
                            {/* Who is carrying it. Drawn only where there is no
                                picker below saying the same thing: for a courier this
                                is the only answer, and for an admin the select is. */}
                            {mayAssign ? null : (
                              <span className="text-[13px] ink-muted">
                                {parcel.courierName ? t("dispatch.assignedTo", { name: parcel.courierName }) : t("dispatch.unassigned")}
                              </span>
                            )}
                          </p>

                          <ul className="mt-3 divide-y divide-[#f0f2f6] rounded-xl border border-[#e1e7ef]">
                            {parcel.lines.map(line => (
                              <li key={line.lineId} className="flex gap-2 px-3.5 py-2 text-[14px] text-[#0a285a]">
                                <bdi dir="ltr" className="shrink-0 font-semibold tabular-nums">{line.quantity} ×</bdi>
                                <span dir="auto" className="min-w-0">{line.productTitle}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {moves.length > 0 || mayAssign ? (
                          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#eef1f5] bg-[#fafbfd] px-4 py-3 sm:px-5">
                            {mayAssign ? (
                              <select
                                aria-label={t("dispatch.assign", { parcel: parcel.reference })}
                                disabled={assigning === id}
                                value={parcel.courierId ?? ""}
                                onChange={event =>
                                  assign.mutate({
                                    orderId: parcel.orderId,
                                    key: parcel.key,
                                    courierId: event.target.value ? Number(event.target.value) : null,
                                  })
                                }
                                className={`${fieldClass} me-auto h-9 w-auto max-w-full text-[13px]`}
                              >
                                <option value="">{t("dispatch.unassigned")}</option>
                                {(companies.data ?? [])
                                  .filter(company => company.status === "active" || company.id === parcel.courierId)
                                  .map(company => (
                                    <option key={company.id} value={company.id}>{company.name}</option>
                                  ))}
                              </select>
                            ) : null}
                            {/* The same pure function the server refuses on, so the
                                board cannot offer a step the API would reject. */}
                            {moves.map(state => (
                              <button
                                key={state}
                                type="button"
                                disabled={moving === id}
                                onClick={() => move.mutate({ orderId: parcel.orderId, key: parcel.key, to: state as "shipped" | "delivered" })}
                                className={smallButtonClass.primary}
                              >
                                <PackageCheck className="size-4" aria-hidden />
                                {state === "shipped" ? t("dispatch.collect") : t("dispatch.handOver")}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>

                {/* A board that shows part of the answer looks exactly like one
                    showing all of it — the lie `QueryGate` exists to stop. */}
                {board.data?.truncated ? (
                  <p className="mt-4 text-[13px] ink-muted">{t("dispatch.truncated", { count: ORDER_CEILING_NOTE })}</p>
                ) : null}
              </>
            );
          }}
        </QueryGate>
      )}

      <DeliveryScores />
    </>
  );
}

/**
 * What shoppers said about the deliveries themselves (3.4.4).
 *
 * A company sees its own score and an administrator every company's — scoped by
 * the server. Comments carry no shopper's name: the company needs to know the
 * sofa was left in the rain, not who said so.
 */
function DeliveryScores() {
  const { t } = useTranslation();
  const formatDate = useDateFormat();
  const scores = trpc.dispatch.scores.useQuery();
  return (
    <section aria-labelledby="delivery-scores" className="mt-10">
      <SectionHeading description={t("delivery.scoresNote")}><span id="delivery-scores">{t("delivery.scoresHeading")}</span></SectionHeading>
      <QueryGate queries={[scores]}>
        {() => {
          const data = scores.data;
          if (!data || data.scores.length === 0) return <EmptyState title={t("delivery.noScores")} />;
          return (
            <>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.scores.map(score => (
                  <li key={score.courierId ?? "seller"} className="rounded-2xl border border-[#e1e7ef] bg-white p-4">
                    <p className="text-[14px] font-bold text-[#0a285a]" dir="auto">{score.courierName ?? t("delivery.sellerCarried")}</p>
                    <p className="mt-1 flex items-center gap-2 text-[13px] text-[#536b8c]">
                      <StarRow value={score.average} />
                      <span>{t(score.count === 1 ? "delivery.scoreLineOne" : "delivery.scoreLine", { average: score.average.toFixed(1), count: score.count })}</span>
                    </p>
                  </li>
                ))}
              </ul>
              {data.recent.some(row => row.comment) ? (
                <>
                  <h3 className="mt-6 text-[14px] font-bold text-[#0a285a]">{t("delivery.recentHeading")}</h3>
                  <ul className="mt-2 space-y-2">
                    {data.recent.filter(row => row.comment).map((row, index) => (
                      <li key={index} className="rounded-xl border border-[#e1e7ef] bg-white px-4 py-3">
                        <p className="flex flex-wrap items-center gap-2 text-[12px] text-[#536b8c]">
                          <StarRow value={row.rating} />
                          <span>{formatDate(row.createdAt)}</span>
                          {row.vendorName ? <span dir="auto">· {row.vendorName}</span> : null}
                        </p>
                        <p dir="auto" className="mt-1 text-[14px] leading-6 text-[#3d5376]">{row.comment}</p>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          );
        }}
      </QueryGate>
    </section>
  );
}
