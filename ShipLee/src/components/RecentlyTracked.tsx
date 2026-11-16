import { useId, useState } from "react";
import { Link } from "wouter";
import { X } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { StatusPill } from "./Status.js";
import { forgetAllTracked, forgetTracked, readRecent } from "../recent.js";
import type { Recent } from "../recent.js";

/**
 * The numbers this device tracked lately, each with the status it had when
 * last seen, so a second look is one press. Kept on the device alone, and
 * each can be taken off, or all of them.
 */
export function RecentlyTracked({ onOpen }: { onOpen?: () => void }) {
  const { t } = useLanguage();
  const [recent, setRecent] = useState<Recent[]>(readRecent);
  const titleId = useId();
  if (!recent.length) return null;
  return (
    <section className="recent" aria-labelledby={titleId}>
      <div className="recent-head">
        <h2 id={titleId}>{t("recent.title")}</h2>
        <button type="button" className="button button-quiet button-small" onClick={() => setRecent(forgetAllTracked())} aria-label={t("recent.clearName")}>
          <span aria-hidden="true">{t("recent.clear")}</span>
        </button>
      </div>
      <ul className="recent-list">
        {recent.map(item => (
          <li key={item.number}>
            <Link href={`/track/${item.number}`} className="recent-link" onClick={onOpen}>
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
