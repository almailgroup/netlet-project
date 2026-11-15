import { useState } from "react";
import { Link } from "wouter";
import { ChevronDown, X } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useConfig, usePageTitle } from "../hooks.js";
import { TrackForm } from "../components/TrackForm.js";
import { STATUS_ICONS, StatusPill } from "../components/Status.js";
import { AiMark } from "../components/ShipLeeAI.js";
import { forgetAllTracked, forgetTracked, readRecent } from "../recent.js";
import type { Recent } from "../recent.js";
import { MILESTONES } from "../../shared/status.js";
import type { Key } from "../../shared/i18n.js";

/** The questions the home page answers; the help page has them all. */
const HOME_QUESTIONS: readonly [Key, Key][] = [
  ["faq.number.q", "faq.number.a"],
  ["faq.updates.q", "faq.updates.a"],
  ["faq.attempted.q", "faq.attempted.a"],
];

export function Home() {
  const { t } = useLanguage();
  const config = useConfig();
  usePageTitle(t("title.home"));
  return (
    <>
      <section className="hero" aria-labelledby="home-title">
        {/* A route drawn across the band, for the eye alone. */}
        <svg className="hero-route" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <path d="M-20 330 C 220 330 260 120 470 150 S 760 330 930 210 S 1120 70 1240 90" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="2 14" strokeLinecap="round" />
          <circle cx="930" cy="210" r="9" fill="none" stroke="currentColor" strokeWidth="3" />
          <circle cx="470" cy="150" r="6" fill="currentColor" />
        </svg>
        <div className="container">
          <h1 id="home-title">{t("home.title")}</h1>
          <p className="hero-lead">{t("home.lead")}</p>
          <div className="hero-card">
            <TrackForm autoFocus={false} />
            <RecentlyTracked />
            {config?.demo && config.samples.length ? (
              <p className="samples">
                <span>{t("track.samples")}</span>
                {config.samples.map(number => (
                  <Link key={number} href={`/track/${number}`}>{number}</Link>
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
      </section>

      <div className="container">
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
 * The numbers this device tracked lately, each with the status it had when
 * last seen, so a second look is one press. Kept on the device alone, and
 * each can be taken off, or all of them.
 */
function RecentlyTracked() {
  const { t } = useLanguage();
  const [recent, setRecent] = useState<Recent[]>(readRecent);
  if (!recent.length) return null;
  return (
    <section className="recent" aria-labelledby="recent-title">
      <div className="recent-head">
        <h2 id="recent-title">{t("recent.title")}</h2>
        <button type="button" className="button button-quiet button-small" onClick={() => setRecent(forgetAllTracked())} aria-label={t("recent.clearName")}>
          <span aria-hidden="true">{t("recent.clear")}</span>
        </button>
      </div>
      <ul className="recent-list">
        {recent.map(item => (
          <li key={item.number}>
            <Link href={`/track/${item.number}`} className="recent-link">
              <bdi className="number" dir="ltr">{item.number}</bdi>
              <StatusPill status={item.status} />
            </Link>
            <button type="button" className="recent-remove" onClick={() => setRecent(forgetTracked(item.number))} aria-label={t("recent.remove", { number: item.number })}>
              <X size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <p className="recent-note">{t("recent.note")}</p>
    </section>
  );
}
