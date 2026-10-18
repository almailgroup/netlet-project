/**
 * Applies a page's metadata to the document.
 *
 * A single-page app never reloads, so the tags baked into index.html describe
 * the home page and nothing else. Without this, every product shared into
 * WhatsApp or posted on Instagram carried the same title, the same blurb and
 * the same picture — and search engines indexed one page for the whole shop.
 *
 * Tags are upserted by selector and left in place on unmount rather than
 * removed: the next page overwrites them, and removing them first would leave
 * a crawler that snapshots mid-navigation with no metadata at all.
 */
import type { PageMeta } from "@shared/seo";
import { useEffect } from "react";

const JSON_LD_ID = "netlet-structured-data";

/** The origin the canonical and share URLs are built from. */
export const SITE_URL: string =
  import.meta.env.VITE_SITE_URL?.replace(/\/+$/, "") ||
  (typeof window !== "undefined" ? window.location.origin : "https://almailgroup.github.io/netlet-project");

function upsertMeta(attribute: "name" | "property", key: string, content: string): void {
  const selector = `meta[${attribute}="${key}"]`;
  let tag = document.head.querySelector<HTMLMetaElement>(selector);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.content = content;
}

function upsertLink(rel: string, href: string): void {
  let tag = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement("link");
    tag.rel = rel;
    document.head.appendChild(tag);
  }
  tag.href = href;
}

function removeTag(selector: string): void {
  document.head.querySelector(selector)?.remove();
}

export function usePageMeta(meta: PageMeta, structuredData?: Record<string, unknown>[]): void {
  // Serialised rather than passed by reference: callers build these objects
  // inline, so a reference dependency would re-run the effect every render.
  const key = JSON.stringify([meta, structuredData ?? null]);

  useEffect(() => {
    document.title = meta.title;
    upsertMeta("name", "description", meta.description);

    upsertMeta("property", "og:site_name", "NetLet");
    upsertMeta("property", "og:title", meta.title);
    upsertMeta("property", "og:description", meta.description);
    upsertMeta("property", "og:type", meta.type);
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", meta.title);
    upsertMeta("name", "twitter:description", meta.description);

    if (meta.image) {
      upsertMeta("property", "og:image", meta.image);
      upsertMeta("name", "twitter:image", meta.image);
    }

    if (meta.canonical) {
      upsertMeta("property", "og:url", meta.canonical);
      upsertLink("canonical", meta.canonical);
    } else {
      // A canonical pointing at the previous page is worse than none at all.
      removeTag('link[rel="canonical"]');
    }

    // Checkout and account must not be indexed. The tag has to be removed
    // again on the way out, or the whole site stays noindex after one visit.
    if (meta.noindex) upsertMeta("name", "robots", "noindex, nofollow");
    else removeTag('meta[name="robots"]');

    removeTag(`#${JSON_LD_ID}`);
    if (structuredData?.length) {
      const script = document.createElement("script");
      script.id = JSON_LD_ID;
      script.type = "application/ld+json";
      script.textContent = JSON.stringify(structuredData.length === 1 ? structuredData[0] : structuredData);
      document.head.appendChild(script);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
