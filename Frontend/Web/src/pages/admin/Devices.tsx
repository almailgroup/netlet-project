/**
 * The owner's Devices page (`Shared/auth/adminDevice.ts`), on the owner's
 * word: "let me choose the authorised devices and later on … revoke access
 * … under my control, to check who is signed in and when".
 *
 * Only the owner, on an authorised device, opens it (`platform.devices`). It
 * lists every device waiting, with Approve and Turn down; every authorised
 * device, with who it is for, when it was authorised and how, when it last
 * signed in and was last active, and from where, with Rename and Remove;
 * those turned down or removed, with Allow again; and the recent sign-ins to
 * the admin side from the audit trail. Removing asks first, and says so when
 * it is the device the owner is reading on.
 */
import { Check, LoaderCircle, Monitor, Pencil, ShieldOff, Smartphone, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { EmptyState, fieldClass, isolate, Notice, PageHeader, Pill, SectionHeading, smallButtonClass, tableClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDateTimeFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../Backend/src/routes";
import { DEVICE_NAME_MAX } from "@shared/auth/adminDevice";
import type { MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";

type Desk = inferRouterOutputs<AppRouter>["devices"]["desk"];
type Device = Desk["devices"][number];
type Decision = "approve" | "deny" | "revoke";

export default function AdminDevices() {
  usePageMeta(privatePageMeta("Devices"));
  return <AdminShell need="platform.devices">{() => <DevicesDesk />}</AdminShell>;
}

const OUTCOME: Record<Desk["signIns"][number]["outcome"], { label: MessageKey; tone: "good" | "warning" | "danger" | "neutral" }> = {
  authorised: { label: "devices.outcomeAuthorised", tone: "good" },
  waiting: { label: "devices.outcomeWaiting", tone: "warning" },
  refused: { label: "devices.outcomeRefused", tone: "danger" },
  unknown: { label: "devices.outcomeUnknown", tone: "neutral" },
};

function DevicesDesk() {
  const { t } = useTranslation();
  const desk = trpc.devices.desk.useQuery(undefined, { refetchInterval: 15_000 });
  return (
    <>
      <PageHeader title={t("devices.title")} description={t("devices.intro")} />
      <QueryGate queries={[desk]}>
        {() => (desk.data ? <DeskBody desk={desk.data} /> : null)}
      </QueryGate>
    </>
  );
}

function DeskBody({ desk }: { desk: Desk }) {
  const { t } = useTranslation();
  if (!desk.ready) return <Notice tone="warning">{t("devices.closedDesk")}</Notice>;
  const waiting = desk.devices.filter(device => device.status === "pending");
  const authorised = desk.devices.filter(device => device.status === "approved");
  const ended = desk.devices.filter(device => device.status === "denied" || device.status === "revoked");
  return (
    <div className="space-y-8">
      <section aria-labelledby="devices-waiting">
        <SectionHeading><span id="devices-waiting">{t("devices.waitingHeading")}</span></SectionHeading>
        {waiting.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">
            {waiting.map(device => <WaitingCard key={device.id} device={device} />)}
          </ul>
        ) : (
          <EmptyState title={t("devices.noneWaiting")} />
        )}
      </section>

      <section aria-labelledby="devices-authorised">
        <SectionHeading description={t("devices.authorisedNote")}><span id="devices-authorised">{t("devices.authorisedHeading")}</span></SectionHeading>
        {authorised.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">
            {authorised.map(device => <AuthorisedCard key={device.id} device={device} />)}
          </ul>
        ) : (
          <EmptyState title={t("devices.noneAuthorised")} />
        )}
      </section>

      {ended.length ? (
        <section aria-labelledby="devices-ended">
          <SectionHeading><span id="devices-ended">{t("devices.endedHeading")}</span></SectionHeading>
          <ul className="grid gap-3 lg:grid-cols-2">
            {ended.map(device => <EndedCard key={device.id} device={device} />)}
          </ul>
        </section>
      ) : null}

      <SignIns entries={desk.signIns} />
    </div>
  );
}

/** Who a device is for, and what it is. */
function DeviceHead({ device }: { device: Device }) {
  const { t } = useTranslation();
  const Icon = /iPhone|iPad|Android/.test(device.name ?? "") ? Smartphone : Monitor;
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#e7edf5] text-[#0a285a]" aria-hidden>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-[#0a285a]">
          <bdi className="break-words">{device.name ?? t("devices.unnamed")}</bdi>
          {device.current ? <Pill tone="navy">{t("devices.thisOne")}</Pill> : null}
        </p>
        <p className="mt-0.5 text-[14px] text-[#3d5170]">
          <bdi dir="ltr">{device.account ?? `#${device.userId}`}</bdi>
          {device.owner ? <span className="ms-2"><Pill tone="neutral">{t("devices.yourAccount")}</Pill></span> : null}
        </p>
      </div>
    </div>
  );
}

