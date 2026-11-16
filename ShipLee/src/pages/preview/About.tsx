import { Link } from "wouter";
import { useLanguage } from "../../i18n.js";
import { usePageTitle } from "../../hooks.js";
import type { Key } from "../../../shared/i18n.js";
import { PreviewHead } from "./PreviewHead.js";

const VALUES: readonly Key[] = ["about.value.where", "about.value.door", "about.value.cash"];

/** Who ShipLee is, in sample words: the first two paragraphs are what the site does, the rest is for ShipLee to write. */
export function About() {
  const { t } = useLanguage();
  usePageTitle(t("title.about"));
  return (
    <div className="container">
      <PreviewHead title={t("about.title")} lead={t("about.lead")} />
      <div className="prose">
        <p>{t("about.what")}</p>
        <p>{t("about.how")}</p>
      </div>
      <section className="section" aria-labelledby="values-title">
        <h2 id="values-title" className="section-title">{t("about.valuesTitle")}</h2>
        <ul className="plain-list">
          {VALUES.map(key => <li key={key}>{t(key)}</li>)}
        </ul>
      </section>
      <p className="more-link"><Link href="/careers">{t("nav.careers")}</Link></p>
    </div>
  );
}
