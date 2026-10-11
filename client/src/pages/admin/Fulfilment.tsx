/**
 * Fulfilled by NetLet (4.2): one page, two desks.
 *
 * A seller's manager sends stock — announces what is on its way, watches it
 * counted in, and sees what NetLet holds for them. NetLet runs the centres:
 * opens them, counts shipments in, picks and packs what sold, and sends stock
 * back. Which desk is drawn comes from `can()`, the function the server guards
 * with; the server refuses the other desk's procedures regardless.
 *
 * Until a centre is open the seller's desk says the programme has not started,
 * rather than offering a form that can send stock nowhere.
 */
import { fieldClass, PageHeader, Segmented, smallButtonClass } from "@/components/admin/ui";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Boxes, PackageCheck, PackageOpen, Search, Undo2, Warehouse, X } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { kuwaitDeliveryZones } from "@shared/customer";
import { MAX_INBOUND_UNITS, inboundProblem, validPackRate, type InboundStatus } from "@shared/commerce/netletFulfilment";
import type { MessageKey } from "@shared/i18n/dictionary";
import { can, type Actor } from "@shared/inventory/permissions";
import type { Governorate } from "@shared/inventory/storeProfile";
import { privatePageMeta } from "@shared/seo";

const field = `${fieldClass} mt-1.5`;
const card = "rounded-2xl border border-[#e1e7ef] bg-white p-4 text-[#0a285a] sm:p-5";

const STATUS_LABEL: Record<InboundStatus, MessageKey> = {
  announced: "fulfilment.statusAnnounced",
  received: "fulfilment.statusReceived",
  cancelled: "fulfilment.statusCancelled",
};

export default function AdminFulfilment() {
  usePageMeta(privatePageMeta("Fulfilled by NetLet"));
  return (
    <AdminShell need={["fulfilment.send", "fulfilment.operate"]}>
      {actor => (can(actor, "fulfilment.operate") ? <Operate /> : <Send actor={actor} />)}
    </AdminShell>
  );
}

function Heading({ note }: { note: MessageKey }) {
  const { t } = useTranslation();
  return (
    <PageHeader title={t("fulfilment.title")} description={t(note)} />
  );
}

/* ---------------------------------------------------------- the seller --- */

