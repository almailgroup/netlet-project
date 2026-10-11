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
  const { t } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [openOnly, setOpenOnly] = useState(true);
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});

  const vendorId = actor.kind === "vendor" ? actor.vendorId : undefined;
  const inbox = trpc.offers.inbox.useQuery({ page, open: openOnly }, { placeholderData: previous => previous });
  const storeOpen = trpc.offers.storeOpen.useQuery({ vendorId }, { enabled: vendorId !== undefined });

  const refresh = () => {
    void utils.offers.inbox.invalidate();
    void utils.offers.waiting.invalidate();
  };
  const answer = trpc.offers.answer.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: error => toast.error(t(error.message as MessageKey)),
  });
  const decline = trpc.offers.decline.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: error => toast.error(t(error.message as MessageKey)),
  });
  const setStoreOpen = trpc.offers.setStoreOpen.useMutation({
    onSuccess: () => { void utils.offers.storeOpen.invalidate(); toast.success(t("admin.saved")); },
    onError: error => toast.error(t(error.message as MessageKey)),
  });

  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });

  return (
    <>
      <h1 className="text-[22px] leading-8 font-extrabold sm:text-[24px]">{t("admin.offersTitle")}</h1>
      <p className="mt-1 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("admin.offersNote")}</p>

      {/* Only a vendor has one store to switch. An admin reading every seller's
          inbox has no single store this could mean, so it is not drawn. */}
      {vendorId !== undefined && can(actor, "vendor.editProfile", vendorId) ? (
        <label className="mt-5 flex items-start gap-3 rounded-xl border border-[#d5dfeb] bg-white/70 px-4 py-3">
          <input
            type="checkbox"
            checked={storeOpen.data ?? false}
            disabled={storeOpen.isLoading || setStoreOpen.isPending}
            onChange={event => setStoreOpen.mutate({ vendorId, accepts: event.target.checked })}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="block text-[13px] font-extrabold text-[#0a285a]">{t("admin.offersStoreOpen")}</span>
            <span className="block text-[11px] leading-5 ink-muted">{t("admin.offersStoreOpenNote")}</span>
          </span>
        </label>
      ) : null}

      <div className="mt-5 flex gap-2">
        {([[true, "admin.offersOpenOnly"], [false, "admin.offersAll"]] as const).map(([value, label]) => (
          <button
            key={String(value)}
            onClick={() => { setOpenOnly(value); setPage(1); }}
            aria-pressed={openOnly === value}
            className={`pressable rounded-full px-4 py-2 text-[12px] font-extrabold ${openOnly === value ? "glass glass-navy" : "glass"}`}
          >
            {t(label)}
          </button>
        ))}
      </div>

      <QueryGate queries={[inbox]}>
        {() => {
          const rows = inbox.data?.rows ?? [];
          if (!rows.length) {
            return (
              <div className="mt-5 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
                <p className="text-sm font-extrabold">{t("admin.offersEmpty")}</p>
              </div>
            );
          }
          return (
            <div className="mt-5 space-y-3">
              {rows.map(row => (
                <article key={row.id} className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p dir="auto" className="font-bold text-[#0a285a]">{row.productTitle}</p>
                    <span className="text-[11px] font-extrabold tracking-[.05em] ink-muted uppercase">
                      {t(STATE_LABEL[row.state])}
                    </span>
                  </div>
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] ink-muted">
                    <span><bdi dir="ltr">{t("admin.offersShopperAsked", { price: amount(row.askedPrice) })}</bdi></span>
                    <span><bdi dir="ltr">{t("admin.offersListed", { price: amount(row.listPrice) })}</bdi></span>
                    <span>{t("admin.offersQuantity", { count: row.quantity })}</span>
                    <span>{formatDate(row.createdAt)}</span>
                  </p>
                  {row.shopperNote ? (
                    <p dir="auto" className="mt-2 rounded-xl bg-[#f3f2ed] px-3 py-2 text-[13px] leading-6 text-[#404553]">
                      {row.shopperNote}
                    </p>
                  ) : null}

                  {row.state === "pending" ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_auto_auto] sm:items-end">
                      <div>
                        <label htmlFor={`price-${row.id}`} className="text-[11px] font-extrabold tracking-[.05em] ink-muted uppercase">
                          {t("admin.offersAnswerPrice")}
                        </label>
                        <input
                          id={`price-${row.id}`}
                          dir="ltr"
                          inputMode="decimal"
                          value={prices[row.id] ?? ""}
                          placeholder={row.askedPrice}
                          onChange={event => setPrices(map => ({ ...map, [row.id]: event.target.value }))}
                          className="glass-field mt-1 w-full rounded-xl px-3 py-2 text-[14px] font-bold"
                        />
                      </div>
                      <div>
                        <label htmlFor={`note-${row.id}`} className="text-[11px] font-extrabold tracking-[.05em] ink-muted uppercase">
                          {t("admin.offersAnswerNote")}
                        </label>
                        <input
                          id={`note-${row.id}`}
                          dir="auto"
                          maxLength={MAX_NOTE}
                          value={notes[row.id] ?? ""}
                          onChange={event => setNotes(map => ({ ...map, [row.id]: event.target.value }))}
                          className="glass-field mt-1 w-full rounded-xl px-3 py-2 text-[13px]"
                        />
                      </div>
                      <button
                        onClick={() => answer.mutate({
                          offerId: row.id,
                          offeredPrice: (prices[row.id] ?? "").trim(),
                          note: (notes[row.id] ?? "").trim() || null,
                          vendorId,
                        })}
                        disabled={!(prices[row.id] ?? "").trim() || answer.isPending}
                        className="glass glass-navy pressable inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-[11px] font-extrabold disabled:opacity-50"
                      >
                        {answer.isPending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
                        {t("admin.offersSend")}
                      </button>
                      <button
                        onClick={() => decline.mutate({ offerId: row.id, note: (notes[row.id] ?? "").trim() || null, vendorId })}
                        disabled={decline.isPending}
                        className="glass pressable inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-[11px] font-extrabold disabled:opacity-50"
                      >
                        <X className="size-3.5" aria-hidden />{t("admin.offersDecline")}
                      </button>
                    </div>
                  ) : row.offeredPrice ? (
                    <p className="mt-2 text-[13px] font-extrabold text-[#0a285a]">
                      <bdi dir="ltr">{amount(row.offeredPrice)}</bdi>
                    </p>
                  ) : null}
                </article>
              ))}
              {inbox.data ? <Pager page={inbox.data} onPage={setPage} /> : null}
            </div>
          );
        }}
      </QueryGate>
    </>
  );
}
