/**
 * The owner's Devices page (`Shared/auth/adminDevice.ts`), on the owner's
 * word: "let me choose the authorised devices and later on … revoke access
 * … under my control, to check who is signed in and when".
 *
 * Only the owner, on an authorised device, opens it (`platform.devices`).
 * Three lists under their counts: devices **waiting** (Approve, or Decline),
 * devices **authorised** (who each is for, when and how it was authorised,
 * when it last signed in and was last active and from where, "Active now"
 * while it is in use; Rename, or Remove) and devices **blocked** (Unblock, or
 * Authorise); then the recent sign-ins to the admin side from the audit trail.
 *
 * **Taking a device off asks what happens afterwards, on the owner's word**
 * ("decide whether they can be logged in and added again or blocked
 * forever"): Decline and Remove each open a question with two answers — it
 * can ask again, which takes it off the list altogether, or block it for
 * good, which moves it to the blocked list. The safer answer is chosen to
 * start with. The device the owner is on can be removed but not blocked: a
 * block there could only be undone from another device. A device that asks
 * says so when its account or its address already has a blocked device.
 * "Remove all other devices" is the one press for a password that may have
 * leaked.
 */
import { Ban, Check, LoaderCircle, Monitor, Pencil, ShieldOff, Smartphone, Undo2, X } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, EmptyState, fieldClass, isolate, Notice, PageHeader, Pill, SectionHeading, smallButtonClass, Stat, StatGrid, tableClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDateTimeFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../Backend/src/routes";
import { DEVICE_NAME_MAX, deviceActive, isBlocked, type DeviceMove } from "@shared/auth/adminDevice";
import type { MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";

type Desk = inferRouterOutputs<AppRouter>["devices"]["desk"];
type Device = Desk["devices"][number];
/** What happens to a device after it is declined or removed. */
type Afterwards = "askAgain" | "block";

const CARD = "rounded-2xl border border-[#e3e8f0] bg-white px-5 py-5 shadow-[0_1px_2px_rgba(10,40,90,0.05)] sm:px-6";

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
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const desk = trpc.devices.desk.useQuery(undefined, { refetchInterval: 15_000 });
  const [clearing, setClearing] = useState(false);
  const removeOthers = trpc.devices.removeOthers.useMutation({
    onSuccess: answer => {
      toast.success(t(answer.removed ? "devices.removedOthersToast" : "devices.noOthersToast"));
      void utils.devices.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
    onSettled: () => setClearing(false),
  });
  const authorised = desk.data?.devices.filter(device => device.status === "approved") ?? [];
  const others = authorised.some(device => device.current) && authorised.some(device => !device.current);
  return (
    <>
      <PageHeader
        title={t("devices.title")}
        description={t("devices.intro")}
        actions={others ? (
          <button type="button" onClick={() => setClearing(true)} className={buttonClass.quietDanger}>
            <ShieldOff className="size-4" aria-hidden />{t("devices.removeOthers")}
          </button>
        ) : undefined}
      />
      <QueryGate queries={[desk]}>
        {() => (desk.data ? <DeskBody desk={desk.data} /> : null)}
      </QueryGate>
      <ConfirmDialog
        open={clearing}
        tone="danger"
        icon={<ShieldOff className="size-5" />}
        title={t("devices.removeOthersTitle")}
        body={t("devices.removeOthersBody")}
        confirmLabel={t("devices.removeOthers")}
        pending={removeOthers.isPending}
        onClose={() => setClearing(false)}
        onConfirm={() => removeOthers.mutate()}
      />
    </>
  );
}

function DeskBody({ desk }: { desk: Desk }) {
  const { t } = useTranslation();
  if (!desk.ready) return <Notice tone="warning">{t("devices.closedDesk")}</Notice>;
  const waiting = desk.devices.filter(device => device.status === "pending");
  const authorised = desk.devices.filter(device => device.status === "approved");
  const blocked = desk.devices.filter(device => isBlocked(device.status));
  return (
    <div className="space-y-8">
      <StatGrid>
        <Stat label={t("devices.waitingHeading")} value={waiting.length} href="#devices-waiting" tone={waiting.length ? "warning" : "normal"} />
        <Stat label={t("devices.authorisedHeading")} value={authorised.length} href="#devices-authorised" />
        <Stat label={t("devices.endedHeading")} value={desk.blockedTotal} href="#devices-blocked" tone={desk.blockedTotal ? "danger" : "normal"} />
      </StatGrid>

      <section aria-labelledby="devices-waiting" className="scroll-mt-24">
        <SectionHeading><span id="devices-waiting">{t("devices.waitingHeading")}</span></SectionHeading>
        {waiting.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">
            {waiting.map(device => <WaitingCard key={device.id} device={device} />)}
          </ul>
        ) : (
          <EmptyState title={t("devices.noneWaiting")} />
        )}
      </section>

      <section aria-labelledby="devices-authorised" className="scroll-mt-24">
        <SectionHeading description={t("devices.authorisedNote")}><span id="devices-authorised">{t("devices.authorisedHeading")}</span></SectionHeading>
        {authorised.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">
            {authorised.map(device => <AuthorisedCard key={device.id} device={device} />)}
          </ul>
        ) : (
          <EmptyState title={t("devices.noneAuthorised")} />
        )}
      </section>

      <section aria-labelledby="devices-blocked" className="scroll-mt-24">
        <SectionHeading description={t("devices.blockedNote")}><span id="devices-blocked">{t("devices.endedHeading")}</span></SectionHeading>
        {blocked.length ? (
          <>
            <ul className="grid gap-3 lg:grid-cols-2">
              {blocked.map(device => <BlockedCard key={device.id} device={device} />)}
            </ul>
            {desk.blockedTotal > blocked.length ? (
              <p className="mt-3 text-[13px] ink-muted">{t("devices.blockedMore", { shown: blocked.length, total: desk.blockedTotal })}</p>
            ) : null}
          </>
        ) : (
          <EmptyState title={t("devices.noneBlocked")} />
        )}
      </section>

      <SignIns entries={desk.signIns} />
    </div>
  );
}

