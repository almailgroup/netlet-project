/**
 * When the account was opened, when it was last used, and what it can reach.
 *
 * "Last signed in" is the one that earns its place: it is how somebody
 * notices a sign-in that was not theirs. The others are context.
 *
 * Dates are day-precision and Gregorian with Western digits in both
 * languages, matching how prices and the audit trail are rendered — a Hijri
 * date here would be a different reading of "when" from the rest of the site.
 */
import { useTranslation } from "@/lib/useTranslation";
import { appPath } from "@/lib/basePath";
import { ArrowRight, CalendarDays, Clock, ShieldCheck } from "lucide-react";

type PublicUser = { role: string; createdAt: string | Date; lastSignedIn: string | Date };

export function AccountFacts({ user }: { user: PublicUser }) {
  const { t, isArabic } = useTranslation();
  const isAdmin = user.role === "admin";

  const day = (value: string | Date) =>
    new Intl.DateTimeFormat(isArabic ? "ar-KW-u-ca-gregory-nu-latn" : "en-GB", {
      day: "numeric", month: "short", year: "numeric",
    }).format(new Date(value));

  const facts = [
    { icon: CalendarDays, label: t("account.memberSince"), value: day(user.createdAt) },
    { icon: Clock, label: t("account.lastSignedIn"), value: day(user.lastSignedIn) },
    { icon: ShieldCheck, label: t("account.accountRole"), value: t(isAdmin ? "account.roleAdmin" : "account.roleShopper") },
  ];

  return (
    <section className="rounded-[1.5rem] border border-[#d5dfeb] bg-white p-5 sm:p-7">
      <div className="grid gap-3 sm:grid-cols-3">
        {facts.map(fact => (
          <div key={fact.label} className="rounded-2xl border border-[#e6e9ef] p-4">
            <p className="flex items-center gap-2 text-[11px] font-extrabold tracking-[.06em] text-[#778ba6] uppercase">
              <fact.icon className="size-3.5" aria-hidden />{fact.label}
            </p>
            {/* Isolated so a date reads the same in both scripts. */}
            <p dir="ltr" className="mt-1.5 text-[14px] font-extrabold text-[#0a285a]">{fact.value}</p>
          </div>
        ))}
      </div>

      {isAdmin ? (
        <a
          href={appPath("/admin")}
          className="glass glass-navy pressable mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-extrabold"
        >
          {t("account.openAdmin")}<ArrowRight className="size-4 rtl:-scale-x-100" />
        </a>
      ) : null}
    </section>
  );
}
