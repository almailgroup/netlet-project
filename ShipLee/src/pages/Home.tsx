import { Link } from "wouter";
import { Banknote, ChevronDown, Mail, MapPinned, MessageCircle, Phone, Quote, Route, Store } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useConfig, usePageTitle } from "../hooks.js";
import type { Config } from "../api.js";
import { TrackForm } from "../components/TrackForm.js";
import { RecentlyTracked } from "../components/RecentlyTracked.js";
import { HOME_TRACK_ID } from "../nav.js";
import { STATUS_ICONS } from "../components/Status.js";
import { AiMark } from "../components/ShipLeeAI.js";
import { ParcelLoop } from "../components/ParcelLoop.js";
import { PreviewTag, usePreview } from "../preview.js";
import { MILESTONES } from "../../shared/status.js";
import { GOVERNORATES } from "../../shared/kuwait.js";
import type { Key } from "../../shared/i18n.js";

/** The questions the home page answers; the help page has them all. */
const HOME_QUESTIONS: readonly [Key, Key][] = [
  ["faq.number.q", "faq.number.a"],
  ["faq.updates.q", "faq.updates.a"],
  ["faq.attempted.q", "faq.attempted.a"],
];

/**
 * The home page: the tracking box first, because that is what nearly everybody
 * came for; then what ShipLee does, the road a parcel takes, an invitation to
 * shops, and the common questions. Sample figures and quotes are drawn only in
 * preview, marked as samples, so the live site claims nothing it cannot show.
 */
export function Home() {
  const { t } = useLanguage();
  const config = useConfig();
  const preview = usePreview();
  usePageTitle(t("title.home"));
  return (
    <>
      <section className="hero" aria-labelledby="home-title">
        {/* Parcels going round a road drawn about the words, for the eye alone, with a pause button. */}
        <ParcelLoop>
          <div className="container hero-grid">
            <div className="hero-copy">
              <h1 id="home-title">{t("home.title")}</h1>
              <p className="hero-lead">{t("home.lead")}</p>
              <div className="hero-card">
                <TrackForm inputId={HOME_TRACK_ID} />
                <RecentlyTracked />
                {config?.demo && config.samples.length ? (
                  <p className="samples">
                    <span>{t("track.samples")}</span>
                    {config.samples.map(number => (
                      <Link key={number} href={`/track/${number}`} className="chip">{number}</Link>
                    ))}
                  </p>
                ) : null}
              </div>
              {config?.ai ? (
                <p className="hero-ask">
                  <span className="ai-badge on-brand"><AiMark size={18} /></span>
                  <span>{t("home.askLead")}</span>
                  <Link href="/help#ask">{t("home.askLink")}</Link>
                </p>
              ) : null}
            </div>
            <HeroParcel />
          </div>
        </ParcelLoop>
      </section>

      <div className="container">
        <Services />

        <section className="section" aria-labelledby="steps-title">
          <h2 id="steps-title" className="section-title">{t("home.stepsTitle")}</h2>
          {/* The road every parcel takes, in its order: that order is the content, so it is numbered. */}
          <ol className="steps">
            {MILESTONES.map((status, index) => {
              const Icon = STATUS_ICONS[status];
              return (
                <li key={status} className="step">
                  <span className="step-icon"><Icon size={22} aria-hidden="true" /></span>
                  <span className="step-number" aria-hidden="true">{index + 1}</span>
                  <h3>{t(`status.${status}`)}</h3>
                  <p>{t(`step.${status}`)}</p>
                </li>
              );
            })}
          </ol>
        </section>

        {preview.on ? <SampleFigures /> : null}

        {config ? <BusinessInvite contact={config.contact} /> : null}

        {preview.on ? <SampleQuotes /> : null}

        <section className="section questions" aria-labelledby="questions-title">
          <h2 id="questions-title" className="section-title">{t("home.questionsTitle")}</h2>
          <div className="faq">
            {HOME_QUESTIONS.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {t(question)}
                  <ChevronDown size={18} aria-hidden="true" />
                </summary>
                <p>{t(answer)}</p>
              </details>
            ))}
          </div>
          <p className="more-link">
            <Link href="/help">{t("home.allQuestions")}</Link>
          </p>
        </section>
      </div>
    </>
  );
}

/**
 * A parcel at its destination, beside the tracking box on a wide screen: the
 * band's one picture, drawn in its own whites so it reads as part of it, with
 * the small parcels going round the road about it (ParcelLoop).
 */
function HeroParcel() {
  return (
    <svg className="hero-parcel" viewBox="0 0 320 300" aria-hidden="true" focusable="false">
      {/* The shadow it casts on the road. */}
      <ellipse cx="160" cy="276" rx="104" ry="14" fill="currentColor" fillOpacity="0.1" />
      {/* Three faces of a box seen from above. */}
      <path d="M160 74 L262 124 L160 174 L58 124 Z" fill="currentColor" fillOpacity="0.24" />
      <path d="M58 124 L160 174 L160 272 L58 222 Z" fill="currentColor" fillOpacity="0.1" />
      <path d="M160 174 L262 124 L262 222 L160 272 Z" fill="currentColor" fillOpacity="0.16" />
      <path d="M160 74 L262 124 L262 222 L160 272 L58 222 L58 124 Z M58 124 L160 174 L262 124 M160 174 L160 272" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      {/* The tape over the top and down the near side. */}
      <path d="M108 99 L210 149 L228 140 L126 90 Z" fill="currentColor" fillOpacity="0.5" />
      <path d="M210 149 L228 140 L228 238 L210 247 Z" fill="currentColor" fillOpacity="0.36" />
      {/* Its label, the lines of an address. */}
      <path d="M78 176 L132 203 L132 233 L78 206 Z" fill="currentColor" fillOpacity="0.85" />
      <path d="M86 186 L122 204 M86 195 L114 209" className="hero-parcel-ink" fill="none" strokeWidth="3" strokeLinecap="round" />
      {/* Where it is going. */}
      <path d="M254 16 C 236 16 222 30 222 47 C 222 70 254 98 254 98 C 254 98 286 70 286 47 C 286 30 272 16 254 16 Z" fill="currentColor" />
      <circle cx="254" cy="46" r="11" className="hero-parcel-ink-fill" />
    </svg>
  );
}

