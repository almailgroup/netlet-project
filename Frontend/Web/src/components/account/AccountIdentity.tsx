/**
 * The account's dates at the foot of "Your profile" — when it was opened and
 * when it last signed in — and, for an administrator, the way to the portal.
 * The home has the name and the address on a card of its own (`AccountHome`),
 * and the email has its own card above, so none of them is said again here.
 *
 * It is drawn as the home's rows are — an outline icon, the words, the value
 * at the end, dashed lines between — on the account's one card (`PANEL`). It
 * was a card of its own design, a navy square of initials over a bold "Signed
 * in as", the one thing on the page still in the account's old look.
 *
 * The avatar is initials rather than an uploaded picture: NetLet has nowhere
 * to put an image yet, and a grey silhouette that never changes is furniture.
 * Initials at least identify the account at a glance, which is what an avatar
 * on a settings page is actually for.
 */
import { PANEL } from "@/components/account/profileParts";
import { SHOP_TIME_ZONE } from "@/hooks/useDateFormat";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { CalendarDays, ChevronRight, Clock, ShieldCheck } from "lucide-react";

type PublicUser = {
  email: string;
  name: string | null;
  role: string;
  createdAt: string | Date;
  lastSignedIn: string | Date;
};

/**
 * Up to two initials, from whatever we actually have.
 *
 * Falls back to the email when there is no display name, because a shopper
 * who never set one still deserves something other than a blank circle.
 * Non-Latin names work unchanged — the first character of each word is right
 * in Arabic too.
 */
export function initialsFor(user: { name: string | null; email: string }): string {
  const source = user.name?.trim() || user.email.split("@")[0] || "";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return [...words[0]].slice(0, 2).join("").toUpperCase();
  return (([...words[0]][0] ?? "") + ([...words[1]][0] ?? "")).toUpperCase();
}

export function AccountIdentity({ user }: { user: PublicUser }) {
  const { t, isArabic } = useTranslation();
  const isAdmin = user.role === "admin";

  const day = (value: string | Date) =>
    new Intl.DateTimeFormat(isArabic ? "ar-KW-u-ca-gregory-nu-latn" : "en-GB", {
      day: "numeric", month: "short", year: "numeric", timeZone: SHOP_TIME_ZONE,
    }).format(new Date(value));

  const facts = [
    { icon: CalendarDays, label: t("account.memberSince"), value: day(user.createdAt) },
    { icon: Clock, label: t("account.lastSignedIn"), value: day(user.lastSignedIn) },
  ];

  return (
    <section aria-label={t("account.security")} className={`${PANEL} overflow-hidden px-5`}>
      <dl className="divide-y divide-dashed divide-[#e3e6ec]">
        {facts.map(fact => (
          <div key={fact.label} className="flex min-h-[60px] items-center gap-3.5">
            <fact.icon className="size-[22px] shrink-0 text-[#5d6b82]" strokeWidth={1.75} aria-hidden />
            <dt className="min-w-0 flex-1 text-[15px] text-[#1f2a44]">{fact.label}</dt>
            {/* Isolated, and in its own direction: an Arabic month name runs
                right to left with its digits, where a forced left-to-right put
                the year first for an Arabic reader. */}
            <dd className="shrink-0 text-[15px] font-semibold text-[#0a285a]"><bdi>{fact.value}</bdi></dd>
          </div>
        ))}
      </dl>
      {isAdmin ? (
        <div className="border-t border-dashed border-[#e3e6ec]">
          <a
            href={appPath("/admin")}
            className="-mx-5 flex min-h-[60px] items-center gap-3.5 px-5 hover:bg-[#f0f2f5]"
          >
            <ShieldCheck className="size-[22px] shrink-0 text-[#5d6b82]" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 text-[15px] font-medium text-[#1f2a44]">{t("account.openAdmin")}</span>
            <span className="shrink-0 rounded-full bg-[#f1f2f6] px-2.5 py-1 text-[12px] font-bold text-[#0a285a]">{t("account.roleAdmin")}</span>
            <ChevronRight className="size-5 shrink-0 text-[#1f2a44] rtl:-scale-x-100" aria-hidden />
          </a>
        </div>
      ) : null}
    </section>
  );
}
