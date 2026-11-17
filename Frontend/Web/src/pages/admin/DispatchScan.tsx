/**
 * The driver's check at the door (0086, on the owner's word): scan the
 * shopper's QR, or type the code under it, to see how the order is paid and
 * hand it over.
 *
 * **Three ways in, one answer.** The QR is this page's own address with the
 * token in its fragment, so a phone's camera app opens it and the check runs
 * by itself (`handoverScan` keeps the token through a sign-in); a browser that
 * can read a QR from the camera (`BarcodeDetector`) scans it here; and the
 * eight characters under it are typed against an order on the driver's way.
 *
 * **Paid online is one step** — the scan answers "Paid online, collect
 * nothing" and hands the driver's parcels over. **Cash is two**: it says what
 * to collect, and a press once the money is in hand hands them over. Recording
 * the cash on the books stays the store's or NetLet's own press, as before.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { Camera, CircleCheck, KeyRound, ScanLine, Wallet } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { buttonClass, Card, Field, fieldClass, Notice, PageHeader } from "@/components/admin/ui";
import { Select } from "@/components/ui/Select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { dropHandoverToken, peekHandoverToken } from "@/lib/handoverScan";
import { trpc } from "@/lib/trpc";
import { METHOD_NAME } from "@/components/account/OrderHandover";
import { HANDOVER_CODE_LENGTH, tokenFromScan } from "@shared/commerce/onlinePayment";
import { privatePageMeta } from "@shared/seo";

export default function AdminDispatchScan() {
  usePageMeta(privatePageMeta("Hand over"));
  return <AdminShell need="delivery.move">{() => <Scan />}</AdminShell>;
}

type Asked = { token: string } | { orderId: number; code: string };

/** Whether this browser can read a QR from the camera itself. */
function cameraCanRead(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window && Boolean(navigator.mediaDevices?.getUserMedia);
}

