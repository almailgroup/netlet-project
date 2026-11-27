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
 *
 * **Its second view is the store's products in shoppers' carts** (on the
 * owner's word, `?view=carts`, where a store's "in a cart" notice lands): each
 * one a line in a signed-in shopper's cart from the last fortnight, naming
 * nobody, with a price the store can send that cart. What it sends is an
 * agreed price like any answer here — applied in the cart, never advertised.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/ui/QueryGate";
import { Pager } from "@/components/ui/Pager";
import { EmptyState, fieldClass, Notice, PageHeader, Pill, Segmented, SkeletonRows, smallButtonClass, Toggle } from "@/components/admin/ui";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { can, type Actor } from "@shared/inventory/permissions";
import { acceptableStorePrice, CART_INTEREST_DAYS, MAX_NOTE, OFFER_WINDOW_DAYS } from "@shared/commerce/priceOffers";
import type { MessageKey } from "@shared/i18n/dictionary";
import { trpc } from "@/lib/trpc";
import { Thumb } from "@/components/product/Thumb";
import { Check, LoaderCircle, ShoppingBag, X } from "lucide-react";
import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { toast } from "sonner";

export default function AdminOffers() {
  usePageMeta(privatePageMeta("Price requests"));
  return <AdminShell need="offer.answer">{actor => <OffersPage actor={actor} />}</AdminShell>;
}