const SERVICES: readonly { icon: LucideIcon; title: Key; body: Key | "governorates" }[] = [
  { icon: Store, title: "svc.pickup.title", body: "svc.pickup.body" },
  { icon: MapPinned, title: "svc.coverage.title", body: "governorates" },
  { icon: Banknote, title: "svc.cash.title", body: "svc.cash.body" },
  { icon: Route, title: "svc.tracking.title", body: "svc.tracking.body" },
];

/** What ShipLee does for every parcel, each a fact the rest of the site keeps. */
function Services() {
  const { t, lang } = useLanguage();
  /* The six by name, from the one list the forms use, joined the way each language joins a list. */
  const governorates = new Intl.ListFormat(lang, { type: "conjunction" }).format(GOVERNORATES.map(g => g[lang]));
  return (
    <section className="section" aria-labelledby="services-title">
      <div className="section-head">
        <div>
          <h2 id="services-title" className="section-title">{t("svc.title")}</h2>
          <p className="section-lead">{t("svc.lead")}</p>
        </div>
      </div>
      <ul className="services">
        {SERVICES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="service">
            <span className="service-icon"><Icon size={22} aria-hidden="true" /></span>
            <h3>{t(title)}</h3>
            <p>{body === "governorates" ? `${governorates}.` : t(body)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The invitation to shops, drawn only where the deployment names a way to
 * reach the team. WhatsApp opens with the first line written; email with its
 * subject. Nothing is sent from here.
 */
function BusinessInvite({ contact }: { contact: Config["contact"] }) {
  const { t } = useLanguage();
  if (!contact.whatsapp && !contact.email && !contact.phone) return null;
  return (
    <section className="section business" aria-labelledby="business-title">
      <div className="business-copy">
        <h2 id="business-title" className="section-title">{t("biz.title")}</h2>
        <p>{t("biz.lead")}</p>
      </div>
      <div className="business-actions">
        {contact.whatsapp ? (
          <a className="button button-light" href={`https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(t("biz.message"))}`} target="_blank" rel="noopener noreferrer">
            <MessageCircle size={18} aria-hidden="true" />
            {t("biz.whatsapp")}
          </a>
        ) : null}
        {contact.email ? (
          <a className={`button ${contact.whatsapp ? "button-ghost-light" : "button-light"}`} href={`mailto:${contact.email}?subject=${encodeURIComponent(t("biz.subject"))}`}>
            <Mail size={18} aria-hidden="true" />
            {t("biz.email")}
          </a>
        ) : null}
        {!contact.whatsapp && !contact.email && contact.phone ? (
          <a className="button button-light" href={`tel:${contact.phone}`}>
            <Phone size={18} aria-hidden="true" />
            {t("biz.call")}
          </a>
        ) : null}
      </div>
    </section>
  );
}

const SAMPLE_FIGURES: readonly { value: string; label: Key }[] = [
  { value: "12,480", label: "stats.delivered" },
  { value: "94%", label: "stats.firstTry" },
  { value: "1.6", label: "stats.days" },
  { value: "6", label: "stats.governorates" },
];

/** Figures for the design, in preview alone: ShipLee has none it could stand behind yet. */
function SampleFigures() {
  const { t } = useLanguage();
  return (
    <section className="section" aria-labelledby="figures-title">
      <div className="section-head">
        <h2 id="figures-title" className="section-title">{t("stats.title")}</h2>
        <PreviewTag />
      </div>
      <p className="section-lead">{t("stats.sample")}</p>
      <dl className="figures">
        {SAMPLE_FIGURES.map(({ value, label }) => (
          <div key={label} className="figure">
            <dt>{t(label)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const SAMPLE_QUOTES: readonly { text: Key; who: Key }[] = [
  { text: "quote.one.text", who: "quote.one.who" },
  { text: "quote.two.text", who: "quote.two.who" },
  { text: "quote.three.text", who: "quote.three.who" },
];

/** Quotes for the design, in preview alone, marked as samples; nobody real said them. */
function SampleQuotes() {
  const { t } = useLanguage();
  return (
    <section className="section" aria-labelledby="quotes-title">
      <div className="section-head">
        <h2 id="quotes-title" className="section-title">{t("quotes.title")}</h2>
        <PreviewTag />
      </div>
      <p className="section-lead">{t("quotes.sample")}</p>
      <ul className="quotes">
        {SAMPLE_QUOTES.map(({ text, who }) => (
          <li key={text} className="quote">
            <figure>
              <Quote size={22} aria-hidden="true" className="quote-mark" />
              <blockquote>{t(text)}</blockquote>
              <figcaption>{t(who)}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