function Scan() {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const utils = trpc.useUtils();
  const onTheWay = trpc.dispatch.board.useQuery({ state: "transit" });
  const [asked, setAsked] = useState<Asked | null>(null);
  const [orderId, setOrderId] = useState<string>(() => new URLSearchParams(window.location.search).get("order") ?? "");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const handover = trpc.dispatch.handover.useMutation({
    onSuccess: answer => {
      if (answer.done) {
        void utils.dispatch.board.invalidate();
        void utils.dispatch.waiting.invalidate();
      }
    },
  });

  const ask = (input: Asked, cashReceived = false) => {
    setAsked(input);
    handover.mutate({ ...input, ...(cashReceived ? { cashReceived: true } : {}) });
  };

  /* Opened by the phone's own camera: the check runs by itself, once. */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    const token = peekHandoverToken();
    if (!token) return;
    started.current = true;
    dropHandoverToken();
    ask({ token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The orders the driver is on the way to, for the typed code. */
  const orders = useMemo(() => {
    const seen = new Map<number, { reference: string; name: string | null }>();
    for (const parcel of onTheWay.data?.parcels ?? []) {
      if (!seen.has(parcel.orderId)) seen.set(parcel.orderId, { reference: parcel.reference, name: parcel.orderAddress.contactName });
    }
    return [...seen.entries()];
  }, [onTheWay.data]);

  const submitCode = () => {
    const id = Number(orderId);
    if (!id) return setCodeError(t("dispatch.scanChooseOrder"));
    if (code.replace(/[\s-]/g, "").length !== HANDOVER_CODE_LENGTH) return setCodeError(t("dispatch.scanCodeLength"));
    setCodeError(null);
    ask({ orderId: id, code });
  };

  const reset = () => {
    handover.reset();
    setAsked(null);
    setCode("");
  };

  const answer = handover.data;
  return (
    <>
      <PageHeader
        title={t("dispatch.scanTitle")}
        description={t("dispatch.scanNote")}
        actions={<Link href="/admin/dispatch" className={buttonClass.secondary}>{t("dispatch.scanBackToBoard")}</Link>}
      />

      <div aria-live="polite" className="mb-4 empty:hidden">
        {handover.isPending ? <Notice>{t("dispatch.scanChecking")}</Notice> : null}
        {handover.error ? (
          <Notice tone="danger" action={<button type="button" onClick={reset} className={buttonClass.secondary}>{t("dispatch.scanAgain")}</button>}>
            {tError(handover.error.message)}
          </Notice>
        ) : null}
        {answer ? <Answer answer={answer} money={money} onCash={() => asked && ask(asked, true)} pending={handover.isPending} onAgain={reset} /> : null}
      </div>

      {!answer ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t("dispatch.scanCameraTitle")} description={t("dispatch.scanCameraNote")}>
            {cameraCanRead() ? (
              scanning ? (
                <CameraReader
                  onToken={token => { setScanning(false); ask({ token }); }}
                  onStop={() => setScanning(false)}
                />
              ) : (
                <button type="button" onClick={() => setScanning(true)} className={buttonClass.primary}>
                  <Camera className="size-4" aria-hidden /> {t("dispatch.scanOpenCamera")}
                </button>
              )
            ) : (
              <p className="flex items-start gap-2 text-[13px] leading-5 text-[#3d5376]">
                <ScanLine className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{t("dispatch.scanPhoneCamera")}</span>
              </p>
            )}
          </Card>

          <Card title={t("dispatch.scanCodeTitle")} description={t("dispatch.scanCodeNote")}>
            <form
              className="space-y-3"
              noValidate
              onSubmit={event => { event.preventDefault(); submitCode(); }}
            >
              <Field label={t("dispatch.scanOrder")}>
                <Select value={orderId} onChange={event => setOrderId(event.target.value)} className={fieldClass}>
                  <option value="">{t("dispatch.scanChooseOrder")}</option>
                  {orders.map(([id, order]) => (
                    <option key={id} value={String(id)}>{order.name ? `${order.reference} · ${order.name}` : order.reference}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("dispatch.scanCode")} error={codeError ?? undefined}>
                <input
                  value={code}
                  onChange={event => setCode(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  dir="ltr"
                  maxLength={12}
                  placeholder="ABCD EFGH"
                  className={`${fieldClass} font-bold tracking-[0.12em]`}
                />
              </Field>
              <button type="submit" disabled={handover.isPending} className={buttonClass.primary}>
                <KeyRound className="size-4" aria-hidden /> {t("dispatch.scanCheck")}
              </button>
            </form>
          </Card>
        </div>
      ) : null}
    </>
  );
}

type AnswerShape = NonNullable<ReturnType<typeof trpc.dispatch.handover.useMutation>["data"]>;

function Answer({ answer, money, onCash, pending, onAgain }: {
  answer: AnswerShape;
  money: ReturnType<typeof useMoney>;
  onCash: () => void;
  pending: boolean;
  onAgain: () => void;
}) {
  const { t } = useTranslation();
  const payment = answer.payment;
  const who = (
    <p className="mt-1 text-[13px]">
      <bdi dir="ltr" className="font-bold">{answer.reference}</bdi>
      {answer.contactName ? <> · <bdi>{answer.contactName}</bdi></> : null}
      {" · "}
      {t("dispatch.scanParcels", { count: answer.parcels.length })}
    </p>
  );
  const again = <button type="button" onClick={onAgain} className={buttonClass.secondary}>{t("dispatch.scanAnother")}</button>;

  if (payment.kind === "cash" && !answer.done) {
    return (
      <div className="rounded-2xl border-2 border-[#e4b363] bg-[#fff8eb] p-5 text-[#5c3f0c]">
        <p className="flex items-center gap-2 text-[22px] font-extrabold leading-7">
          <Wallet className="size-6 shrink-0" aria-hidden />
          {t("dispatch.scanCollect", { amount: money({ amount: payment.collect, currencyCode: "KWD" }) })}
        </p>
        {who}
        <p className="mt-2 text-[13px] leading-5">{t("dispatch.scanCollectNote")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={onCash} disabled={pending} className={buttonClass.primary}>{t("dispatch.scanCashIn")}</button>
          {again}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-[#9fd0ab] bg-[#eef8f0] p-5 text-[#1f4d2a]">
      <p className="flex items-center gap-2 text-[22px] font-extrabold leading-7">
        <CircleCheck className="size-6 shrink-0" aria-hidden />
        {payment.kind === "online"
          ? t("dispatch.scanPaidOnline", { method: t(METHOD_NAME[payment.method]) })
          : payment.kind === "cash" ? t("dispatch.scanCashTaken", { amount: money({ amount: payment.collect, currencyCode: "KWD" }) })
          : t("dispatch.scanNothingOwed")}
      </p>
      {who}
      <p className="mt-2 text-[13px] font-semibold">{t("dispatch.scanHandedOver")}</p>
      {payment.kind === "online" && payment.test ? <p className="mt-1 text-[12px] text-[#6b4a12]">{t("dispatch.scanTestPaid")}</p> : null}
      <div className="mt-4">{again}</div>
    </div>
  );
}

/** The camera, read by the browser's own QR reader until it finds a token. */
function CameraReader({ onToken, onStop }: { onToken: (token: string) => void; onStop: () => void }) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [refused, setRefused] = useState(false);
  const [unknown, setUnknown] = useState(false);
  /* The latest answer to a find, so the camera is not restarted on every render. */
  const found = useRef(onToken);
  found.current = onToken;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let live = true;
    type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
    const Reader = (window as unknown as { BarcodeDetector: new (options: { formats: string[] }) => Detector }).BarcodeDetector;
    const reader = new Reader({ formats: ["qr_code"] });
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(got => {
        if (!live) { got.getTracks().forEach(track => track.stop()); return; }
        stream = got;
        if (video.current) {
          video.current.srcObject = got;
          void video.current.play().catch(() => {});
        }
        const look = () => {
          if (!live || !video.current) return;
          void reader.detect(video.current).then(codes => {
            const token = codes.map(one => tokenFromScan(one.rawValue)).find(Boolean);
            if (token) found.current(token);
            else {
              if (codes.length) setUnknown(true);
              timer = window.setTimeout(look, 250);
            }
          }).catch(() => { timer = window.setTimeout(look, 400); });
        };
        look();
      })
      .catch(() => setRefused(true));
    return () => {
      live = false;
      window.clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
    };
  }, []);

  return (
    <div className="space-y-3">
      {refused ? <Notice tone="warning">{t("dispatch.scanCameraRefused")}</Notice> : (
        <div className="overflow-hidden rounded-xl bg-[#0a1f45]">
          <video ref={video} muted playsInline aria-label={t("dispatch.scanCameraTitle")} className="aspect-square w-full object-cover" />
        </div>
      )}
      {unknown ? <p className="text-[13px] text-[#8c2f22]">{t("dispatch.scanNotNetLet")}</p> : null}
      <button type="button" onClick={onStop} className={buttonClass.secondary}>{t("dispatch.scanStopCamera")}</button>
    </div>
  );
}