/** The two views, in the address so a notice can open the second. */
function OffersPage({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const address = useSearch();
  const [, navigate] = useLocation();
  const view = new URLSearchParams(address).get("view") === "carts" ? "carts" : "requests";
  const vendorId = actor.kind === "vendor" ? actor.vendorId : undefined;
  const inCarts = trpc.offers.cartInterestCount.useQuery({ vendorId });
  const show = (next: "requests" | "carts") => navigate(next === "carts" ? "/admin/offers?view=carts" : "/admin/offers", { replace: true });

  return (
    <>
      <PageHeader title={t("admin.offersTitle")} description={t(view === "carts" ? "admin.cartsNote" : "admin.offersNote", { days: String(CART_INTEREST_DAYS), offerDays: String(OFFER_WINDOW_DAYS) })} />
      <Segmented
        label={t("admin.offersTitle")}
        className="mb-5 w-fit"
        value={view}
        onChange={show}
        options={[
          { value: "requests", label: t("admin.offersViewRequests") },
          { value: "carts", label: t("admin.offersViewCarts"), count: inCarts.data ?? null },
        ]}
      />
      {view === "carts" ? <CartInterestList actor={actor} onRequests={() => show("requests")} /> : <Inbox actor={actor} />}
    </>
  );
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
                      <li key={row.id} className="overflow-hidden rounded-2xl border border-[#e3e8f0] bg-white shadow-[0_1px_2px_rgba(10,40,90,0.05)]">
                        <div className="p-4 sm:p-5">
                          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                            <p dir="auto" className="min-w-0 text-[15px] font-bold text-[#0a285a]">{row.productTitle}</p>
                            <Pill tone={tone(row.state)}>{t(row.state === "offered" && row.startedBy === "store" ? "admin.offersSentToCart" : STATE_LABEL[row.state])}</Pill>
                          </div>
                          {/* The sentences follow the page; only the amounts
                              inside them are isolated. */}
                          <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[#3d5376]">
                            <span className="font-semibold text-[#0a285a]">{t(row.startedBy === "store" ? "admin.offersYouSent" : "admin.offersShopperAsked", { price: amount(row.askedPrice) })}</span>
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

/*
 * The store's products in signed-in shoppers' carts, and a price for each
 * (`offers.cartInterest`, `offers.sendToCart`). The server answers what may be
 * done with each line (`action`), so the page draws only what it accepts:
 * send a price, answer the shopper's own request instead, or say the price
 * they already hold.
 */
function CartInterestList({ actor, onRequests }: { actor: Actor; onRequests: () => void }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const vendorId = actor.kind === "vendor" ? actor.vendorId : undefined;
  const [page, setPage] = useState(1);
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [problems, setProblems] = useState<Record<number, MessageKey | null>>({});
  const list = trpc.offers.cartInterest.useQuery({ page, vendorId }, { placeholderData: previous => previous });
  const send = trpc.offers.sendToCart.useMutation({
    onSuccess: () => {
      void utils.offers.cartInterest.invalidate();
      void utils.offers.inbox.invalidate();
      toast.success(t("admin.cartsSent"));
    },
    onError: error => toast.error(tError(error.message)),
  });
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });

  const press = (lineId: number, listPrice: string) => {
    const price = (prices[lineId] ?? "").trim();
    if (!/^\d+(\.\d{1,3})?$/.test(price) || !acceptableStorePrice(listPrice, price)) {
      setProblems(map => ({ ...map, [lineId]: "offers.storePriceRange" }));
      document.getElementById(`cart-price-${lineId}`)?.focus();
      return;
    }
    setProblems(map => ({ ...map, [lineId]: null }));
    send.mutate({ lineId, price, note: (notes[lineId] ?? "").trim() || null, vendorId });
  };

  if (list.isLoading) return <SkeletonRows rows={3} label={t("admin.loading")} />;
  return (
    <QueryGate queries={[list]}>
      {() => {
        const data = list.data;
        if (data && !data.ready) return <Notice tone="warning">{t("offers.storeClosed")}</Notice>;
        const rows = data?.rows ?? [];
        if (!rows.length) return <EmptyState title={t("admin.cartsEmpty")} />;
        return (
          <>
            <ul className="space-y-3">
              {rows.map(row => {
                const priceId = `cart-price-${row.lineId}`;
                const noteId = `cart-note-${row.lineId}`;
                const errorId = `cart-price-error-${row.lineId}`;
                const problem = problems[row.lineId];
                const sending = send.isPending && send.variables?.lineId === row.lineId;
                return (
                  <li key={row.lineId} className="overflow-hidden rounded-2xl border border-[#e3e8f0] bg-white shadow-[0_1px_2px_rgba(10,40,90,0.05)]">
                    <div className="flex gap-3.5 p-4 sm:p-5">
                      <span className="size-16 shrink-0 overflow-hidden rounded-xl border border-[#eef1f5] bg-white">
                        <Thumb src={row.image ?? undefined} alt="" className="size-full bg-white object-contain" icon={<ShoppingBag className="size-4 text-[#536b8c]" />} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p dir="auto" className="text-[15px] font-bold text-[#0a285a]">{row.productTitle}</p>
                        {row.variantTitle && row.variantTitle !== "Default" ? <p dir="auto" className="mt-0.5 text-[13px] text-[#3d5376]">{row.variantTitle}</p> : null}
                        <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[#3d5376]">
                          <span>{t("admin.offersListed", { price: amount(row.listPrice) })}</span>
                          <span>{t("admin.cartsQuantity", { count: String(row.quantity) })}</span>
                          <span className="ink-muted">{t("admin.cartsAdded", { date: formatDate(row.addedAt) })}</span>
                        </p>
                      </div>
                    </div>

                    {row.action === "send" ? (
                      <div className="grid gap-3 border-t border-[#eef1f5] bg-[#fafbfd] px-4 py-4 sm:grid-cols-[170px_minmax(0,1fr)] sm:px-5">
                        <div>
                          <label htmlFor={priceId} className="block text-[13px] font-semibold text-[#0a285a]">{t("admin.cartsPrice")}</label>
                          <input
                            id={priceId}
                            dir="ltr"
                            inputMode="decimal"
                            value={prices[row.lineId] ?? ""}
                            aria-invalid={problem ? true : undefined}
                            aria-describedby={problem ? errorId : undefined}
                            onChange={event => {
                              const value = event.target.value;
                              setPrices(map => ({ ...map, [row.lineId]: value }));
                              if (problem) setProblems(map => ({ ...map, [row.lineId]: null }));
                            }}
                            className={`${fieldClass} mt-1.5`}
                          />
                          {problem ? <p id={errorId} className="mt-1.5 text-[12px] font-semibold text-[#a3281a]">{t(problem)}</p> : null}
                        </div>
                        <div>
                          <label htmlFor={noteId} className="block text-[13px] font-semibold text-[#0a285a]">
                            {t("admin.offersAnswerNote")} <span className="text-[12px] font-normal ink-muted">{t("admin.optional")}</span>
                          </label>
                          <input
                            id={noteId}
                            dir="auto"
                            maxLength={MAX_NOTE}
                            value={notes[row.lineId] ?? ""}
                            onChange={event => {
                              const value = event.target.value;
                              setNotes(map => ({ ...map, [row.lineId]: value }));
                            }}
                            className={`${fieldClass} mt-1.5`}
                          />
                        </div>
                        <div className="flex justify-end sm:col-span-2">
                          <button type="button" onClick={() => press(row.lineId, row.listPrice)} disabled={send.isPending} className={smallButtonClass.primary}>
                            {sending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                            {t("admin.cartsSend")}
                          </button>
                        </div>
                      </div>
                    ) : row.action === "answer" ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eef1f5] bg-[#fffaf0] px-4 py-3.5 sm:px-5">
                        <p className="text-[13px] text-[#5c4300]">{t("offers.askedOpen")}</p>
                        <button type="button" onClick={onRequests} className={smallButtonClass.secondary}>{t("admin.cartsOpenRequests")}</button>
                      </div>
                    ) : row.offer?.price ? (
                      <p className="border-t border-[#eef1f5] bg-[#f3faf5] px-4 py-3.5 text-[13px] font-semibold text-[#1f5130] sm:px-5">
                        {t(row.offer.startedBy === "store" ? "admin.cartsHeldStore" : "admin.cartsHeldAnswer", {
                          price: amount(row.offer.price),
                          date: row.offer.expiresAt ? formatDate(row.offer.expiresAt) : "—",
                        })}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {data ? <Pager page={data} onPage={setPage} /> : null}
          </>
        );
      }}
    </QueryGate>
  );
}
