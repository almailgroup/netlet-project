/**
 * Deleting your own account, at the foot of "Your profile" — on the owner's word.
 *
 * The card says what goes (and the points balance, by its figure) and what is
 * kept — the orders and their invoices, no longer linked to an account —
 * before anybody presses anything. While something stands in the way (an
 * order still coming, an open return, a cash-out NetLet still owes, a seat on
 * a store's or a delivery company's team, being an administrator), the card
 * names it instead of offering a button the server would refuse
 * (`auth.deletionCheck`, the server's own reasons).
 *
 * Delete asks twice: the confirmation, and the password in it — a session
 * left open on a shared computer must not be enough to delete somebody, the
 * rule the email and password forms keep. An account that signs in with
 * Apple confirms with Apple instead, Apple's button standing in for the
 * dialog's own, which also lets the server unlink NetLet from the Apple ID
 * once the account is gone; one with a password too may use either. Cancel takes focus as it opens, so
 * a stray Enter gives the safe answer. Once the account is gone this device
 * forgets it as signing out does (`useAuth().logout`) and goes home.
 */
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FloatingField, PANEL } from "@/components/account/profileParts";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { formatCount } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { ChevronDown, CircleAlert, LoaderCircle, Trash2 } from "lucide-react";
import { CodeBoxes } from "@/components/auth/AuthForm";
import { isCodeShaped, normaliseCode } from "@shared/auth/emailCode";
import { shownPhone } from "@shared/auth/phone";
import { AppleButton, OrDivider } from "@/components/auth/AppleButton";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

/* Each reason the server gives, in its own sentence — written out so every
   key is one the dictionary can see being used. */
const BLOCKER_SENTENCE: Record<string, MessageKey> = {
  admin: "account.deleteBlocked.admin",
  team: "account.deleteBlocked.team",
  orderOpen: "account.deleteBlocked.orderOpen",
  returnOpen: "account.deleteBlocked.returnOpen",
  warrantyOpen: "account.deleteBlocked.warrantyOpen",
  cashOutOwed: "account.deleteBlocked.cashOutOwed",
};