function Facts({ rows }: { rows: [MessageKey, string | null][] }) {
  const { t } = useTranslation();
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px] leading-5">
      {rows.filter(([, value]) => value).map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="ink-muted">{t(label)}</dt>
          <dd className="min-w-0 break-words text-[#0a285a]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function useDecide() {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const decide = trpc.devices.decide.useMutation({
    onSuccess: answer => {
      toast.success(t(answer.status === "approved" ? "devices.approvedToast" : answer.status === "denied" ? "devices.deniedToast" : "devices.revokedToast"));
      void utils.devices.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
  });
  return decide;
}

function WaitingCard({ device }: { device: Device }) {
  const { t } = useTranslation();
  const when = useDateTimeFormat();
  const decide = useDecide();
  const busy = decide.isPending ? decide.variables?.decision : null;
  return (
    <li>
      <div className="rounded-2xl border border-[#e3e8f0] bg-white shadow-[0_1px_2px_rgba(10,40,90,0.05)] px-5 py-5 sm:px-6">
        <DeviceHead device={device} />
        <Facts rows={[["devices.askedAt", when(device.createdAt)], ["devices.address", device.requestedIp]]} />
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => decide.mutate({ id: device.id, decision: "approve" })} disabled={decide.isPending} className={smallButtonClass.primary}>
            {busy === "approve" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            {t("devices.approve")}
          </button>
          <button type="button" onClick={() => decide.mutate({ id: device.id, decision: "deny" })} disabled={decide.isPending} className={smallButtonClass.quietDanger}>
            {busy === "deny" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <X className="size-4" aria-hidden />}
            {t("devices.deny")}
          </button>
        </div>
      </div>
    </li>
  );
}

