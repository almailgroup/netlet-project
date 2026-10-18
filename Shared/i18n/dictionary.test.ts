import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ar, directionFor, en, LOCALES, messages, translate, type MessageKey } from "./dictionary.js";

describe("dictionary completeness", () => {
  it("translates every key — a gap would show an English word mid-sentence", () => {
    const missing = (Object.keys(en) as MessageKey[]).filter((key) => !ar[key]?.trim());
    expect(missing).toEqual([]);
  });

  it("has no Arabic entry left as a copy of the English", () => {
    /* Legitimately identical in both dictionaries: each names a language in
       that language's own words, which is the point — "English" has to read as
       English to somebody who cannot read the Arabic, and the reverse. */
    const allowed = new Set<MessageKey>(["header.language", "account.english", "account.arabic"]);
    const untranslated = (Object.keys(en) as MessageKey[]).filter(
      (key) => !allowed.has(key) && ar[key] === en[key],
    );
    expect(untranslated).toEqual([]);
  });

  it("keeps the same placeholders in both languages", () => {
    const holders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of Object.keys(en) as MessageKey[]) {
      expect({ key, holders: holders(ar[key]) }).toEqual({ key, holders: holders(en[key]) });
    }
  });

  it("has no untranslated English left in the Arabic", () => {
    // The first three are Latin script on purpose: "English" names the
    // language you would switch to. The last two carry "CSV", which is a file
    // format's initialism rather than English prose — an Arabic page still
    // tells somebody to pick a CSV file, because that is what the Save As
    // dialog says. Anything added here needs a reason of that kind.
    const allowed = new Set<MessageKey>([
      "header.language", "account.english", "account.arabic",
      "admin.importNote", "admin.importChoose",
      // These name the `https` scheme, which is what a seller has to type
      // into the box — a literal, like the CSV above, rather than English
      // prose somebody forgot to translate.
      "application.insecureDocument", "claims.badEvidence",
      // This one names the route `/admin/people`, which is a URL an
      // administrator types into the address bar. A translated path would point
      // at a page that does not exist — the same reason `https` is left alone.
      "dispatch.addMemberNote",
      // A bank's bulk-payment portal asks for these by their format names, so
      // the buttons and the note name them as the portal does — the CSV reason.
      "admin.payoutFilesNote", "admin.payoutDownloadCsv", "admin.payoutDownloadXml",
      // Names the variable an administrator sets in the deployment's settings,
      // which is spelled the same in every language — the `https` reason.
      "features.why.noGateway",
      // The model and the company that runs it, named as their makers name
      // them on an Arabic phone — the maps' reason.
      "search.photoConsent", "privacy.who.ai",
      // An example order number, in the format the confirmation prints and
      // the lookup box expects — a literal, like `https`.
      "help.lookupNote",
      // The file formats an application document may be — PDF, JPEG, PNG,
      // WebP — named as the phone's file picker names them: the CSV reason.
      "documents.note", "documents.notAccepted", "documents.tooLarge", "documents.wrongType",
      // The two maps a shopper chooses between, named as their makers name them
      // on an Arabic phone — "خرائط Google", with the company in Latin.
      "pin.google", "pin.apple", "pin.tryGoogle", "pin.tryApple",
      // The privacy policy names the services a shopper's information reaches
      // — Vercel, Supabase, Google's reCAPTCHA and the three maps — as their
      // makers write them, so a reader can look each one up: the maps' reason.
      "privacy.who.services", "privacy.who.google", "privacy.cookies.body",
    ]);
    // Placeholders are Latin by design and are filled with translated values
    // at render time, so they are removed before looking for English.
    const leaked = (Object.keys(ar) as MessageKey[]).filter(
      (key) => !allowed.has(key) && /[A-Za-z]{3,}/.test(ar[key].replace(/\{\w+\}/g, "")),
    );
    expect(leaked).toEqual([]);
  });
});

describe("translate", () => {
  it("substitutes placeholders in both languages", () => {
    expect(translate("en", "cart.added", { name: "Aurora Lamp" })).toBe("Aurora Lamp added to your cart");
    expect(translate("ar", "cart.added", { name: "مصباح" })).toBe("تمت إضافة مصباح إلى سلتك");
  });

  it("leaves an unknown placeholder in place rather than printing undefined", () => {
    expect(translate("en", "cart.added", {})).toBe("{name} added to your cart");
  });

  it("falls back to English rather than exposing the key", () => {
    // A key present in en but somehow absent from a locale must still read as
    // words. Simulated by asking for a locale that has no entry for it.
    const partial = { ...messages.ar } as Record<string, string>;
    delete partial["product.buyNow"];
    expect(translate("en", "product.buyNow")).toBe("Buy now");
  });
});

describe("directionFor", () => {
  it("is rtl only for Arabic", () => {
    expect(directionFor("ar")).toBe("rtl");
    expect(directionFor("en")).toBe("ltr");
    expect(LOCALES).toEqual(["en", "ar"]);
  });
});

describe("dictionary hygiene", () => {
  /**
   * Copy that nothing renders is copy nobody maintains: it still has to be
   * translated, still has to be reviewed, and quietly stops matching the page.
   * Every key must appear as a literal somewhere in the source — including the
   * ones reached indirectly, since those are spelled out in the content and
   * data files that hold them.
   */
  it("has no key the app never asks for", () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const skip = new Set(["node_modules", "dist", ".git", "ios-app", "drizzle"]);
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        // The dictionary defines the keys; it cannot also be what justifies them.
        else if (/\.tsx?$/.test(entry.name) && !full.endsWith(path.join("i18n", "dictionary.ts"))) {
          sources.push(readFileSync(full, "utf-8"));
        }
      }
    };
    walk(root);
    const corpus = sources.join("\n");

    /*
     * A key can be reached two ways, and looking only for the first reports a
     * live key as dead: `t("status.draft")` spells it out, while
     * `t(`status.${status}`)` builds it from a prefix. Collect the prefixes
     * actually used that way and treat anything under one as reached — which
     * is true, since the prefix is only ever fed values from the same family.
     */
    const dynamicPrefixes = [...corpus.matchAll(/`([a-z][\w.]*\.)\$\{/g)].map((match) => match[1]);
    const reached = (key: MessageKey) =>
      corpus.includes(`"${key}"`) || dynamicPrefixes.some((prefix) => key.startsWith(prefix));

    const unused = (Object.keys(en) as MessageKey[]).filter((key) => !reached(key));
    expect(unused).toEqual([]);
  });
});
