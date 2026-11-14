import { Fragment } from "react";
import { useLanguage } from "../i18n.js";
import type { Governorate } from "../../shared/kuwait.js";
import { governorateName } from "../../shared/kuwait.js";

/**
 * "Salmiya, Hawalli": the area as staff typed it, isolated so an English area
 * on the Arabic page does not pull the governorate's name to its side, and the
 * governorate in the page's language.
 */
export function Destination({ area, governorate }: { area: string | null; governorate: Governorate | null }) {
  const { lang } = useLanguage();
  const parts = [area ? <bdi key="area">{area}</bdi> : null, governorate ? <Fragment key="gov">{governorateName(governorate, lang)}</Fragment> : null].filter(Boolean);
  return <>{parts.map((part, index) => <Fragment key={index}>{index > 0 ? (lang === "ar" ? "، " : ", ") : null}{part}</Fragment>)}</>;
}