/** Who a device is for, and what it is. */
function DeviceHead({ device, tone = "navy" }: { device: Device; tone?: "navy" | "danger" }) {
  const { t } = useTranslation();
  const Icon = tone === "danger" ? Ban : /iPhone|iPad|Android/.test(device.name ?? "") ? Smartphone : Monitor;
  return (
    <div className="flex items-start gap-3">
      <span className={`grid size-10 shrink-0 place-items-center rounded-full ${tone === "danger" ? "bg-[#fdeceb] text-[#8c2f22]" : "bg-[#e7edf5] text-[#0a285a]"}`} aria-hidden>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-[#0a285a]">
          <bdi className="break-words">{device.name ?? t("devices.unnamed")}</bdi>
          {device.current ? <Pill tone="navy">{t("devices.thisOne")}</Pill> : null}
          {device.status === "approved" && deviceActive(device.lastSeenAt) ? <Pill tone="good">{t("devices.activeNow")}</Pill> : null}
        </p>
        <p className="mt-0.5 text-[14px] text-[#3d5170]">
          <bdi dir="ltr" className="break-all">{device.account ?? `#${device.userId}`}</bdi>
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

/**
 * One decision about one device, saying what happened when it lands. The
 * words are the caller's, since "removed from the list" is a decline for a
 * device that waited and an unblock for one that was blocked.
 */
function useDecide() {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const decide = trpc.devices.decide.useMutation({
    onError: error => {
      toast.error(tError(error.message));
      void utils.devices.invalidate();
    },
  });
  const run = (device: Device, decision: DeviceMove, done: MessageKey, after?: () => void) =>
    decide.mutate({ id: device.id, decision }, {
      onSuccess: () => {
        toast.success(t(done));
        void utils.devices.invalidate();
      },
      onSettled: after,
    });
  return { run, pending: decide.isPending, doing: decide.isPending ? decide.variables?.decision : null };
}

/** The question every decline and removal asks: may it ask again, or is it blocked for good? */
function AfterwardsChoice({ value, onChange, blockOff = false }: {
  value: Afterwards;
  onChange: (next: Afterwards) => void;
  /** The device being used can be removed but not blocked. */
  blockOff?: boolean;
}) {
  const { t } = useTranslation();
  const name = useId();
  const options: { id: Afterwards; title: MessageKey; note: MessageKey; off: boolean }[] = [
    { id: "askAgain", title: "devices.choiceAskAgain", note: "devices.choiceAskAgainNote", off: false },
    { id: "block", title: "devices.choiceBlock", note: "devices.choiceBlockNote", off: blockOff },
  ];
  return (
    <fieldset className="text-start">
      <legend className="text-[13px] font-semibold text-[#0a285a]">{t("devices.afterwards")}</legend>
      <div className="mt-2 grid gap-2">
        {options.map(option => {
          const chosen = value === option.id;
          return (
            <label
              key={option.id}
              className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${chosen ? "border-[#0a285a] bg-[#f4f7fb]" : "border-[#d5dfeb] bg-white"} ${option.off ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            >
              <input
                type="radio"
                name={name}
                value={option.id}
                checked={chosen}
                disabled={option.off}
                onChange={() => onChange(option.id)}
                className="mt-1 size-4 shrink-0 accent-[#0a285a]"
              />
              <span className="min-w-0">
                <span className="block text-[14px] font-bold text-[#0a285a]">{t(option.title)}</span>
                <span className="mt-0.5 block text-[13px] leading-5 text-[#536b8c]">{t(option.note)}</span>
              </span>
            </label>
          );
        })}
      </div>
      {blockOff ? <p className="mt-2 text-[13px] leading-5 text-[#6b4f1d]">{t("devices.blockCurrentNote")}</p> : null}
    </fieldset>
  );
}

const WARNING: Record<Device["warnings"][number], MessageKey> = {
  accountBlocked: "devices.warnAccount",
  addressBlocked: "devices.warnAddress",
};

function WaitingCard({ device }: { device: Device }) {
  const { t } = useTranslation();
  const when = useDateTimeFormat();
  const decide = useDecide();
  const [declining, setDeclining] = useState(false);
  const [afterwards, setAfterwards] = useState<Afterwards>("askAgain");
  const label = `${device.account ?? device.userId} · ${device.name ?? ""}`;
  return (
    <li>
      <div className={CARD}>
        <DeviceHead device={device} />
        {device.warnings.length ? (
          <Notice tone="warning" className="mt-3">
            {device.warnings.map(warning => <p key={warning}>{t(WARNING[warning])}</p>)}
          </Notice>
        ) : null}
        <Facts rows={[["devices.askedAt", when(device.createdAt)], ["devices.address", device.requestedIp]]} />
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => decide.run(device, "approve", "devices.approvedToast")} disabled={decide.pending} className={smallButtonClass.primary}>
            {decide.doing === "approve" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            {t("devices.approve")}
          </button>
          <button type="button" onClick={() => { setAfterwards("askAgain"); setDeclining(true); }} disabled={decide.pending} className={smallButtonClass.quietDanger}>
            <X className="size-4" aria-hidden />{t("devices.deny")}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={declining}
        tone="danger"
        icon={<X className="size-5" />}
        title={t("devices.declineTitle")}
        body={t("devices.declineBody", { device: isolate(label) })}
        confirmLabel={t(afterwards === "block" ? "devices.declineAndBlock" : "devices.deny")}
        pending={decide.pending}
        onClose={() => setDeclining(false)}
        onConfirm={() => decide.run(device, afterwards === "block" ? "block" : "remove", afterwards === "block" ? "devices.blockedToast" : "devices.deniedToast", () => setDeclining(false))}
      >
        <AfterwardsChoice value={afterwards} onChange={setAfterwards} />
      </ConfirmDialog>
    </li>
  );
}

function AuthorisedCard({ device }: { device: Device }) {
  const { t, tError } = useTranslation();
  const when = useDateTimeFormat();
  const decide = useDecide();
  const utils = trpc.useUtils();
  const [removing, setRemoving] = useState(false);
  const [afterwards, setAfterwards] = useState<Afterwards>("askAgain");
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
      <div className={`${CARD} ${device.current ? "border-[#0a285a]/40" : ""}`}>
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
          <button type="button" onClick={() => { setAfterwards("askAgain"); setRemoving(true); }} className={smallButtonClass.quietDanger}>
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
        confirmLabel={t(afterwards === "block" ? "devices.removeAndBlock" : "devices.revoke")}
        pending={decide.pending}
        onClose={() => setRemoving(false)}
        onConfirm={() => decide.run(device, afterwards === "block" ? "block" : "remove", afterwards === "block" ? "devices.blockedToast" : "devices.revokedToast", () => setRemoving(false))}
      >
        <AfterwardsChoice value={afterwards} onChange={setAfterwards} blockOff={device.current} />
      </ConfirmDialog>
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
        <label className="block text-start">
          <span className="text-[13px] font-semibold text-[#0a285a]">{t("devices.nameLabel")}</span>
          <input value={name} onChange={event => setName(event.target.value)} maxLength={DEVICE_NAME_MAX} className={`mt-1.5 ${fieldClass}`} autoComplete="off" />
        </label>
        {!name.trim() ? <p className="mt-2 text-start text-[13px] text-[#8c2f22]">{t("devices.nameEmpty")}</p> : null}
      </ConfirmDialog>
    </li>
  );
}

/** A blocked device: when, whether it ever had access, and whether it has tried since. */
function BlockedCard({ device }: { device: Device }) {
  const { t } = useTranslation();
  const when = useDateTimeFormat();
  const decide = useDecide();
  const [authorising, setAuthorising] = useState(false);
  const label = `${device.account ?? device.userId} · ${device.name ?? ""}`;
  const tried = device.lastSignInAt && device.decidedAt && new Date(device.lastSignInAt).getTime() > new Date(device.decidedAt).getTime() ? when(device.lastSignInAt) : null;
  return (
    <li>
      <div className={CARD}>
        <DeviceHead device={device} tone="danger" />
        <p className="mt-3 text-[13px] leading-5 text-[#3d5170]">{t(device.status === "revoked" ? "devices.hadAccess" : "devices.neverHadAccess")}</p>
        <Facts
          rows={[
            ["devices.deniedAt", device.decidedAt ? when(device.decidedAt) : null],
            ["devices.triedAt", tried],
            ["devices.address", device.lastIp ?? device.requestedIp],
          ]}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => decide.run(device, "remove", "devices.unblockedToast")} disabled={decide.pending} className={smallButtonClass.secondary}>
            {decide.doing === "remove" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Undo2 className="size-4 rtl:-scale-x-100" aria-hidden />}
            {t("devices.unblock")}
          </button>
          <button type="button" onClick={() => setAuthorising(true)} disabled={decide.pending} className={smallButtonClass.secondary}>
            <Check className="size-4" aria-hidden />{t("devices.allowAgain")}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={authorising}
        icon={<Check className="size-5" />}
        title={t("devices.authoriseTitle")}
        body={t("devices.authoriseBody", { device: isolate(label) })}
        confirmLabel={t("devices.allowAgain")}
        pending={decide.pending}
        onClose={() => setAuthorising(false)}
        onConfirm={() => decide.run(device, "approve", "devices.approvedToast", () => setAuthorising(false))}
      />
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
