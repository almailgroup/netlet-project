/**
 * The seller's side of a special-price request.
 *
 * Requirement 3.1.13. What a seller quotes here is one shopper's price and is
 * never advertised, which is why it needs no Ministry of Commerce discount
 * permit — the page says so, because a vendor who has been refused a publish
 * over a lapsed permit will reasonably wonder.
 *
 * **Open first, and the filter is the server's.** "Waiting on you" asks the
 * server for what is pending and unexpired rather than fetching a page and
 * filtering it: with paging, the second reports an empty queue once the
 * requests it would have matched fall onto page two. The same lesson the
 * review queue already carries.
 *
 * **The switch that fills this inbox is on it.** Turning price requests on for
 * a store is `vendor.editProfile`, so an owner does it themselves rather than
 * asking an administrator — unlike commission, which sits outside a vendor's
 * control entirely because it is NetLet's side of the deal.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { Pager } from "@/components/admin/Pager";
import { EmptyState, fieldClass, PageHeader, Pill, Segmented, SkeletonRows, smallButtonClass, Toggle } from "@/components/admin/ui";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { can, type Actor } from "@shared/inventory/permissions";
import { MAX_NOTE } from "@shared/commerce/priceOffers";
import type { MessageKey } from "@shared/i18n/dictionary";
import { trpc } from "@/lib/trpc";
import { Check, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function AdminOffers() {
  usePageMeta(privatePageMeta("Price requests"));
  return <AdminShell need="offer.answer">{actor => <Inbox actor={actor} />}</AdminShell>;
}

/*
 * The seller's words for each state, not the shopper's. `offers.statusPending`
 * reads "Waiting on the seller", which is exactly right on a product page and
 * exactly wrong in the seller's own inbox — it is the same filter label above,
 * reused so the two cannot drift apart.
 */
const STATE_LABEL: Record<string, MessageKey> = {
  pending: "admin.offersOpenOnly",
  offered: "admin.offersAnswered",
  declined: "offers.statusDeclined",
  expired: "offers.statusExpired",
  withdrawn: "offers.statusWithdrawn",
  used: "offers.statusUsed",
};

