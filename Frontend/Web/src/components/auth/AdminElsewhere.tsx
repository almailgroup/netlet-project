import { useTranslation } from "@/hooks/useTranslation";
import { portalHref } from "@/lib/portalHost";

/** The refusal an administrator meets signing in on the shop's website. */
export const ADMIN_ELSEWHERE = "auth.adminSignsInOnPortal";

/**
 * Where an administrator signs in instead, drawn under that refusal wherever
 * a sign-in can be refused — the password, the emailed code, Apple, Google,
 * a reset — so the next step is one press. A link, so it opens the way the
 * person wants it to.
 */
export function AdminElsewhere({ message }: { message: string | null | undefined }) {
  const { t } = useTranslation();
  if (message !== ADMIN_ELSEWHERE) return null;
  return (
    <a href={portalHref("admin", "/signin")} className="mt-1 inline-block rounded font-bold underline underline-offset-4">
      {t("auth.portalOpen.admin")}
    </a>
  );
}
