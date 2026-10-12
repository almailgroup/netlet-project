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
import { Globe } from "lucide-react";
import { Link } from "wouter";
import { useCustomer } from "@/contexts/CustomerContext";
import { useTranslation } from "@/hooks/useTranslation";
import { useDepartmentsInStock } from "@/hooks/useDepartmentsInStock";
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
  { key: "footer.yourOrders", href: "/account/orders" },
  { key: "footer.returns", href: "/returns" },
  { key: "footer.contact", href: "/help" },
];

const NETLET: FooterLink[] = [
  { key: "footer.sellWithUs", href: "/sell" },
  { key: "footer.account", href: "/account" },
];

const linkClass = "mt-3 block w-fit text-start text-[14px] text-[#c5d3e6] hover:text-white hover:underline";

function Group({ title, links }: { title: MessageKey; links: FooterLink[] }) {
  const { t } = useTranslation();
  return (
    <div>
      <h2 className="text-[15px] font-bold text-white">{t(title)}</h2>
      {links.map(link => <Link key={link.key + link.href} href={link.href} className={linkClass}>{t(link.key)}</Link>)}
    </div>
  );
}

/**
 * `clearance` is how much room the foot of the page needs on a phone: the tab
 * bar always, and on a page with a floating bar of its own — the filters
 * button, the product page's buy bar — that as well, or the last line of the
 * footer sits under it.
 *
 * **Four columns of links, then one line: the logo, the year, the language.**
 * The logo used to head a column of its own beside the links, and once the
 * slogan under it went it was a logo and a lone language button over an empty
 * column. The divider sits inside the container's padding, so it starts and
 * ends where the text does rather than 16px beyond it on both sides.
 *
 * `mt-auto` is half of keeping it at the bottom of the window: every page that
 * draws it is a flex column at least a screen tall, so on a short page — a
 * shop with three products, an empty Saved list — the space goes above the
 * footer instead of below it as a band of page colour.
 */
export function SiteFooter({ clearance = "tabs" }: { clearance?: "tabs" | "tall" }) {
  const { t, isArabic } = useTranslation();
  const { toggleLocale } = useCustomer();
  /* The navigation's rule: a department with nothing on sale is not linked. */
  const inStock = useDepartmentsInStock();
  const departments: FooterLink[] = DEPARTMENTS.filter(department => inStock(department.name))
    .map(department => ({ key: department.label, href: `/category/${categorySlug(department.name)}` }));
  return (
    <footer className={`mt-auto bg-[#0a285a] pt-10 text-white sm:pt-12 lg:pb-8 ${clearance === "tall" ? "pb-44" : "pb-24"}`}>
      <div className="container">
        <div className="grid grid-cols-2 gap-x-6 gap-y-9 sm:grid-cols-4">
          <Group title="footer.categories" links={departments} />
          <Group title="footer.shopping" links={SHOPPING} />
          <Group title="footer.service" links={SERVICE} />
          <Group title="footer.netlet" links={NETLET} />
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-white/15 pt-6">
          <div className="flex items-center gap-4">
            <Link href="/" className="shrink-0" aria-label={t("header.home")}>
              <img src={footerLogoImage} alt="NetLet" loading="lazy" decoding="async" className="h-9 w-auto object-contain" />
            </Link>
            <span className="text-[13px] text-[#c5d3e6]">{t("home.copyright", { year: new Date().getFullYear() })}</span>
          </div>
          <button
            type="button"
            onClick={toggleLocale}
            title={t("header.changeLanguage")}
            className="inline-flex items-center gap-2 rounded-full border border-white/25 px-4 py-2 text-[14px] font-semibold text-white hover:bg-white/[.12]"
          >
            <Globe className="size-4" aria-hidden />
            <span lang={isArabic ? "en" : "ar"}>{t("header.language")}</span>
          </button>
        </div>
      </div>
    </footer>
  );
}
