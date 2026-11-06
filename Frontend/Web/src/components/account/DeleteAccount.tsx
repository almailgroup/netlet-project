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
import { FloatingField, ProfileCard } from "@/components/account/profileParts";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { formatCount } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { CircleAlert, Trash2 } from "lucide-react";
import { AppleButton, OrDivider } from "@/components/auth/AppleButton";
import { useState } from "react";
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
  const [password, setPassword] = useState("");
  const ways = trpc.auth.myProviders.useQuery(undefined, { staleTime: 60_000 });
  const providers = trpc.auth.providers.useQuery(undefined, { staleTime: 5 * 60_000 });
  const appleAccount = ways.data?.apple === true;
  const hasPassword = ways.data?.password !== false;
  const appleClientId = appleAccount ? providers.data?.apple.web ?? null : null;

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
  };

  return (
    <ProfileCard title={t("account.deleteTitle")} note={t("account.deleteNote")}>
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
        confirmDisabled={password === ""}
        confirmHidden={!hasPassword}
        icon={<Trash2 className="size-5" />}
        onConfirm={() => remove.mutate({ currentPassword: password })}
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
          {appleClientId ? (
            <>
              {hasPassword ? <OrDivider /> : <p className="text-[13px] leading-5 ink-muted">{t("account.deleteAppleNote")}</p>}
              <AppleButton
                clientId={appleClientId}
                label="account.deleteWithApple"
                busy={remove.isPending}
                onProof={proof => remove.mutate({ apple: { idToken: proof.idToken, nonce: proof.nonce, code: proof.code } })}
                onFailed={() => toast.error(t("auth.appleWindowFailed"))}
              />
            </>
          ) : !hasPassword ? (
            <p className="text-[13px] leading-5 ink-muted">{t("account.deleteAppleInApp")}</p>
          ) : null}
        </div>
      </ConfirmDialog>
    </ProfileCard>
  );
}
