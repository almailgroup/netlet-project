/**
 * The iOS app's copy of the rules in `Shared/`, as JSON it can read.
 *
 * Swift cannot import TypeScript, and a second hand-written copy of the
 * departments, the governorates or the dictionary would drift the first time
 * one side changed. So the app reads files generated from the same modules the
 * web and the server import, and `exportShared.test.ts` fails while a
 * committed file differs from what this would write — the rule
 * `docs/schema-audit.sql` already follows.
 *
 * Every string the app shows is a key in `Shared/i18n/dictionary.ts`, in both
 * languages, so the dictionary's own tests (no untranslated Arabic, the same
 * placeholders on both sides, no key nothing uses) cover the app's copy too.
 *
 *     pnpm ios:resources            # write the files
 *     pnpm ios:resources --check    # fail when they are stale
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { en, ar } from "../../../Shared/i18n/dictionary.js";
import { PLURAL_FORMS } from "../../../Shared/i18n/plurals.js";
import { DEPARTMENTS } from "../../../Shared/commerce/departments.js";
import { AREAS, PART_KEYS, PART_MAX, REQUIRED_PARTS } from "../../../Shared/commerce/kuwaitAddress.js";
import { kuwaitDeliveryZones } from "../../../Shared/customer.js";
import { MAX_LINE_QUANTITY } from "../../../Shared/commerce/types.js";
import { MAX_DESCRIPTION, MAX_PHOTOS, MAX_SKU, MAX_STOCK, MAX_TITLE, WARRANTY_REQUIRED_DEPARTMENTS } from "../../../Shared/inventory/productDraft.js";
import { MAX_EDGE, MAX_UPLOAD_BYTES, MIN_EDGE } from "../../../Shared/commerce/media.js";
import { RETURN_WINDOW_DAYS } from "../../../Shared/commerce/returns.js";
import { COOKIE_NAME } from "../../../Shared/const.js";

export const OUT_DIR = path.resolve(import.meta.dirname, "../NetLet/Resources/Generated");

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Each file the app reads, by name, with the text it should hold. */
export function buildResources(): Record<string, string> {
  return {
    "dictionary.json": json({ en, ar }),
    "plurals.json": json(PLURAL_FORMS),
    "departments.json": json(
      DEPARTMENTS.map(({ slug, name, nameAr, position, label, icon }) => ({ slug, name, nameAr, position, label, icon })),
    ),
    "kuwait.json": json({
      governorates: kuwaitDeliveryZones.map(({ id, label, labelAr }) => ({ id, label, labelAr })),
      areas: AREAS,
      partKeys: PART_KEYS,
      requiredParts: REQUIRED_PARTS,
      partMax: PART_MAX,
    }),
    "rules.json": json({
      sessionCookie: COOKIE_NAME,
      maxLineQuantity: MAX_LINE_QUANTITY,
      returnWindowDays: RETURN_WINDOW_DAYS,
      listing: {
        maxTitle: MAX_TITLE,
        maxSku: MAX_SKU,
        maxStock: MAX_STOCK,
        maxDescription: MAX_DESCRIPTION,
        maxPhotos: MAX_PHOTOS,
        warrantyRequiredDepartments: WARRANTY_REQUIRED_DEPARTMENTS,
      },
      media: { maxEdge: MAX_EDGE, minEdge: MIN_EDGE, maxUploadBytes: MAX_UPLOAD_BYTES },
    }),
  };
}

/** The names of committed files that differ from what would be written. */
export function staleResources(): string[] {
  return Object.entries(buildResources())
    .filter(([name, text]) => {
      try {
        return readFileSync(path.join(OUT_DIR, name), "utf-8") !== text;
      } catch {
        return true;
      }
    })
    .map(([name]) => name);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  if (process.argv.includes("--check")) {
    const stale = staleResources();
    if (stale.length) {
      console.error(`Stale iOS resources: ${stale.join(", ")} — run \`pnpm ios:resources\`.`);
      process.exit(1);
    }
  } else {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const [name, text] of Object.entries(buildResources())) writeFileSync(path.join(OUT_DIR, name), text);
    console.log(`Wrote ${Object.keys(buildResources()).length} files to ${path.relative(process.cwd(), OUT_DIR)}`);
  }
}
