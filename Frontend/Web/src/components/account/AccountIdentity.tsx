/**
 * Who you are, at the foot of "Your profile" — the account's home has the
 * name and the address on a card of its own (`AccountHome`), and the dates and
 * the role are here, under the forms that change them. The forms lead, as the
 * owner's reference draws the page: somebody opening it came to change
 * something, and "is this my account?" is answered on the home already.
 *
 * The avatar is initials rather than an uploaded picture: NetLet has nowhere
 * to put an image yet, and a grey silhouette that never changes is furniture.
 * Initials at least identify the account at a glance, which is what an avatar
 * on a settings page is actually for.
 */
import { SHOP_TIME_ZONE } from "@/hooks/useDateFormat";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { ArrowRight, CalendarDays, Clock, ShieldCheck } from "lucide-react";

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
    <section className="rounded-[1.5rem] border border-[#d5dfeb] bg-white p-5 sm:p-7">
      <div className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden
          className="grid size-16 shrink-0 place-items-center rounded-2xl bg-[#0a285a] text-xl font-extrabold text-white"
        >
          {initialsFor(user)}
        </span>
        <div className="min-w-0 flex-1">
          {/* `bdi`, not `dir="auto"` on the heading itself: a Latin name in an
              Arabic page needs its own internal order, but the heading is a
              field of this card and belongs on the card's side. `dir` on the
              block does both, which threw the name to the far edge and left
              the label under it hugging the other one. It wraps rather than
              truncating: cut on an Arabic page, a Latin name lost its first
              letters ("…ra Al-Sabah"), and a name is the one thing on the
              card a shopper reads to be sure it is theirs. */}
          <h3 className="text-xl font-extrabold text-[#0a285a] [overflow-wrap:anywhere]">
            <bdi>{user.name?.trim() || t("account.noName")}</bdi>
          </h3>
          <p className="mt-0.5 text-[12px] font-semibold ink-muted">
            {t("account.identityEmail")}
          </p>
          <p className="truncate text-[13px] font-bold text-[#536b8c]">
            <bdi dir="ltr">{user.email}</bdi>
          </p>
        </div>
        {/* On a phone the role goes on its own line under the email, lined up
            with the words, so the name has the card's width; beside it, the
            name broke at its hyphen ("Noura Al-" over "Sabah"). */}
        <span className="max-sm:-mt-2 max-sm:basis-full max-sm:ps-20">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-extrabold ${
              isAdmin ? "bg-[#0a285a] text-white" : "bg-[#e7edf5] text-[#0a285a]"
            }`}
          >
            <ShieldCheck className="size-3.5" aria-hidden />
            {t(isAdmin ? "account.roleAdmin" : "account.roleShopper")}
          </span>
        </span>
      </div>

      <div className="mt-5 grid gap-3 border-t border-[#e6e9ef] pt-5 sm:grid-cols-2">
        {facts.map(fact => (
          <div key={fact.label} className="flex items-center gap-2.5">
            <fact.icon className="size-4 shrink-0 ink-muted" aria-hidden />
            <span className="text-[12px] ink-muted">{fact.label}</span>
            {/* Isolated so a date reads the same in both scripts. */}
            <span dir="ltr" className="text-[13px] font-extrabold text-[#0a285a]">{fact.value}</span>
          </div>
        ))}
      </div>

      {isAdmin ? (
        <a
          href={appPath("/admin")}
          className="glass glass-navy pressable mt-5 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-extrabold"
        >
          {t("account.openAdmin")}<ArrowRight className="size-4 rtl:-scale-x-100" />
        </a>
      ) : null}
    </section>
  );
}
