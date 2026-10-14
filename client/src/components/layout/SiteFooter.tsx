/**
 * The storefront's footer, one copy for every shopping page.
 *
 * It lived inside `Home.tsx`, so the product page — where a shopper who has
 * decided goes looking for returns, delivery and who to ask — ended at the
 * reviews with nothing under them. Checkout keeps its bare header and no
 * footer, for the reason it keeps the bare header: every exit on a payment
 * page is an invitation to take it.
 *
 * **What a shop's footer owes a shopper, on the owner's word**: how to reach
 * a person, the links somebody scrolls down for, how paying and delivery work,
 * and who the shop is — the company, its commercial registration and its
 * address, which a Kuwaiti shop shows its customers — with the terms and the
 * privacy policy beside them. It was four columns of links and a copyright
 * line, and read as a template's.
 *
 * **Every entry goes somewhere, and every contact is real.** WhatsApp, the
 * phone, the email and the social profiles come from the deployment's own
 * settings (`support.channels`, `shared/commerce/contact.ts`); one that is not
 * configured is absent rather than a link to nobody, and "Message NetLet" is
 * always there, so the block is never empty. The company line is the
 * invoices' own issuer (`INVOICE_ISSUER_*`), so the footer and the invoice
 * cannot name two different companies.
 *
 * **On a phone the link groups fold** — a button per group, the contact block
 * open above them — so the footer is a short page rather than five screens of
 * links; from `sm` up they are columns. One structure at a time
 * (`useMediaQuery`), the product page's rule.
 */
import { Banknote, ChevronDown, Facebook, Ghost, Globe, Instagram, LifeBuoy, Mail, MessageCircle, MessagesSquare, Phone, Truck, Youtube, type LucideIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useCustomer } from "@/contexts/CustomerContext";
import { useDepartmentsInStock } from "@/hooks/useDepartmentsInStock";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useTranslation } from "@/hooks/useTranslation";
import { footerLogoImage } from "@/lib/brandAssets";
import { trpc } from "@/lib/trpc";
import { categorySlug } from "@shared/commerce/browse";
import { displayNumber, mailLink, nameInSentence, type SocialPlatform } from "@shared/commerce/contact";
import { DEPARTMENTS } from "@shared/commerce/departments";
import { phoneLink, whatsappLink } from "@shared/commerce/support";
import type { MessageKey } from "@shared/i18n/dictionary";

type FooterLink = { key: MessageKey; href: string };

const SHOPPING: FooterLink[] = [
  { key: "footer.allProducts", href: "/category/all" },
  { key: "footer.newArrivals", href: "/category/all?sort=newest" },
  { key: "footer.onOffer", href: "/category/all?offer=1" },
  { key: "footer.savedItems", href: "/saved" },
];

const SERVICE: FooterLink[] = [
  { key: "footer.helpCentre", href: "/help" },
  { key: "footer.yourOrders", href: "/account/orders" },
  { key: "footer.returns", href: "/returns" },
  { key: "footer.account", href: "/account" },
];

/* The terms and the privacy policy are on the last line, under the company
   they bind, on every width — not in a column a phone folds away. */
const NETLET: FooterLink[] = [
  { key: "stores.title", href: "/stores" },
  { key: "footer.sellWithUs", href: "/sell" },
];

/** Two brand marks lucide does not carry, as their own one-colour glyphs. */
function TikTokMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-[18px]" fill="currentColor">
      <path d="M16.6 2h-3.3v13.2a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9a6.3 6.3 0 1 0 5.3 6.2V8.6a7.9 7.9 0 0 0 4.4 1.4V6.7a4.4 4.4 0 0 1-4.4-4.4Z" />
    </svg>
  );
}

function XMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-[16px]" fill="currentColor">
      <path d="M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.9L17.8 3Zm-1.1 16.2h1.7L7.3 4.7H5.5l11.2 14.5Z" />
    </svg>
  );
}

const SOCIAL_ICON: Record<SocialPlatform, () => ReactNode> = {
  instagram: () => <Instagram className="size-[18px]" aria-hidden />,
  snapchat: () => <Ghost className="size-[18px]" aria-hidden />,
  tiktok: () => <TikTokMark />,
  x: () => <XMark />,
  youtube: () => <Youtube className="size-[18px]" aria-hidden />,
  facebook: () => <Facebook className="size-[18px]" aria-hidden />,
};

const linkClass = "block w-fit py-2.5 text-start text-[15px] text-[#c5d3e6] hover:text-white hover:underline sm:py-1.5 sm:text-[14px]";

