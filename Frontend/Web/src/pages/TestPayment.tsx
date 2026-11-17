/**
 * NetLet's own test payment page (`/pay/test/:id`, 0086), on the owner's word
 * ("build a mockup"): where a gateway's page will go once one is connected.
 *
 * **It takes no money and says so at the top**, before the amount — a page
 * that looks like a bank's and is not would be the one thing a shopper must
 * never be shown. It asks for no card details. Pay marks the attempt paid on
 * the server, which asks the window and the figure again under a lock on the
 * order; the order then reads paid online and the driver collects nothing,
 * while the books stay untouched because no money moved.
 *
 * Outside the shop's frame, as checkout is: a payment page with the search
 * and the departments round it is an invitation to leave half-way.
 */
import type { ReactNode } from "react";
import { Banknote, CircleCheck, CircleX, CreditCard, FlaskConical, Smartphone } from "lucide-react";
import { Link, Redirect, useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { BareHeader } from "@/components/layout/BareHeader";
import { BUTTON_PLAIN, BUTTON_PRIMARY, CARD, PAGE_SPACE } from "@/components/layout/Page";
import { METHOD_NAME } from "@/components/account/OrderHandover";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import type { OnlineMethod } from "@shared/commerce/onlinePayment";
import { privatePageMeta } from "@shared/seo";

const ICON: Record<OnlineMethod, ReactNode> = {
  knet: <span className="text-[12px] font-extrabold tracking-tight">KNET</span>,
  card: <CreditCard className="size-6" aria-hidden />,
  apple_pay: <Smartphone className="size-6" aria-hidden />,
};

export default function TestPayment() {
  usePageMeta(privatePageMeta("Test payment"));
  const { t } = useTranslation();
  const { isAuthenticated, loading } = useAuth();
  const [, params] = useRoute("/pay/test/:id");
  const raw = params?.id ?? "";
  const id = Number(raw);
  const valid = Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647;

  if (!loading && !isAuthenticated) return <Redirect to={`/signin?next=${encodeURIComponent(`/pay/test/${raw}`)}`} replace />;

  return (
    <div className="type-body flex min-h-screen flex-col bg-background text-[#0a285a]">
      <BareHeader note={<><FlaskConical className="size-4 ink-accent" aria-hidden /> {t("pay.testBadge")}</>} />
      <main id="main" tabIndex={-1} className={`container flex-1 outline-none ${PAGE_SPACE}`}>
        <div className="mx-auto w-full max-w-md">
          <h1 className="text-[24px] font-extrabold leading-8 sm:text-[30px] sm:leading-9">{t("pay.title")}</h1>
          {valid && isAuthenticated ? <PaymentCard id={id} /> : loading ? <CardSkeleton /> : <Missing />}
        </div>
      </main>
    </div>
  );
}

function CardSkeleton() {
  const { t } = useTranslation();
  return <div className={`${CARD} mt-5 h-[380px] animate-pulse bg-[#f4f6fa]`} aria-busy="true" aria-label={t("admin.loading")} />;
}

function Missing() {
  const { t } = useTranslation();
  return (
    <div className={`${CARD} mt-5 p-5`}>
      <p className="text-[14px] leading-6 text-[#3d5376]">{t("pay.missing")}</p>
      <Link href="/account/orders" className={`${BUTTON_PLAIN} mt-4`}>{t("pay.toOrders")}</Link>
    </div>
  );
}

function PaymentCard({ id }: { id: number }) {
  const { t, tError, locale } = useTranslation();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const payment = trpc.orders.paymentGet.useQuery({ paymentId: id }, { refetchOnWindowFocus: false });
  const toOrder = (reference: string) => `/account/orders?order=${encodeURIComponent(reference)}`;

  const finish = trpc.orders.paymentTest.useMutation({
    onSuccess: (done, asked) => {
      void utils.orders.get.invalidate({ reference: done.reference });
      void utils.orders.list.invalidate();
      if (asked.outcome === "paid" && done.status === "paid") toast.success(t("pay.paidToast"));
      navigate(toOrder(done.reference));
    },
    onError: error => {
      toast.error(tError(error.message));
      void utils.orders.paymentGet.invalidate({ paymentId: id });
    },
  });

  if (payment.isLoading) return <CardSkeleton />;
  const data = payment.data;
  if (!data) return <Missing />;
  const amount = formatMoney(data.amount, { currencyCode: data.currency, locale });

  /* Already answered: say what became of it rather than offering it again. */
  if (data.status !== "started") {
    const paid = data.status === "paid";
    return (
      <div className={`${CARD} mt-5 p-5`}>
        <p className={`flex items-center gap-2 text-[16px] font-extrabold ${paid ? "text-[#2f5d33]" : "text-[#0a285a]"}`}>
          {paid ? <CircleCheck className="size-5" aria-hidden /> : <CircleX className="size-5" aria-hidden />}
          {paid ? t("pay.donePaid", { amount }) : t("pay.doneNot")}
        </p>
        <Link href={toOrder(data.reference)} className={`${BUTTON_PRIMARY} mt-4 w-full`}>{t("pay.backToOrder")}</Link>
      </div>
    );
  }

  return (
    <div className={`${CARD} mt-5 overflow-hidden`}>
      {/* Said before anything else on the page: this is not a bank's page. */}
      <p className="flex items-start gap-2 border-b border-dashed border-[#e4b363] bg-[#fff8eb] px-5 py-3 text-[13px] leading-5 text-[#6b4a12]">
        <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{t("pay.testNote")}</span>
      </p>
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#0a285a] text-white">{ICON[data.method]}</span>
          <div className="min-w-0">
            <p className="text-[15px] font-bold">{t(METHOD_NAME[data.method])}</p>
            <p className="text-[13px] ink-muted">{t("pay.toNetLet")}</p>
          </div>
        </div>
        <p className="mt-5 text-[13px] font-semibold ink-muted">{t("pay.amount")}</p>
        <p className="text-[32px] font-extrabold leading-10 tabular-nums">{amount}</p>
        <p className="mt-1 flex items-center gap-1.5 text-[13px] ink-muted">
          <Banknote className="size-4" aria-hidden />
          <span>{t("pay.forOrder")} <bdi dir="ltr">{data.reference}</bdi></span>
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            disabled={finish.isPending}
            onClick={() => finish.mutate({ paymentId: id, outcome: "paid" })}
            className={`${BUTTON_PRIMARY} h-12 w-full disabled:opacity-60`}
          >
            {t(finish.isPending && finish.variables?.outcome === "paid" ? "pay.paying" : "pay.pay", { amount })}
          </button>
          <button
            type="button"
            disabled={finish.isPending}
            onClick={() => finish.mutate({ paymentId: id, outcome: "cancelled" })}
            className={`${BUTTON_PLAIN} h-12 w-full disabled:opacity-60`}
          >
            {t("pay.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