function AuthorisedCard({ device }: { device: Device }) {
  const { t, tError } = useTranslation();
  const when = useDateTimeFormat();
  const decide = useDecide();
  const utils = trpc.useUtils();
  const [removing, setRemoving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(device.name ?? "");
  const rename = trpc.devices.rename.useMutation({
    onSuccess: () => { toast.success(t("devices.renamedToast")); setRenaming(false); void utils.devices.invalidate(); },
    onError: error => toast.error(tError(error.message)),
  });
  const how = device.approvedHow === "email-code" ? t("devices.howCode") : device.approvedHow === "owner" ? t("devices.howOwner") : null;
  const label = `${device.account ?? device.userId} · ${device.name ?? ""}`;
  return (
    <li>
      <div className="rounded-2xl border border-[#e3e8f0] bg-white shadow-[0_1px_2px_rgba(10,40,90,0.05)] px-5 py-5 sm:px-6">
        <DeviceHead device={device} />
        <Facts
          rows={[
            ["devices.authorisedAt", device.decidedAt ? `${when(device.decidedAt)}${how ? ` · ${how}` : ""}` : null],
            ["devices.lastSignIn", device.lastSignInAt ? when(device.lastSignInAt) : t("devices.never")],
            ["devices.lastActive", device.lastSeenAt ? when(device.lastSeenAt) : t("devices.never")],
            ["devices.address", device.lastIp ?? device.requestedIp],
          ]}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => { setName(device.name ?? ""); setRenaming(true); }} className={smallButtonClass.secondary}>
            <Pencil className="size-4" aria-hidden />{t("devices.rename")}
          </button>
          <button type="button" onClick={() => setRemoving(true)} className={smallButtonClass.quietDanger}>
            <ShieldOff className="size-4" aria-hidden />{t("devices.revoke")}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={removing}
        tone="danger"
        icon={<ShieldOff className="size-5" />}
        title={t("devices.revokeTitle")}
        body={t(device.current ? "devices.revokeBodyCurrent" : "devices.revokeBody", { device: isolate(label) })}
        confirmLabel={t("devices.revoke")}
        pending={decide.isPending}
        onClose={() => setRemoving(false)}
        onConfirm={() => decide.mutate({ id: device.id, decision: "revoke" }, { onSettled: () => setRemoving(false) })}
      />
      <ConfirmDialog
        open={renaming}
        title={t("devices.renameTitle")}
        body={t("devices.renameBody")}
        confirmLabel={t("devices.save")}
        pending={rename.isPending}
        confirmDisabled={!name.trim()}
        onClose={() => setRenaming(false)}
        onConfirm={() => rename.mutate({ id: device.id, name })}
      >
        <label className="mt-4 block text-start">
          <span className="text-[13px] font-semibold text-[#0a285a]">{t("devices.nameLabel")}</span>
          <input value={name} onChange={event => setName(event.target.value)} maxLength={DEVICE_NAME_MAX} className={`mt-1.5 ${fieldClass}`} autoComplete="off" />
        </label>
        {!name.trim() ? <p className="mt-2 text-start text-[13px] text-[#8c2f22]">{t("devices.nameEmpty")}</p> : null}
      </ConfirmDialog>
    </li>
  );
}

function EndedCard({ device }: { device: Device }) {
  const { t } = useTranslation();
  const when = useDateTimeFormat();
  const decide = useDecide();
  return (
    <li>
      <div className="rounded-2xl border border-[#e3e8f0] bg-white shadow-[0_1px_2px_rgba(10,40,90,0.05)] px-5 py-5 sm:px-6">
        <DeviceHead device={device} />
        <Facts rows={[[device.status === "denied" ? "devices.deniedAt" : "devices.revokedAt", device.decidedAt ? when(device.decidedAt) : null], ["devices.address", device.lastIp ?? device.requestedIp]]} />
        <div className="mt-4">
          <button type="button" onClick={() => decide.mutate({ id: device.id, decision: "approve" })} disabled={decide.isPending} className={smallButtonClass.secondary}>
            {decide.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            {t("devices.allowAgain")}
          </button>
        </div>
      </div>
    </li>
  );
}

function SignIns({ entries }: { entries: Desk["signIns"] }) {
  const { t } = useTranslation();
  const when = useDateTimeFormat();
  return (
    <section>
      <SectionHeading description={t("devices.signInsNote")}><span id="devices-signins">{t("devices.signInsHeading")}</span></SectionHeading>
      {entries.length ? (
        <div className={tableClass.wrap} role="region" aria-labelledby="devices-signins" tabIndex={0}>
          <table className={tableClass.table}>
            <thead className={tableClass.head}>
              <tr>
                <th className={tableClass.th}>{t("devices.colWhen")}</th>
                <th className={tableClass.th}>{t("devices.colAccount")}</th>
                <th className={tableClass.th}>{t("devices.colDevice")}</th>
                <th className={tableClass.th}>{t("devices.colAddress")}</th>
                <th className={tableClass.th}>{t("devices.colOutcome")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.id} className={tableClass.row}>
                  <td className={`${tableClass.td} whitespace-nowrap`}>{when(entry.at)}</td>
                  <td className={tableClass.td}><bdi dir="ltr">{entry.account ?? "—"}</bdi></td>
                  <td className={tableClass.td}><bdi>{entry.device ?? "—"}</bdi></td>
                  <td className={tableClass.td}><bdi dir="ltr">{entry.address ?? "—"}</bdi></td>
                  <td className={tableClass.td}><Pill tone={OUTCOME[entry.outcome].tone}>{t(OUTCOME[entry.outcome].label)}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title={t("devices.noSignIns")} />
      )}
    </section>
  );
}
