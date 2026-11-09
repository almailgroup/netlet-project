/**
 * What the admin portal draws for an account whose rights are held back on
 * this device (`Shared/auth/adminDevice.ts`), on the owner's word: "only
 * authorised devices get access to the admin panel".
 *
 * Nothing of the portal is drawn — no menu, no page — only where the device
 * stands and the one thing that can be done about it: wait for the owner
 * (the page opens by itself once they approve, asked every five seconds), ask
 * if it has not asked yet, or, for the owner, have a code emailed to their
 * own address. A device turned down or removed says so, and only the owner
 * can let it back. Signing out and the shop are always one press away.
 */
import { CircleAlert, LoaderCircle, LogOut, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/hooks/useAuth";
import { useDateTimeFormat } from "@/hooks/useDateFormat";
import { isCodeShaped, normaliseCode } from "@shared/auth/emailCode";
import type { DeviceAccess } from "@shared/auth/adminDevice";
import type { MessageKey } from "@shared/i18n/dictionary";
import { CodeBoxes } from "@/components/auth/AuthForm";
import { buttonClass } from "@/components/admin/ui";

type Access = { access: DeviceAccess; owner: boolean; deviceName: string | null; requestedAt: Date | string | null };

const TITLES: Record<Exclude<DeviceAccess, "trusted">, MessageKey> = {
  pending: "devices.waitingTitle",
  none: "devices.noneTitle",
  denied: "devices.deniedTitle",
  revoked: "devices.revokedTitle",
  closed: "devices.closedTitle",
};

const BODIES: Record<Exclude<DeviceAccess, "trusted">, MessageKey> = {
  pending: "devices.waitingBody",
  none: "devices.noneBody",
  denied: "devices.deniedBody",
  revoked: "devices.revokedBody",
  closed: "devices.closedBody",
};

export function DeviceGate({ state }: { state: Access }) {
  const { t, tError } = useTranslation();
  const { logout } = useAuth();
  const dateTime = useDateTimeFormat();
  const utils = trpc.useUtils();
  const access = state.access === "trusted" ? "pending" : state.access;
  const ask = trpc.devices.request.useMutation({ onSuccess: () => void utils.devices.access.invalidate() });
  const Icon = access === "denied" || access === "revoked" ? ShieldX : access === "closed" ? ShieldAlert : ShieldCheck;
  const tint = access === "denied" || access === "revoked" ? "bg-[#fdecec] text-[#b42318]" : "bg-[#e7edf5] text-[#0a285a]";

  return (
    <section aria-labelledby="device-gate-title" className="mx-auto w-full max-w-md rounded-3xl border border-[#e1e7ef] bg-white px-6 py-8 text-start shadow-[0_18px_50px_-30px_rgba(10,40,90,.45)] sm:px-8">
      <span className={`grid size-12 place-items-center rounded-full ${tint}`} aria-hidden>
        <Icon className="size-6" />
      </span>
      <h1 id="device-gate-title" className="mt-4 text-[22px] leading-8 font-extrabold text-[#0a285a]">{t(TITLES[access])}</h1>
      <p className="mt-2 text-[15px] leading-6 text-[#3d5170]">{t(BODIES[access])}</p>

      {state.deviceName ? (
        <dl className="mt-5 rounded-2xl bg-[#f5f8fc] px-4 py-3 text-[14px] leading-6">
          <div className="flex flex-wrap gap-x-2">
            <dt className="ink-muted">{t("devices.thisDevice")}</dt>
            <dd className="font-semibold text-[#0a285a]"><bdi>{state.deviceName}</bdi></dd>
          </div>
          {state.requestedAt && access === "pending" ? (
            <div className="flex flex-wrap gap-x-2">
              <dt className="ink-muted">{t("devices.askedAt")}</dt>
              <dd className="text-[#0a285a]">{dateTime(state.requestedAt)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {access === "pending" ? (
        <p role="status" className="mt-4 flex items-center gap-2 text-[14px] ink-muted">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          {t("devices.waitingLive")}
        </p>
      ) : null}

      {access === "pending" && state.owner ? <OwnerCode /> : null}

      {access === "none" ? (
        <div className="mt-6">
          <button type="button" onClick={() => ask.mutate()} disabled={ask.isPending} className={`${buttonClass.primary} w-full justify-center`}>
            {ask.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            {t("devices.askButton")}
          </button>
          {ask.error ? <p role="alert" className="mt-3 text-[14px] text-[#b42318]">{tError(ask.error.message)}</p> : null}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3 border-t border-[#eef2f7] pt-5">
        <button type="button" onClick={() => void logout()} className={buttonClass.secondary}>
          <LogOut className="size-4" aria-hidden />{t("admin.otherAccount")}
        </button>
        <Link href="/" className={buttonClass.secondary}>{t("admin.backToStore")}</Link>
      </div>
    </section>
  );
}

/**
 * The owner's own device: a code to the owner's address, in the sign-in's
 * six boxes, sent by itself on the sixth digit.
 */
function OwnerCode() {
  const { t, tError } = useTranslation();
  const ownId = useId();
  const utils = trpc.useUtils();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const lastTried = useRef<string | null>(null);
  const start = trpc.devices.codeStart.useMutation({
    onSuccess: answer => { setSentTo(answer.email); setRefusal(null); },
    onError: error => setRefusal(error.message),
  });
  const verify = trpc.devices.codeVerify.useMutation({
    /* Everything this account was refused is now its to read. */
    onSuccess: () => void utils.invalidate(),
    onError: error => {
      setRefusal(error.message);
      input.current?.focus();
      input.current?.select();
    },
  });

  useEffect(() => {
    if (sentTo) window.setTimeout(() => input.current?.focus(), 30);
  }, [sentTo]);

  const change = (raw: string) => {
    const next = normaliseCode(raw);
    setCode(next);
    if (refusal === "auth.codeWrong" || refusal === "auth.codeShape") setRefusal(null);
    if (isCodeShaped(next) && next !== lastTried.current && !verify.isPending) {
      lastTried.current = next;
      verify.mutate({ code: next });
    }
  };

  if (!sentTo) {
    return (
      <div className="mt-6 rounded-2xl border border-[#d6dfeb] px-4 py-4">
        <p className="text-[14px] leading-6 text-[#3d5170]">{t("devices.ownerCodeNote")}</p>
        <button type="button" onClick={() => start.mutate()} disabled={start.isPending} className={`mt-3 ${buttonClass.primary} w-full justify-center`}>
          {start.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          {t("devices.emailMeCode")}
        </button>
        {refusal ? <p role="alert" className="mt-3 flex gap-2 text-[14px] text-[#b42318]"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{tError(refusal)}</p> : null}
      </div>
    );
  }

  const marker = "⁣";
  const [before, after = ""] = t("devices.codeSentTo", { email: marker }).split(marker);
  return (
    <form
      noValidate
      onSubmit={event => {
        event.preventDefault();
        if (!isCodeShaped(code)) { setRefusal(code ? "auth.codeShape" : "auth.codeRequired"); input.current?.focus(); return; }
        lastTried.current = code;
        verify.mutate({ code });
      }}
      className="mt-6 rounded-2xl border border-[#d6dfeb] px-4 py-4"
    >
      <p id={`${ownId}-body`} className="text-[14px] leading-6 text-[#3d5170]">
        {before}<bdi dir="ltr" className="font-bold text-[#0a285a]">{sentTo}</bdi>{after}
      </p>
      <label htmlFor={`${ownId}-code`} className="sr-only">{t("auth.codeLabel")}</label>
      <CodeBoxes
        id={`${ownId}-code`}
        inputRef={input}
        value={code}
        onChange={change}
        invalid={Boolean(refusal)}
        describedBy={[`${ownId}-body`, refusal && `${ownId}-issue`].filter(Boolean).join(" ")}
      />
      {refusal ? <p id={`${ownId}-issue`} role="alert" className="mt-3 flex gap-2 text-[14px] text-[#b42318]"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{tError(refusal)}</p> : null}
      <button type="submit" disabled={verify.isPending} className={`mt-4 ${buttonClass.primary} w-full justify-center`}>
        {verify.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
        {t("devices.authoriseButton")}
      </button>
      <button type="button" onClick={() => start.mutate()} disabled={start.isPending} className="mt-2 flex min-h-11 w-full items-center justify-center text-[14px] font-semibold text-[#0a285a] underline underline-offset-4">
        {t("auth.resendCode")}
      </button>
    </form>
  );
}