export function DeleteAccount() {
  const { t, locale } = useTranslation();
  const { logout } = useAuth();
  const [, navigate] = useLocation();
  const check = trpc.auth.deletionCheck.useQuery(undefined, { refetchOnWindowFocus: true });
  const [asking, setAsking] = useState(false);
  const [open, setOpen] = useState(false);
  const ownId = useId();
  const [password, setPassword] = useState("");
  const ways = trpc.auth.myProviders.useQuery(undefined, { staleTime: 60_000 });
  const providers = trpc.auth.providers.useQuery(undefined, { staleTime: 5 * 60_000 });
  const appleAccount = ways.data?.apple === true;
  const googleAccount = ways.data?.google === true;
  const hasPassword = ways.data?.password !== false;
  const appleClientId = appleAccount ? providers.data?.apple.web ?? null : null;
  /* An account made with a phone confirms with a code texted to it. */
  const { user } = useAuth();
  const phoneAccount = !hasPassword && !appleAccount && !googleAccount && Boolean(user?.phone);
  const [phoneCode, setPhoneCode] = useState("");
  const [texted, setTexted] = useState(false);
  const text = trpc.auth.phoneStart.useMutation({
    onSuccess: () => setTexted(true),
    onError: error => toast.error(isMessageKey(error.message) ? t(error.message) : t("account.deleteFailed")),
  });
  const googleClientId = googleAccount ? providers.data?.google?.web ?? null : null;
  /* What the account signs in with, said once above the buttons that confirm. */
  const confirmNote = appleAccount ? "account.deleteAppleNote" : "account.deleteGoogleNote";

  const remove = trpc.auth.deleteAccount.useMutation({
    onSuccess: async () => {
      setAsking(false);
      toast.success(t("account.deleted"));
      await logout().catch(() => {});
      navigate("/");
    },
    onError: error => {
      toast.error(isMessageKey(error.message) ? t(error.message) : t("account.deleteFailed"));
      // Something may have changed under the press: say what stands in the way now.
      if (error.message.startsWith("account.deleteBlocked.")) {
        setAsking(false);
        void check.refetch();
      }
    },
  });

  const blockers = check.data?.blockers ?? [];
  const points = check.data?.points ?? 0;
  const close = () => {
    if (remove.isPending) return;
    setAsking(false);
    setPassword("");
    setPhoneCode("");
    setTexted(false);
  };

  /* Folded to one row until pressed, on the owner's word ("make it very
     compact"): what goes, what stays and what stands in the way are a press
     away, never a screen of text under somebody's name and phone. */
  return (
    <section aria-labelledby={`${ownId}-title`} className={PANEL}>
      <h3 id={`${ownId}-title`} className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${ownId}-body`}
          onClick={() => setOpen(shown => !shown)}
          className="flex min-h-14 w-full items-center gap-3 rounded-3xl px-5 py-3 text-start text-[15px] font-semibold text-[#b42318] hover:bg-[#fdeceb] sm:px-6"
        >
          <Trash2 className="size-[18px] shrink-0" aria-hidden />
          <span className="flex-1">{t("account.deleteTitle")}</span>
          <ChevronDown className={`size-5 shrink-0 text-[#8a97ab] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </h3>
      <div id={`${ownId}-body`} hidden={!open} className="px-5 pb-5 sm:px-6">
        <p className="mb-3 text-[14px] leading-5 ink-muted">{t("account.deleteNote")}</p>
        {points > 0 ? (
          <p className="mb-3 text-[14px] font-semibold text-[#0a285a]">
            {t("account.deletePoints", { points: formatCount(points, locale) })}
          </p>
        ) : null}
        {blockers.length > 0 ? (
          <div role="status" className="rounded-2xl bg-[#fdf1ec] p-4">
            <p className="flex items-center gap-2 text-[14px] font-bold text-[#a44a2b]">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              {t("account.deleteBlockedTitle")}
            </p>
            <ul className="mt-2 space-y-1.5 text-[14px] leading-5 text-[#404553]">
              {blockers.map(blocker => (
                <li key={blocker}>{t(BLOCKER_SENTENCE[blocker] ?? "account.deleteFailed")}</li>
              ))}
            </ul>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAsking(true)}
            disabled={check.isLoading}
            className="inline-flex h-12 items-center gap-2 rounded-full border border-[#e9b8b0] bg-white px-6 text-[15px] font-semibold text-[#b42318] hover:bg-[#fdeceb] disabled:opacity-50"
          >
            <Trash2 className="size-4" aria-hidden />
            {t("account.deleteStart")}
          </button>
        )}
        <ConfirmDialog
          open={asking}
          title={t("account.deleteConfirmTitle")}
          body={t("account.deleteNote")}
          confirmLabel={t("account.deleteStart")}
          tone="danger"
          pending={remove.isPending}
          confirmDisabled={phoneAccount ? !isCodeShaped(phoneCode) : password === ""}
          confirmHidden={!hasPassword && !(phoneAccount && texted)}
          icon={<Trash2 className="size-5" />}
          onConfirm={() => remove.mutate(phoneAccount ? { phoneCode } : { currentPassword: password })}
          onClose={close}
        >
          <div className="space-y-3">
            {hasPassword ? (
              <div className="space-y-2">
                <FloatingField
                  label={t("account.currentPassword")}
                  leftToRight
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                />
                <p className="text-[12px] leading-4 ink-muted">{t("account.deletePasswordNote")}</p>
              </div>
            ) : null}
            {appleClientId || googleClientId ? (
              <>
                {hasPassword ? <OrDivider /> : <p className="text-[13px] leading-5 ink-muted">{t(confirmNote)}</p>}
                {appleClientId ? (
                  <AppleButton
                    clientId={appleClientId}
                    label="account.deleteWithApple"
                    busy={remove.isPending}
                    onProof={proof => remove.mutate({ apple: { idToken: proof.idToken, nonce: proof.nonce, code: proof.code } })}
                    onFailed={() => toast.error(t("auth.appleWindowFailed"))}
                  />
                ) : null}
                {googleClientId ? (
                  <GoogleButton
                    clientId={googleClientId}
                    label="account.deleteWithGoogle"
                    busy={remove.isPending}
                    onProof={proof => remove.mutate({ google: proof })}
                    onFailed={() => toast.error(t("auth.googleWindowFailed"))}
                  />
                ) : null}
              </>
            ) : phoneAccount && user?.phone ? (
              <div className="space-y-3">
                <p className="text-[13px] leading-5 ink-muted">
                  {t("account.deletePhoneNote", { phone: "\u2068" + shownPhone(user.phone) + "\u2069" })}
                </p>
                {texted ? (
                  <div>
                    <label htmlFor="delete-phone-code" className="text-[13px] font-semibold text-[#0a285a]">{t("account.deletePhoneCode")}</label>
                    <CodeBoxes id="delete-phone-code" value={phoneCode} onChange={raw => setPhoneCode(normaliseCode(raw))} invalid={false} />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => text.mutate({ phone: user.phone! })}
                    disabled={text.isPending}
                    className="inline-flex h-11 items-center gap-2 rounded-full border border-[#c9d4e2] bg-white px-5 text-[14px] font-semibold text-[#0a285a] hover:bg-[#f0f2f5]"
                  >
                    {text.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                    {t("account.deleteWithPhone")}
                  </button>
                )}
              </div>
            ) : !hasPassword ? (
              <p className="text-[13px] leading-5 ink-muted">{t(appleAccount ? "account.deleteAppleInApp" : "account.deleteGoogleInApp")}</p>
            ) : null}
          </div>
        </ConfirmDialog>
      </div>
    </section>
  );
}