function Send({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const open = trpc.fulfilment.open.useQuery();
  return (
    <>
      <Heading note="fulfilment.sellerNote" />
      <QueryGate queries={[open]}>
        {() => open.data
          ? <Announce actor={actor} />
          : <p className={`${card} mt-5 text-[13px] leading-6`}>{t("fulfilment.notOpen")}</p>}
      </QueryGate>
      <Held operator={false} />
      <Shipments operator={false} />
      <Charges operator={false} />
    </>
  );
}

type Draft = { variantId: number; label: string; quantity: string };

function Announce({ actor }: { actor: Actor }) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const centres = trpc.fulfilment.centres.useQuery();
  const [centreId, setCentreId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<Draft[]>([]);
  const [note, setNote] = useState("");
  const results = trpc.fulfilment.sendable.useQuery({ query }, { placeholderData: previous => previous });
  const announce = trpc.fulfilment.announce.useMutation({
    onSuccess: shipment => {
      toast.success(t("fulfilment.announced", { reference: shipment.reference }));
      setLines([]); setNote("");
      void utils.fulfilment.shipments.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
  });

  const chosenCentre = centreId ?? centres.data?.[0]?.id ?? null;
  const parsed = lines.map(line => ({ variantId: line.variantId, quantity: Number(line.quantity) }));
  const problem = inboundProblem(parsed);

  return (
    <form
      className={`${card} mt-5`}
      onSubmit={event => {
        event.preventDefault();
        if (!problem && chosenCentre) announce.mutate({ centreId: chosenCentre, lines: parsed, note: note || null });
      }}
    >
      <h2 className="flex items-center gap-2 text-[16px] font-bold text-[#0a285a]"><PackageOpen className="size-4" aria-hidden />{t("fulfilment.sendTitle")}</h2>
      <p className="mt-1 text-[13px] leading-5 ink-muted">{t("fulfilment.sendNote")}</p>

      <label className="mt-3 block text-[13px] font-semibold text-[#0a285a]">
        {t("fulfilment.centre")}
        <select value={chosenCentre ?? ""} onChange={event => setCentreId(Number(event.target.value))} className={field}>
          {(centres.data ?? []).map(centre => <option key={centre.id} value={centre.id}>{centre.name}</option>)}
        </select>
      </label>

      <label className="mt-3 block text-[13px] font-semibold text-[#0a285a]">
        {t("fulfilment.findVariant")}
        <span className="relative block">
          <Search className="pointer-events-none absolute start-3 top-1/2 mt-0.5 size-4 -translate-y-1/2 ink-muted" aria-hidden />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} className={`${field} ps-9`} />
        </span>
      </label>
      <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto" aria-label={t("fulfilment.matches")}>
        {(results.data ?? []).map(variant => {
          const label = `${variant.productTitle} — ${variant.variantTitle}`;
          const blocked: MessageKey | null = variant.preorderStock > 0
            ? "fulfilment.blockedPreorder"
            : variant.centreId !== null && variant.centreId !== chosenCentre ? "fulfilment.blockedOtherCentre" : null;
          const added = lines.some(line => line.variantId === variant.variantId);
          return (
            <li key={variant.variantId} className="flex items-center justify-between gap-3 rounded-xl bg-[#f6f8fb] px-3 py-2 text-[12px]">
              <span className="min-w-0">
                <span dir="auto" className="block truncate font-bold">{label}</span>
                <span className="ink-muted">
                  {variant.sku ? <bdi dir="ltr">{variant.sku}</bdi> : null}
                  {variant.sku ? " · " : null}
                  {variant.centreId !== null ? t("fulfilment.alreadyHeld", { count: variant.stock }) : t("fulfilment.yourShelf", { count: variant.stock })}
                  {blocked ? <> · {t(blocked)}</> : null}
                </span>
              </span>
              <button
                type="button"
                disabled={Boolean(blocked) || added}
                onClick={() => setLines([...lines, { variantId: variant.variantId, label, quantity: "1" }])}
                className={`${smallButtonClass.secondary} shrink-0`}
              >
                {t(added ? "fulfilment.added" : "fulfilment.add")}
              </button>
            </li>
          );
        })}
      </ul>

      {lines.length ? (
        <table className="mt-4 w-full text-[12px]">
          <caption className="sr-only">{t("fulfilment.onThisShipment")}</caption>
          <thead>
            <tr className="ink-muted">
              <th scope="col" className="py-1 text-start font-bold">{t("fulfilment.item")}</th>
              <th scope="col" className="w-28 py-1 text-start font-bold">{t("fulfilment.sending")}</th>
              <th scope="col" className="w-10"><span className="sr-only">{t("fulfilment.remove")}</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.variantId} className="border-t border-[#eef1f6]">
                <td dir="auto" className="py-2 pe-2">{line.label}</td>
                <td className="py-2">
                  <input
                    dir="ltr"
                    inputMode="numeric"
                    aria-label={t("fulfilment.sendingFor", { item: line.label })}
                    value={line.quantity}
                    onChange={event => setLines(lines.map((entry, i) => i === index ? { ...entry, quantity: event.target.value.replace(/[^\d]/g, "") } : entry))}
                    className={`${field} mt-0`}
                  />
                </td>
                <td className="py-2 text-end">
                  <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))} aria-label={t("fulfilment.removeItem", { item: line.label })} className="pressable inline-grid size-9 place-items-center rounded-full">
                    <X className="size-4" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {problem && lines.length ? <p className="mt-2 text-[12px] font-bold text-[#8c2f22]">{t(problem, { max: MAX_INBOUND_UNITS })}</p> : null}

      <label className="mt-3 block text-[13px] font-semibold text-[#0a285a]">
        {t("fulfilment.note")}
        <textarea dir="auto" maxLength={500} value={note} onChange={event => setNote(event.target.value)} className={`${field} min-h-16`} />
      </label>
      <button type="submit" disabled={Boolean(problem) || !chosenCentre || announce.isPending || !can(actor, "fulfilment.send")} className={`${smallButtonClass.primary} mt-3`}>
        {t("fulfilment.announce")}
      </button>
    </form>
  );
}