/**
 * A group of links: a heading and a list from `sm` up; on a phone, the heading
 * is a button that opens the list, the WAI-ARIA disclosure.
 */
function Group({ title, links, folded }: { title: MessageKey; links: FooterLink[]; folded: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const list = (
    <ul id={listId} hidden={folded && !open} className={folded ? "pb-3" : "mt-3 space-y-1"}>
      {links.map(link => <li key={link.key + link.href}><Link href={link.href} className={linkClass}>{t(link.key)}</Link></li>)}
    </ul>
  );
  if (!folded) {
    return (
      <div>
        <h2 className="text-[15px] font-bold text-white">{t(title)}</h2>
        {list}
      </div>
    );
  }
  return (
    <div className="border-b border-white/15">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen(value => !value)}
          className="flex min-h-14 w-full items-center justify-between gap-3 text-start text-[16px] font-bold text-white"
        >
          {t(title)}
          <ChevronDown className={`size-5 shrink-0 text-[#c5d3e6] transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </h2>
      {list}
    </div>
  );
}

/** One way to reach a person: an icon, what it is, and the number or address itself. */
function ContactRow({ icon: Icon, label, detail, href, external, internal }: {
  icon: LucideIcon;
  label: string;
  detail?: ReactNode;
  href: string;
  external?: string;
  internal?: boolean;
}) {
  const face = (
    <>
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[.08] text-[#ffab85]">
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-white">{label}</span>
        {detail ? <span className="block truncate text-[13px] text-[#c5d3e6]">{detail}</span> : null}
      </span>
      {external ? <span className="sr-only"> {external}</span> : null}
    </>
  );
  const className = "flex min-h-11 items-center gap-3 rounded-xl py-1 pe-2 hover:bg-white/[.12]";
  return (
    <li className="min-w-0">
      {internal
        ? <Link href={href} className={className}>{face}</Link>
        : <a href={href} className={className} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{face}</a>}
    </li>
  );
}

/**
 * `clearance` is how much room the foot of the page needs on a phone: the tab
 * bar always, and on a page with a floating bar of its own — the filters
 * button, the product page's buy bar — that as well, or the last line of the
 * footer sits under it. The tab bar floats above the home indicator, so the
 * safe area is added to both.
 *
 * `mt-auto` is half of keeping it at the bottom of the window: every page that
 * draws it is a flex column at least a screen tall, so on a short page — a
 * shop with three products, an empty Saved list — the space goes above the
 * footer instead of below it as a band of page colour.
 */
export function SiteFooter({ clearance = "tabs" }: { clearance?: "tabs" | "tall" }) {
  const { t, isArabic } = useTranslation();
  const { toggleLocale } = useCustomer();
  const wide = useMediaQuery("(min-width: 640px)");
  const channels = trpc.support.channels.useQuery(undefined, { staleTime: 300_000 });
  const contact = channels.data;
  const company = contact?.company ?? null;
  const companyName = nameInSentence(company ? (isArabic && company.nameAr ? company.nameAr : company.name) : t("footer.netlet"));
  /* The navigation's rule: a department with nothing on sale is not linked. */
  const inStock = useDepartmentsInStock();
  const departments: FooterLink[] = [
    ...DEPARTMENTS.filter(department => inStock(department.name))
      .map(department => ({ key: department.label, href: `/category/${categorySlug(department.name)}` })),
    { key: "footer.allCategories", href: "/categories" },
  ];

  return (
    <footer className={`mt-auto bg-[#0a285a] pt-10 text-white sm:pt-14 lg:pb-8 ${clearance === "tall" ? "pb-[calc(11rem+env(safe-area-inset-bottom))]" : "pb-[calc(6rem+env(safe-area-inset-bottom))]"}`}>
      <div className="container">
        <div className="grid gap-8 sm:grid-cols-4 sm:gap-x-6 sm:gap-y-10 lg:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))] lg:gap-x-8">
          {/* Who NetLet is and how to reach a person: first on a phone, where
              it is the reason most people scroll this far. */}
          <div className="min-w-0 sm:col-span-4 lg:col-span-1">
            <Link href="/" className="inline-block" aria-label={t("header.home")}>
              <img src={footerLogoImage} alt="NetLet" loading="lazy" decoding="async" className="h-10 w-auto object-contain" />
            </Link>
            <p className="mt-3 text-[15px] font-semibold text-white">{t("home.heroTitle")} <span className="ink-accent-on-dark">{t("home.heroTitleAccent")}</span></p>
            <h2 className="mt-6 text-[15px] font-bold text-white">{t("footer.contactTitle")}</h2>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
              {contact?.whatsapp ? (
                <ContactRow
                  icon={MessageCircle}
                  label={t("support.whatsapp")}
                  detail={<bdi dir="ltr">{displayNumber(contact.whatsapp)}</bdi>}
                  href={whatsappLink(contact.whatsapp, t("support.whatsappHello"))}
                  external={t("support.opensNewTab")}
                />
              ) : null}
              {contact?.phone ? (
                <ContactRow icon={Phone} label={t("footer.callUs")} detail={<bdi dir="ltr">{displayNumber(contact.phone)}</bdi>} href={phoneLink(contact.phone)} />
              ) : null}
              {contact?.email ? (
                <ContactRow icon={Mail} label={t("footer.emailUs")} detail={<bdi dir="ltr">{contact.email}</bdi>} href={mailLink(contact.email)} />
              ) : null}
              <ContactRow icon={MessagesSquare} label={t("help.contactMessage")} href="/account/help" internal />
              <ContactRow icon={LifeBuoy} label={t("footer.helpCentre")} href="/help" internal />
            </ul>
            {contact?.social.length ? (
              <>
                <h2 className="mt-6 text-[15px] font-bold text-white">{t("footer.follow")}</h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {contact.social.map(link => (
                    <li key={link.platform}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${t("footer.socialOn", { platform: t(`social.${link.platform}` as MessageKey) })} ${t("footer.opensNewTab")}`}
                        title={t(`social.${link.platform}` as MessageKey)}
                        className="grid size-11 place-items-center rounded-full border border-white/20 text-white hover:bg-white/[.12]"
                      >
                        {SOCIAL_ICON[link.platform]()}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          <div className="min-w-0 sm:contents">
            <Group title="footer.categories" links={departments} folded={!wide} />
            <Group title="footer.shopping" links={SHOPPING} folded={!wide} />
            <Group title="footer.service" links={SERVICE} folded={!wide} />
            <Group title="footer.netlet" links={NETLET} folded={!wide} />
          </div>
        </div>

        {/* How paying and delivery work, and the language: one line on a wide
            screen, stacked on a phone. */}
        <div className="mt-8 flex flex-col gap-4 border-t border-white/15 pt-6 sm:mt-12 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <ul className="flex flex-col gap-3 text-[14px] text-[#c5d3e6] sm:flex-row sm:flex-wrap sm:gap-x-8">
            <li className="flex items-center gap-2.5">
              <Banknote className="size-[18px] shrink-0 text-[#ffab85]" aria-hidden />
              <span><span className="font-semibold text-white">{t("footer.payment")}:</span> {t("footer.cashOnDelivery")}</span>
            </li>
            <li className="flex items-center gap-2.5">
              <Truck className="size-[18px] shrink-0 text-[#ffab85]" aria-hidden />
              {t("checkout.builtForKuwait")}
            </li>
          </ul>
          <button
            type="button"
            onClick={toggleLocale}
            title={t("header.changeLanguage")}
            className="inline-flex h-11 w-fit items-center gap-2 rounded-full border border-white/25 px-4 text-[14px] font-semibold text-white hover:bg-white/[.12]"
          >
            <Globe className="size-4" aria-hidden />
            <span lang={isArabic ? "en" : "ar"}>{t("header.language")}</span>
          </button>
        </div>

        {/* Who the shop is, and the documents that bind it. */}
        <div className="mt-6 flex flex-col gap-4 text-[13px] leading-6 text-[#c5d3e6] sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <div className="min-w-0">
            <p>{t("footer.copyright", { year: new Date().getFullYear(), name: companyName })}</p>
            {company?.licence || company?.address ? (
              <p>
                {/* The number isolated, so a registration with letters or a dash
                    keeps its order inside the Arabic sentence. */}
                {company.licence ? t("footer.registration", { number: `\u2068${company.licence}\u2069` }) : null}
                {company.licence && company.address ? <span aria-hidden> · </span> : null}
                {company.address ? <span dir="auto">{company.address}</span> : null}
              </p>
            ) : null}
          </div>
          <ul className="flex shrink-0 flex-wrap gap-x-5 gap-y-1">
            <li><Link href="/terms" className="inline-block py-1.5 hover:text-white hover:underline sm:py-0">{t("footer.terms")}</Link></li>
            <li><Link href="/privacy" className="inline-block py-1.5 hover:text-white hover:underline sm:py-0">{t("footer.privacy")}</Link></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
