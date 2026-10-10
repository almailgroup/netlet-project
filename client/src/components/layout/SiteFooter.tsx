/**
 * The storefront's footer, one copy for every shopping page.
 *
 * It lived inside `Home.tsx`, so the product page — where a shopper who has
 * decided goes looking for returns, delivery and who to ask — ended at the
 * reviews with nothing under them. Checkout keeps its bare header and no
 * footer, for the reason it keeps the bare header: every exit on a payment
 * page is an invitation to take it.
 *
 * **Every entry goes somewhere.** The old one had "Returns", "Contact NetLet"
 * and "Our story" answering a press with a "coming soon" toast, and two
 * entries that both opened checkout; those were dropped rather than kept as
 * decoration. Each link is an anchor, so it can be opened in a new tab.
 */
import { Link } from "wouter";
import { useCustomer } from "@/contexts/CustomerContext";
import { useTranslation } from "@/hooks/useTranslation";
import { footerLogoImage } from "@/lib/brandAssets";
import { categorySlug } from "@shared/commerce/browse";
import { DEPARTMENTS } from "@shared/commerce/departments";
import type { MessageKey } from "@shared/i18n/dictionary";

type FooterLink = { key: MessageKey; href: string };

const SHOPPING: FooterLink[] = [
  { key: "footer.allProducts", href: "/category/all" },
  { key: "footer.newArrivals", href: "/category/all?sort=newest" },
  { key: "footer.onOffer", href: "/category/all?offer=1" },
  { key: "footer.savedItems", href: "/saved" },
];

const SERVICE: FooterLink[] = [
  { key: "footer.yourOrders", href: "/account#orders" },
  { key: "footer.returns", href: "/account#orders" },
  { key: "footer.contact", href: "/account#help" },
];

const NETLET: FooterLink[] = [
  { key: "footer.sellWithUs", href: "/sell" },
  { key: "footer.account", href: "/account" },
];

const linkClass = "mt-3 block w-fit text-start text-xs font-medium text-[#b9cce5] hover:text-[#ffcc64]";

function Group({ title, links }: { title: MessageKey; links: FooterLink[] }) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="text-xs font-extrabold text-white">{t(title)}</p>
      {links.map(link => <Link key={link.key + link.href} href={link.href} className={linkClass}>{t(link.key)}</Link>)}
    </div>
  );
}

/**
 * `clearance` is how much room the foot of the page needs on a phone: the tab
 * bar always, and on a page with a floating bar of its own — the filters
 * button, the product page's buy bar — that as well, or the last line of the
 * footer sits under it.
 */
export function SiteFooter({ clearance = "tabs" }: { clearance?: "tabs" | "tall" }) {
  const { t } = useTranslation();
  const { toggleLocale } = useCustomer();
  return (
    <footer className={`bg-[#0a285a] pt-12 text-white lg:pb-7 ${clearance === "tall" ? "pb-44" : "pb-24"}`}>
      <div className="container grid gap-9 sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(4,1fr)]">
        <div>
          <Link href="/" className="flex w-fit items-center" aria-label={t("header.home")}>
            <img src={footerLogoImage} alt="NetLet" loading="lazy" decoding="async" className="h-12 w-auto max-w-[165px] object-contain" />
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-6 text-[#b9cce5]">{t("home.footerNote")}</p>
          <button onClick={toggleLocale} className="glass glass-on-dark pressable mt-6 rounded-full px-3 py-2 text-[10px] font-extrabold tracking-[.08em] uppercase">{t("header.language")}</button>
        </div>
        <div>
          <p className="text-xs font-extrabold text-white">{t("footer.categories")}</p>
          {DEPARTMENTS.map(department => (
            <Link key={department.slug} href={`/category/${categorySlug(department.name)}`} className={linkClass}>{t(department.label)}</Link>
          ))}
        </div>
        <Group title="footer.shopping" links={SHOPPING} />
        <Group title="footer.service" links={SERVICE} />
        <Group title="footer.netlet" links={NETLET} />
      </div>
      <div className="container mt-10 flex flex-col gap-3 border-t border-[#49658d] pt-5 text-[10px] font-semibold text-[#b9cce5] sm:flex-row sm:items-center sm:justify-between">
        <span>{t("home.copyright", { year: new Date().getFullYear() })}</span>
      </div>
    </footer>
  );
}
