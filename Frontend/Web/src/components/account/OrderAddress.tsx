/**
 * "Change delivery address" — the order sent to another of the shopper's
 * saved addresses while nothing going there has left the stores (on the
 * owner's word: "update the delivery address when permitted, before sending
 * the products, and recalculate if he needs to pay extra fees").
 *
 * The choices are the address book, the one place an address is written —
 * the order freezes its parts from it. What the driver collects is asked
 * again with the move (`orders.changeAddress`) and said back: a store charges
 * the same anywhere in Kuwait, so it does not move, and the panel says that
 * rather than leaving the shopper to wonder. A line sent somewhere of its own
 * keeps its own.
 */
import { useId, useState } from "react";
import { toast } from "sonner";
import { Check, LoaderCircle, MapPin } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import type { Detail } from "@/components/account/LineReturn";

export function OrderAddress({ reference, detail, onDone, onCancel }: {
  reference: string;
  detail: Detail;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t, tError, locale } = useTranslation();
  const ids = useId();
  const addresses = trpc.customer.addresses.list.useQuery();
  const [chosen, setChosen] = useState<number | null>(null);
  const move = trpc.orders.changeAddress.useMutation({
    onSuccess: answer => {
      toast.success(t("orders.addressDone", { amount: formatMoney(answer.owed, { currencyCode: detail.order.currency, locale }) }));
      onDone();
    },
    onError: error => toast.error(tError(error.message)),
  });

  const rows = addresses.data ?? [];
  return (
    <section aria-labelledby={`${ids}-title`} className="mt-3 rounded-2xl border border-[#d5dfeb] bg-white p-4">
      <h4 id={`${ids}-title`} className="text-[14px] font-extrabold text-[#0a285a]">{t("orders.changeAddress")}</h4>
      <p className="mt-1 text-[12px] leading-5 ink-muted">
        {t("orders.addressNow")} <bdi dir="auto" className="font-bold text-[#0a285a]">{detail.order.addressLine ?? "—"}</bdi>
      </p>
      {addresses.isPending ? (
        <div aria-hidden className="mt-3 h-24 animate-pulse rounded-xl bg-[#f1f2f6]" />
      ) : rows.length === 0 ? (
        <p className="mt-3 text-[13px] ink-muted">{t("orders.addressNone")}</p>
      ) : (
        <fieldset className="mt-3">
          <legend className="sr-only">{t("orders.addressChoose")}</legend>
          <ul className="space-y-2">
            {rows.map(address => (
              <li key={address.id}>
                <label className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${chosen === address.id ? "border-[#0a285a] bg-[#f4f6fa]" : "border-[#e7edf5]"}`}>
                  <input
                    type="radio"
                    name={`${ids}-address`}
                    checked={chosen === address.id}
                    onChange={() => setChosen(address.id)}
                    className="mt-1 size-4 shrink-0 accent-[#0a285a]"
                  />
                  <MapPin className="mt-0.5 size-4 shrink-0 text-[#5d6b82]" aria-hidden />
                  <span className="min-w-0">
                    <span dir="auto" className="block text-[13px] font-bold text-[#0a285a]">{address.label}</span>
                    <span dir="auto" className="block text-[12px] leading-5 ink-muted">{address.addressLine}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <p className="mt-3 text-[12px] leading-5 ink-muted">{t("orders.addressFees")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={chosen === null || move.isPending}
          onClick={() => chosen !== null && move.mutate({ reference, addressId: chosen })}
          className="glass-navy type-control pressable inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 disabled:opacity-50 pointer-fine:min-h-9"
        >
          {move.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
          {t("orders.addressSend")}
        </button>
        <button type="button" onClick={onCancel} className="glass type-control pressable min-h-11 rounded-full px-4 py-2 pointer-fine:min-h-9">
          {t("claims.cancel")}
        </button>
        <Link href="/account/addresses" className="ms-auto text-[12px] font-bold text-[#0a285a] underline underline-offset-2">
          {t("orders.addressAdd")}
        </Link>
      </div>
    </section>
  );
}