function Inbox({ actor }: { actor: Actor }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [openOnly, setOpenOnly] = useState<"open" | "all">("open");
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});

  const vendorId = actor.kind === "vendor" ? actor.vendorId : undefined;
  const inbox = trpc.offers.inbox.useQuery({ page, open: openOnly === "open" }, { placeholderData: previous => previous });
  const storeOpen = trpc.offers.storeOpen.useQuery({ vendorId }, { enabled: vendorId !== undefined });

  const refresh = () => {
    void utils.offers.inbox.invalidate();
    void utils.offers.waiting.invalidate();
  };
  const fail = (error: { message: string }) => toast.error(tError(error.message));
  const answer = trpc.offers.answer.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: fail,
  });
  const decline = trpc.offers.decline.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: fail,
  });
  const setStoreOpen = trpc.offers.setStoreOpen.useMutation({
    onSuccess: () => { void utils.offers.storeOpen.invalidate(); toast.success(t("admin.saved")); },
    onError: fail,
  });
  const answering = answer.isPending ? answer.variables?.offerId : undefined;

  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });
  const tone = (state: string) => state === "pending" ? "warning" : state === "offered" ? "good" : state === "used" ? "navy" : "neutral";

  return (
    <>
      <PageHeader title={t("admin.offersTitle")} description={t("admin.offersNote")} />

      {/* Only a vendor has one store to switch. An admin reading every seller's
          inbox has no single store this could mean, so it is not drawn. */}
      {vendorId !== undefined && can(actor, "vendor.editProfile", vendorId) ? (
        <Toggle
          className="mb-5 max-w-2xl"
          checked={storeOpen.data ?? false}
          disabled={storeOpen.isLoading || setStoreOpen.isPending}
          onChange={accepts => setStoreOpen.mutate({ vendorId, accepts })}
          label={t("admin.offersStoreOpen")}
          hint={t("admin.offersStoreOpenNote")}
        />
      ) : null}

      <Segmented
        label={t("admin.offersTitle")}
        className="mb-4 w-fit"
        value={openOnly}
        onChange={value => { setOpenOnly(value); setPage(1); }}
        options={[{ value: "open", label: t("admin.offersOpenOnly") }, { value: "all", label: t("admin.offersAll") }]}
      />

      {inbox.isLoading ? (
        <SkeletonRows rows={3} label={t("admin.loading")} />
      ) : (
        <QueryGate queries={[inbox]}>
          {() => {
            const rows = inbox.data?.rows ?? [];
            if (!rows.length) return <EmptyState title={t("admin.offersEmpty")} />;
            return (
              <>
                <ul className="space-y-3">
                  {rows.map(row => {
                    const priceId = `price-${row.id}`;
                    const noteId = `note-${row.id}`;
                    return (
                      <li key={row.id} className="overflow-hidden rounded-2xl border border-[#e1e7ef] bg-white">
                        <div className="p-4 sm:p-5">
                          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                            <p dir="auto" className="min-w-0 text-[15px] font-bold text-[#0a285a]">{row.productTitle}</p>
                            <Pill tone={tone(row.state)}>{t(STATE_LABEL[row.state])}</Pill>
                          </div>
                          {/* The sentences follow the page; only the amounts
                              inside them are isolated. */}
                          <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[#3d5376]">
                            <span className="font-semibold text-[#0a285a]">{t("admin.offersShopperAsked", { price: amount(row.askedPrice) })}</span>
                            <span>{t("admin.offersListed", { price: amount(row.listPrice) })}</span>
                            <span>{t("admin.offersQuantity", { count: row.quantity })}</span>
                            <span className="ink-muted">{formatDate(row.createdAt)}</span>
                          </p>
                          {row.shopperNote ? (
                            <p dir="auto" className="mt-3 rounded-xl bg-[#f4f6f9] px-3.5 py-2.5 text-[14px] leading-6 text-[#3d5376]">
                              {row.shopperNote}
                            </p>
                          ) : null}
                          {row.state !== "pending" && row.offeredPrice ? (
                            <p className="mt-3 text-[14px] font-bold text-[#0a285a]">{amount(row.offeredPrice)}</p>
                          ) : null}
                        </div>

                        {row.state === "pending" ? (
                          <div className="grid gap-3 border-t border-[#eef1f5] bg-[#fafbfd] px-4 py-4 sm:grid-cols-[150px_minmax(0,1fr)] sm:px-5">
                            <div>
                              <label htmlFor={priceId} className="block text-[13px] font-semibold text-[#0a285a]">{t("admin.offersAnswerPrice")}</label>
                              <input
                                id={priceId}
                                dir="ltr"
                                inputMode="decimal"
                                value={prices[row.id] ?? ""}
                                placeholder={row.askedPrice}
                                onChange={event => setPrices(map => ({ ...map, [row.id]: event.target.value }))}
                                className={`${fieldClass} mt-1.5`}
                              />
                            </div>
                            <div>
                              <label htmlFor={noteId} className="block text-[13px] font-semibold text-[#0a285a]">
                                {t("admin.offersAnswerNote")} <span className="text-[12px] font-normal ink-muted">{t("admin.optional")}</span>
                              </label>
                              <input
                                id={noteId}
                                dir="auto"
                                maxLength={MAX_NOTE}
                                value={notes[row.id] ?? ""}
                                onChange={event => setNotes(map => ({ ...map, [row.id]: event.target.value }))}
                                className={`${fieldClass} mt-1.5`}
                              />
                            </div>
                            <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
                              <button
                                type="button"
                                onClick={() => decline.mutate({ offerId: row.id, note: (notes[row.id] ?? "").trim() || null, vendorId })}
                                disabled={decline.isPending || answer.isPending}
                                className={smallButtonClass.quietDanger}
                              >
                                <X className="size-4" aria-hidden />{t("admin.offersDecline")}
                              </button>
                              <button
                                type="button"
                                onClick={() => answer.mutate({
                                  offerId: row.id,
                                  offeredPrice: (prices[row.id] ?? "").trim(),
                                  note: (notes[row.id] ?? "").trim() || null,
                                  vendorId,
                                })}
                                disabled={!(prices[row.id] ?? "").trim() || answer.isPending || decline.isPending}
                                className={smallButtonClass.primary}
                              >
                                {answering === row.id ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                                {t("admin.offersSend")}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {inbox.data ? <Pager page={inbox.data} onPage={setPage} /> : null}
              </>
            );
          }}
        </QueryGate>
      )}
    </>
  );
}