/* -------------------------------------------------------------- NetLet --- */

function Operate() {
  return (
    <>
      <Heading note="fulfilment.operatorNote" />
      <PickList />
      <Shipments operator />
      <Held operator />
      <Charges operator />
      <Centres />
    </>
  );
}

function Centres() {
  const { t, tError, isArabic } = useTranslation();
  const utils = trpc.useUtils();
  const centres = trpc.fulfilment.centres.useQuery();
  const [draft, setDraft] = useState({ name: "", governorate: kuwaitDeliveryZones[0]?.id ?? "capital", addressLine: "" });
  const refresh = () => { void utils.fulfilment.centres.invalidate(); void utils.fulfilment.open.invalidate(); };
  const create = trpc.fulfilment.createCentre.useMutation({
    onSuccess: () => { toast.success(t("admin.saved")); setDraft({ ...draft, name: "", addressLine: "" }); refresh(); },
    onError: error => toast.error(tError(error.message)),
  });
  const toggle = trpc.fulfilment.setCentreActive.useMutation({ onSuccess: refresh, onError: error => toast.error(tError(error.message)) });
  const zoneName = (id: string) => kuwaitDeliveryZones.find(zone => zone.id === id)?.[isArabic ? "labelAr" : "label"] ?? id;

  return (
    <section className={`${card} mt-5`} aria-labelledby="centres-title">
      <h2 id="centres-title" className="flex items-center gap-2 text-[16px] font-bold text-[#0a285a]"><Warehouse className="size-4" aria-hidden />{t("fulfilment.centres")}</h2>
      <p className="mt-1 text-[13px] leading-5 ink-muted">{t("fulfilment.centresNote")}</p>
      <QueryGate queries={[centres]}>
        {() => (
          <ul className="mt-3 space-y-2">
            {(centres.data ?? []).map(centre => (
              <li key={centre.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f6f8fb] px-3 py-2 text-[12px]">
                <span>
                  <span dir="auto" className="font-bold">{centre.name}</span>
                  <span className="ink-muted"> · {zoneName(centre.governorate)} · <bdi>{centre.addressLine}</bdi></span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <PackRate centreId={centre.id} rate={centre.packFeePerUnit} name={centre.name} />
                  <button type="button" onClick={() => toggle.mutate({ id: centre.id, active: !centre.active })} className={smallButtonClass.secondary}>
                    {t(centre.active ? "fulfilment.closeCentre" : "fulfilment.reopenCentre")}
                  </button>
                </span>
              </li>
            ))}
            {centres.data?.length ? null : <li className="text-[12px] ink-muted">{t("fulfilment.noCentres")}</li>}
          </ul>
        )}
      </QueryGate>
      <form
        className="mt-3 grid gap-2 sm:grid-cols-3"
        onSubmit={event => { event.preventDefault(); if (draft.name.trim() && draft.addressLine.trim()) create.mutate({ ...draft, governorate: draft.governorate as Governorate }); }}
      >
        <label className="text-[13px] font-semibold text-[#0a285a]">{t("fulfilment.centreName")}<input dir="auto" value={draft.name} maxLength={120} onChange={event => setDraft({ ...draft, name: event.target.value })} className={field} /></label>
        <label className="text-[13px] font-semibold text-[#0a285a]">
          {t("admin.governorate")}
          <select value={draft.governorate} onChange={event => setDraft({ ...draft, governorate: event.target.value })} className={field}>
            {kuwaitDeliveryZones.map(zone => <option key={zone.id} value={zone.id}>{isArabic ? zone.labelAr : zone.label}</option>)}
          </select>
        </label>
        <label className="text-[13px] font-semibold text-[#0a285a]">{t("admin.addressLine")}<input dir="auto" value={draft.addressLine} maxLength={300} onChange={event => setDraft({ ...draft, addressLine: event.target.value })} className={field} /></label>
        <div className="sm:col-span-3">
          <button type="submit" disabled={!draft.name.trim() || !draft.addressLine.trim() || create.isPending} className={smallButtonClass.primary}>{t("fulfilment.openCentre")}</button>
        </div>
      </form>
    </section>
  );
}

