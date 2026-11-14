import { Link } from "wouter";
import { ChevronDown } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useConfig, usePageTitle } from "../hooks.js";
import { TrackForm } from "../components/TrackForm.js";
import { STATUS_ICONS } from "../components/Status.js";
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
            {config?.demo && config.samples.length ? (
              <p className="samples">
                <span>{t("track.samples")}</span>
                {config.samples.map(number => (
                  <Link key={number} href={`/track/${number}`}>{number}</Link>
                ))}
              </p>
            ) : null}
          </div>
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
