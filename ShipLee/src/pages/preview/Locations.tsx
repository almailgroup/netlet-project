import { useState } from "react";
import { Clock, MapPin, MapPinned, Search } from "lucide-react";
import { useLanguage } from "../../i18n.js";
import { usePageTitle } from "../../hooks.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { Destination } from "../../components/Destination.js";
import { GOVERNORATES, governorateName } from "../../../shared/kuwait.js";
import type { Governorate } from "../../../shared/kuwait.js";
import { foldDigits } from "../../../shared/digits.js";
import { SAMPLE_POINTS } from "../../samples/locations.js";
import type { PointService } from "../../samples/locations.js";
import type { Key } from "../../../shared/i18n.js";

const SERVICE_LABEL: Record<PointService, Key> = { dropOff: "locations.dropOff", collect: "locations.collect", returns: "locations.returns" };
import { PreviewHead } from "./PreviewHead.js";

/** Lower case, Arabic letters that are spelled more than one way made one, so "السالميه" finds "السالمية". */
function fold(text: string): string {
  return foldDigits(text).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").trim();
}

/**
 * A finder for drop-off points, with sample points: a search by name or area
 * in either language, a governorate filter, how many are shown, a place for
 * the map and the list. The count is said to a screen reader as it changes.
 */
export function Locations() {
  const { t, lang } = useLanguage();
  usePageTitle(t("title.locations"));
  const [query, setQuery] = useState("");
  const [governorate, setGovernorate] = useState<Governorate | "all">("all");
  const words = fold(query);
  const shown = SAMPLE_POINTS.filter(point => {
    if (governorate !== "all" && point.governorate !== governorate) return false;
    if (!words) return true;
    const haystack = fold([point.name.en, point.name.ar, point.area.en, point.area.ar, governorateName(point.governorate, "en"), governorateName(point.governorate, "ar")].join(" "));
    return haystack.includes(words);
  });

  return (
    <div className="container">
      <PreviewHead title={t("locations.title")} lead={t("locations.lead")} />

      <div className="locations-tools" role="search">
        <div className="field">
          <label className="sr-only" htmlFor="locations-search">{t("locations.search")}</label>
          <div className="input-icon">
            <Search size={18} aria-hidden="true" />
            <input id="locations-search" className="input" type="search" dir="auto" placeholder={t("locations.search")} value={query} onChange={event => setQuery(event.target.value)} />
          </div>
        </div>
        <div className="chips" role="group" aria-label={t("locations.governorate")}>
          <button type="button" className="chip" aria-pressed={governorate === "all"} onClick={() => setGovernorate("all")}>{t("locations.all")}</button>
          {GOVERNORATES.map(g => (
            <button key={g.slug} type="button" className="chip" aria-pressed={governorate === g.slug} onClick={() => setGovernorate(g.slug)}>{governorateName(g.slug, lang)}</button>
          ))}
        </div>
      </div>
      <p className="field-hint locations-count" aria-live="polite">{t("locations.shown", { shown: shown.length, total: SAMPLE_POINTS.length })}</p>

      <div className="locations-layout">
        <div className="placeholder locations-map">
          <div className="placeholder-text">
            <MapPinned size={28} aria-hidden="true" />
            <strong>{t("locations.map")}</strong>
          </div>
        </div>
        {shown.length ? (
          <ul className="locations-list">
            {shown.map(point => (
              <li key={point.id} className="card location">
                <h2 className="card-title">{point.name[lang]}</h2>
                <p className="location-line"><MapPin size={16} aria-hidden="true" /><span><Destination area={point.area[lang]} governorate={point.governorate} /></span></p>
                <p className="location-line"><Clock size={16} aria-hidden="true" /><span><span className="sr-only">{t("locations.hours")}: </span>{point.hours[lang]}</span></p>
                <p className="sr-only">{t("locations.services")}</p>
                <ul className="location-services">
                  {point.services.map(service => <li key={service} className="badge neutral">{t(SERVICE_LABEL[service])}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<MapPinned size={26} aria-hidden="true" />} title={t("locations.none")} headingLevel={2} />
        )}
      </div>
    </div>
  );
}