function PickList() {
  const { t, tError } = useTranslation();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const picks = trpc.fulfilment.pickList.useQuery();
  const packed = trpc.fulfilment.markPacked.useMutation({
    onSuccess: result => { toast.success(t("fulfilment.packedToast", { count: result.packed })); void utils.fulfilment.pickList.invalidate(); void utils.fulfilment.waiting.invalidate(); },
    onError: error => toast.error(tError(error.message)),
  });
  return (
    <section className={`${card} mt-5`} aria-labelledby="pick-title">
      <h2 id="pick-title" className="flex items-center gap-2 text-[16px] font-bold text-[#0a285a]"><PackageCheck className="size-4" aria-hidden />{t("fulfilment.pickTitle")}</h2>
      <p className="mt-1 text-[13px] leading-5 ink-muted">{t("fulfilment.pickNote")}</p>
      <QueryGate queries={[picks]}>
        {() => {
          const data = picks.data!;
          if (data.orders.length === 0) return <p className="mt-3 text-[13px] ink-muted">{t("fulfilment.nothingToPick")}</p>;
          return (
            <>
              <ul className="mt-3 space-y-2">
                {data.orders.map(order => (
                  <li key={`${order.orderId}-${order.centreId}`} className="rounded-xl bg-[#f6f8fb] px-3 py-2 text-[12px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-bold"><bdi dir="ltr">{order.reference}</bdi> <span className="font-normal ink-muted">· <bdi>{order.centreName}</bdi> · {formatDate(order.placedAt)}</span></p>
                      <button type="button" disabled={packed.isPending} onClick={() => packed.mutate({ orderId: order.orderId, centreId: order.centreId })} className={smallButtonClass.primary}>{t("fulfilment.markPacked")}</button>
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {order.lines.map(line => (
                        <li key={line.lineId}>
                          <strong className="inline-block min-w-8"><bdi dir="ltr">{line.quantity}×</bdi></strong>{" "}
                          <span dir="auto">{line.productTitle}{line.variantTitle ? ` — ${line.variantTitle}` : ""}</span>
                          {line.sku ? <span className="ink-muted"> · <bdi dir="ltr">{line.sku}</bdi></span> : null}
                          {line.vendorName ? <span className="ink-muted"> · <bdi>{line.vendorName}</bdi></span> : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              {data.truncated ? <p className="mt-2 text-[12px] ink-muted">{t("fulfilment.pickTruncated")}</p> : null}
            </>
          );
        }}
      </QueryGate>
    </section>
  );
}

function Shipments({ operator }: { operator: boolean }) {
  const { t, tError } = useTranslation();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<InboundStatus | undefined>(operator ? "announced" : undefined);
  const [page, setPage] = useState(1);
  const shipments = trpc.fulfilment.shipments.useQuery({ status, page }, { placeholderData: previous => previous });
  const cancel = trpc.fulfilment.cancel.useMutation({ onSuccess: () => void utils.fulfilment.shipments.invalidate(), onError: error => toast.error(tError(error.message)) });

  return (
    <section className={`${card} mt-5`} aria-labelledby="shipments-title">
      <h2 id="shipments-title" className="flex items-center gap-2 text-[16px] font-bold text-[#0a285a]"><Boxes className="size-4" aria-hidden />{t(operator ? "fulfilment.toReceive" : "fulfilment.yourShipments")}</h2>
      <Segmented
        label={t("fulfilment.yourShipments")}
        className="mt-3 w-fit"
        value={status ?? "all"}
        onChange={entry => { setStatus(entry === "all" ? undefined : entry); setPage(1); }}
        options={(["all", "announced", "received", "cancelled"] as const).map(entry => ({ value: entry, label: entry === "all" ? t("support.filterAll") : t(STATUS_LABEL[entry]) }))}
      />
      <QueryGate queries={[shipments]}>
        {() => {
          const result = shipments.data!;
          if (result.rows.length === 0) return <p className="mt-3 text-[13px] ink-muted">{t("fulfilment.noShipments")}</p>;
          return (
            <>
              <ul className="mt-3 space-y-3">
                {result.rows.map(shipment => (
                  <li key={shipment.id} className="rounded-xl border border-[#eef1f6] px-3 py-2 text-[12px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-bold">
                        <bdi dir="ltr">{shipment.reference}</bdi>
                        <span className="font-normal ink-muted"> · {operator ? <><bdi>{shipment.vendorName}</bdi> · </> : null}<bdi>{shipment.centreName}</bdi> · {formatDate(shipment.createdAt)}</span>
                      </p>
                      <span className="inline-flex rounded-full bg-[#e7edf5] px-2.5 py-1 text-[12px] leading-none font-semibold text-[#0a285a]">{t(STATUS_LABEL[shipment.status])}</span>
                    </div>
                    {shipment.note ? <p dir="auto" className="mt-1 ink-muted">{shipment.note}</p> : null}
                    {operator && shipment.status === "announced"
                      ? <Receive shipment={shipment} />
                      : <ShipmentLines lines={shipment.lines} />}
                    {!operator && shipment.status === "announced" ? (
                      <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate({ id: shipment.id })} className={`${smallButtonClass.secondary} mt-2`}>{t("fulfilment.cancelShipment")}</button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="mt-3"><Pager page={result} onPage={setPage} /></div>
            </>
          );
        }}
      </QueryGate>
    </section>
  );
}

type ShipmentLine = { id: number; productTitle: string; variantTitle: string; sku: string | null; expected: number; received: number | null; short: number; over: number };

function ShipmentLines({ lines }: { lines: ShipmentLine[] }) {
  const { t } = useTranslation();
  return (
    <ul className="mt-2 space-y-1">
      {lines.map(line => (
        <li key={line.id} className="flex flex-wrap justify-between gap-2">
          <span dir="auto">{line.productTitle} — {line.variantTitle}{line.sku ? <span className="ink-muted"> · <bdi dir="ltr">{line.sku}</bdi></span> : null}</span>
          <span className="ink-muted">
            {line.received === null
              ? t("fulfilment.expectedOnly", { expected: line.expected })
              : t("fulfilment.counted", { expected: line.expected, received: line.received })}
            {line.short ? <strong className="text-[#8c2f22]"> · {t("fulfilment.short", { count: line.short })}</strong> : null}
            {line.over ? <strong className="text-[#0a285a]"> · {t("fulfilment.over", { count: line.over })}</strong> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Receive({ shipment }: { shipment: { id: number; reference: string; lines: ShipmentLine[] } }) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const [counts, setCounts] = useState<Record<number, string>>(() => Object.fromEntries(shipment.lines.map(line => [line.id, String(line.expected)])));
  const [asking, setAsking] = useState(false);
  const receive = trpc.fulfilment.receive.useMutation({
    onSuccess: result => {
      toast.success(t("fulfilment.receivedToast", { count: result.received }));
      setAsking(false);
      void utils.fulfilment.shipments.invalidate(); void utils.fulfilment.held.invalidate(); void utils.fulfilment.waiting.invalidate();
    },
    onError: error => { setAsking(false); toast.error(tError(error.message)); },
  });
  const parsed = shipment.lines.map(line => ({ lineId: line.id, received: Number(counts[line.id]) }));
  const valid = parsed.every(count => counts[count.lineId] !== "" && Number.isInteger(count.received) && count.received >= 0 && count.received <= MAX_INBOUND_UNITS);

  return (
    <>
      <table className="mt-2 w-full text-[12px]">
        <caption className="sr-only">{t("fulfilment.countIn", { reference: shipment.reference })}</caption>
        <thead>
          <tr className="ink-muted">
            <th scope="col" className="py-1 text-start font-bold">{t("fulfilment.item")}</th>
            <th scope="col" className="w-20 py-1 text-start font-bold">{t("fulfilment.expected")}</th>
            <th scope="col" className="w-28 py-1 text-start font-bold">{t("fulfilment.countedColumn")}</th>
          </tr>
        </thead>
        <tbody>
          {shipment.lines.map(line => (
            <tr key={line.id} className="border-t border-[#eef1f6]">
              <td dir="auto" className="py-2 pe-2">{line.productTitle} — {line.variantTitle}</td>
              <td className="px-2 py-2"><bdi dir="ltr">{line.expected}</bdi></td>
              <td className="py-2">
                <input
                  dir="ltr"
                  inputMode="numeric"
                  aria-label={t("fulfilment.countFor", { item: `${line.productTitle} — ${line.variantTitle}` })}
                  value={counts[line.id] ?? ""}
                  onChange={event => setCounts({ ...counts, [line.id]: event.target.value.replace(/[^\d]/g, "") })}
                  className={`${field} mt-0`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" disabled={!valid || receive.isPending} onClick={() => setAsking(true)} className={`${smallButtonClass.primary} mt-2`}>{t("fulfilment.recordCount")}</button>
      <ConfirmDialog
        open={asking}
        title={t("fulfilment.recordCountTitle", { reference: shipment.reference })}
        body={t("fulfilment.recordCountBody")}
        confirmLabel={t("fulfilment.recordCount")}
        pending={receive.isPending}
        onConfirm={() => receive.mutate({ id: shipment.id, counts: parsed })}
        onClose={() => setAsking(false)}
      />
    </>
  );
}

function Held({ operator }: { operator: boolean }) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const held = trpc.fulfilment.held.useQuery({ page }, { placeholderData: previous => previous });
  const [sending, setSending] = useState<{ variantId: number; label: string; stock: number } | null>(null);
  const back = trpc.fulfilment.returnToSeller.useMutation({
    onSuccess: () => { setSending(null); toast.success(t("fulfilment.sentBackToast")); void utils.fulfilment.held.invalidate(); },
    onError: error => { setSending(null); toast.error(tError(error.message)); },
  });
  const title = useMemo(() => t(operator ? "fulfilment.heldAll" : "fulfilment.heldYours"), [operator, t]);

  return (
    <section className={`${card} mt-5`} aria-labelledby="held-title">
      <h2 id="held-title" className="flex items-center gap-2 text-[16px] font-bold text-[#0a285a]"><Warehouse className="size-4" aria-hidden />{title}</h2>
      <QueryGate queries={[held]}>
        {() => {
          const result = held.data!;
          if (result.rows.length === 0) return <p className="mt-3 text-[13px] ink-muted">{t("fulfilment.nothingHeld")}</p>;
          return (
            <>
              <ul className="mt-3 space-y-1">
                {result.rows.map(row => (
                  <li key={row.variantId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f6f8fb] px-3 py-2 text-[12px]">
                    <span className="min-w-0">
                      <span dir="auto" className="font-bold">{row.productTitle} — {row.variantTitle}</span>
                      <span className="ink-muted">
                        {row.sku ? <> · <bdi dir="ltr">{row.sku}</bdi></> : null}
                        {operator ? <> · <bdi>{row.vendorName}</bdi></> : null}
                        {" · "}<bdi>{row.centreName}</bdi>
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <strong>{t("fulfilment.onShelf", { count: row.stock })}</strong>
                      {operator ? (
                        <button type="button" onClick={() => setSending({ variantId: row.variantId, label: `${row.productTitle} — ${row.variantTitle}`, stock: row.stock })} className={smallButtonClass.secondary}>
                          <Undo2 className="size-3.5" aria-hidden />{t("fulfilment.sendBack")}
                        </button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3"><Pager page={result} onPage={setPage} /></div>
            </>
          );
        }}
      </QueryGate>
      <ConfirmDialog
        open={sending !== null}
        title={t("fulfilment.sendBackTitle", { item: sending?.label ?? "" })}
        body={t("fulfilment.sendBackBody", { count: sending?.stock ?? 0 })}
        confirmLabel={t("fulfilment.sendBack")}
        tone="danger"
        pending={back.isPending}
        onConfirm={() => sending && back.mutate({ variantId: sending.variantId })}
        onClose={() => setSending(null)}
      />
    </section>
  );
}

/** A centre's packing rate per unit (4.2). Blank charges nothing — the rate is a contract, not a default. */
function PackRate({ centreId, rate, name }: { centreId: number; rate: string | null; name: string }) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const [value, setValue] = useState(rate ?? "");
  const ok = value.trim() === "" || validPackRate(value.trim());
  const save = trpc.fulfilment.setPackRate.useMutation({
    onSuccess: () => { toast.success(t("admin.saved")); void utils.fulfilment.centres.invalidate(); },
    onError: error => toast.error(tError(error.message)),
  });
  return (
    <form className="flex items-center gap-1.5" onSubmit={event => { event.preventDefault(); if (ok) save.mutate({ id: centreId, rate: value.trim() || null }); }}>
      <label className="text-[13px] font-semibold text-[#0a285a]">
        <span className="sr-only">{t("fulfilment.packRateFor", { centre: name })}</span>
        <input dir="ltr" inputMode="decimal" value={value} placeholder={t("fulfilment.packRatePlaceholder")} aria-invalid={!ok} onChange={event => setValue(event.target.value)} className={`${fieldClass} h-9 w-28`} />
      </label>
      <button type="submit" disabled={!ok || save.isPending} className={smallButtonClass.secondary}>{t("fulfilment.setRate")}</button>
    </form>
  );
}

/** Packing charges (4.2): what NetLet charged for packing, and whether a payout run has taken it yet. */
function Charges({ operator }: { operator: boolean }) {
  const { t } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const [page, setPage] = useState(1);
  const charges = trpc.fulfilment.charges.useQuery({ page }, { placeholderData: previous => previous });
  return (
    <section className={`${card} mt-5`} aria-labelledby="charges-title">
      <h2 id="charges-title" className="text-[16px] font-bold text-[#0a285a]">{t("fulfilment.chargesTitle")}</h2>
      <p className="mt-1 text-[13px] leading-5 ink-muted">{t("fulfilment.chargesNote")}</p>
      <QueryGate queries={[charges]}>
        {() => {
          const result = charges.data!;
          if (result.rows.length === 0) return <p className="mt-3 text-[13px] ink-muted">{t("fulfilment.noCharges")}</p>;
          return (
            <>
              <ul className="mt-3 space-y-1">
                {result.rows.map(row => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f6f8fb] px-3 py-2 text-[12px]">
                    <span>
                      <bdi dir="ltr" className="font-bold">{row.reference}</bdi>
                      <span className="ink-muted"> · <bdi dir="ltr">{row.orderReference}</bdi>{operator ? <> · <bdi>{row.vendorName}</bdi></> : null} · <bdi>{row.centreName}</bdi> · {formatDate(row.createdAt)}</span>
                      <span className="block ink-muted">{t("fulfilment.chargeUnits", { units: row.units, rate: money(row.ratePerUnit) })}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <strong><bdi>{money(row.amount)}</bdi></strong>
                      <span className="inline-flex rounded-full bg-[#e7edf5] px-2.5 py-1 text-[12px] leading-none font-semibold text-[#0a285a]">{t(row.deducted ? "fulfilment.chargeTaken" : "fulfilment.chargeNext")}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3"><Pager page={result} onPage={setPage} /></div>
            </>
          );
        }}
      </QueryGate>
    </section>
  );
}
