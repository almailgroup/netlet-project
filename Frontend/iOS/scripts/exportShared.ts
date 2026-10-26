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
 * The web's pictures come across the same way (`buildAssets`): the logo, the
 * department art, NetLet's street and the home page's slides are copied byte
 * for byte from `Frontend/Web` into `NetLet/Resources/Web/`, under names that
 * say what each is, with `assets.json` saying which is which and the slides'
 * order. A picture replaced on the web is replaced in the app by running this,
 * and the test fails until it has been.
 *
 *     pnpm ios:resources            # write the files
 *     pnpm ios:resources --check    # fail when they are stale
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { en, ar } from "../../../Shared/i18n/dictionary.js";
import { PLURAL_FORMS } from "../../../Shared/i18n/plurals.js";
import { MIN_PASSWORD_LENGTH } from "../../../Shared/auth/passwordStrength.js";
import { DEPARTMENTS } from "../../../Shared/commerce/departments.js";
import { AREAS, PART_KEYS, PART_LABEL_AR, PART_LABEL_EN, PART_MAX, REQUIRED_PARTS } from "../../../Shared/commerce/kuwaitAddress.js";
import { GOVERNORATE_CENTRES, KUWAIT_BOUNDS, KUWAIT_CENTRE } from "../../../Shared/commerce/geo.js";
import { kuwaitDeliveryZones } from "../../../Shared/customer.js";
import { MAX_LINE_QUANTITY } from "../../../Shared/commerce/types.js";
import { MAX_DESCRIPTION, MAX_PHOTOS, MAX_SKU, MAX_STOCK, MAX_TITLE, WARRANTY_REQUIRED_DEPARTMENTS } from "../../../Shared/inventory/productDraft.js";
import { MAX_EDGE, MAX_UPLOAD_BYTES, MIN_EDGE } from "../../../Shared/commerce/media.js";
import { RETURN_WINDOW_DAYS } from "../../../Shared/commerce/returns.js";
import { COOKIE_NAME } from "../../../Shared/const.js";
import { NETLET_CONTACT } from "../../../Shared/commerce/contact.js";
import { MAX_ADDRESSES, MAX_LABEL, MAX_LINE, MAX_NOTES as MAX_ADDRESS_NOTES } from "../../../Shared/commerce/addresses.js";
import { defaultNotificationPreferences, notificationKinds, notificationLabelKeys } from "../../../Shared/customer.js";
import { MONEY_PARAMS } from "../../../Shared/commerce/notices.js";
import { MAX_OPEN_CONVERSATIONS, MAX_SUPPORT_MESSAGE, SUPPORT_TOPICS } from "../../../Shared/commerce/support.js";
import { GUIDE_SUMMARY_MAX, GUIDE_TITLE_MAX, GUIDE_TOPIC_MAX, MAX_GUIDE_STEPS, STEP_BODY_MAX, STEP_TITLE_MAX } from "../../../Shared/commerce/guides.js";
import { MAX_REVIEW_BODY, MAX_REVIEW_TITLE, RATING_MAX } from "../../../Shared/commerce/reviews.js";
import { ATTRIBUTION_DAYS, MAX_AFFILIATE_PERCENT, MIN_AFFILIATE_PAYOUT_FILS } from "../../../Shared/commerce/affiliate.js";
import { MAX_GRANT_MONTHS, MAX_GRANT_NOTE } from "../../../Shared/commerce/membership.js";
import { VOUCHER_KINDS } from "../../../Shared/commerce/vouchers.js";
import { FILS_PER_POINT, MIN_CASH_OUT_POINTS } from "../../../Shared/commerce/referral.js";
import { CLAIM_HOLD_DAYS, MAX_ITEMS_PER_LIST, MAX_LISTS_PER_SHOPPER } from "../../../Shared/commerce/wishlist.js";
import { ASK_WINDOW_DAYS, MAX_NOTE as MAX_OFFER_NOTE, OFFER_WINDOW_DAYS } from "../../../Shared/commerce/priceOffers.js";
import { MAX_MESSAGE_LENGTH } from "../../../Shared/commerce/contactFilter.js";
import { SUBSCRIPTION_INTERVALS } from "../../../Shared/commerce/subscriptions.js";
import { FOLD_FROM, FOLD_MARKS, FOLD_TO, MAX_QUERY_WORDS } from "../../../Shared/commerce/search.js";
import { SYNONYM_GROUPS } from "../../../Shared/commerce/searchSynonyms.js";
import { HELP_GROUPS, MAX_HELP_QUESTION } from "../../../Shared/commerce/helpArticles.js";
import { LEGAL_UPDATED, PRIVACY, SELLER_TERMS, TERMS } from "../../Web/src/content/legal.js";
import { SETTLEMENT_DAYS } from "../../../Shared/commerce/payoutSchedule.js";
import { DEFAULT_COMMISSION_PERCENT } from "../../../Shared/inventory/commission.js";
import { AGREEMENT_VERSION, MAX_COMMISSION_NOTE } from "../../../Shared/inventory/sellerApplication.js";
import { DOCUMENT_KINDS, DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "../../../Shared/inventory/applicationDocuments.js";
import { MAX_RETURN_NOTE, OPEN_RETURN_STATUSES, RETURN_KINDS, RETURN_REASONS } from "../../../Shared/commerce/returnRequests.js";
import { DELIVERY_RATING_WINDOW_DAYS, MAX_DELIVERY_COMMENT } from "../../../Shared/commerce/deliveryRatings.js";
import { CLAIM_WINDOW_DAYS, MAX_CLAIM_DESCRIPTION } from "../../../Shared/commerce/damageClaims.js";
import { DEPARTMENT_QUESTIONS, MAX_DESCRIPTION as MAX_BRIEF_DESCRIPTION, MAX_QUESTION, MAX_SPEC_ROWS, MAX_SUGGESTIONS } from "../../../Shared/commerce/assistant.js";
import { GATEWAY_ROUTES, MAX_CHAT_TEXT, MAX_CHAT_TURNS, MAX_IMAGES, MAX_NOTES } from "../../../Shared/ai/gateway.js";
import { ADMIN_ONLY, COURIER_CAPABILITIES, NEEDS, RANK } from "../../../Shared/inventory/permissions.js";
import { ADMIN_MENU } from "../../Web/src/content/adminMenu.js";
import { BULK_ACTIONS, BULK_LIMIT, MAX_PERCENT, MAX_RESTOCK, MIN_PERCENT } from "../../../Shared/inventory/productBulk.js";
import { MAX_PHOTO_CHARS, PHOTO_MAX_EDGE } from "../../../Shared/commerce/photoSearch.js";
import { FULFILMENT_STATES, nextStates } from "../../../Shared/commerce/fulfilment.js";
import { MAX_BANK_REFERENCE } from "../../../Shared/commerce/payoutRuns.js";
import { ATTRIBUTE_SCHEMA } from "../../../Shared/commerce/attributeSchema.js";
import { BASE_PER_UNIT, CANONICAL, DIMENSION_OF, SELL_UNITS } from "../../../Shared/commerce/units.js";
import { STOCK_REASONS } from "../../../Shared/inventory/stockMoves.js";
import { BY_CLASS, SIZE_CLASSES } from "../../../Shared/commerce/vehicle.js";
import { DELIVERY_SPEEDS } from "../../../Shared/commerce/deliverySpeed.js";
import {
  AWARDED_BADGES, FAST_SHIPPING_HOURS, FAST_SHIPPING_MIN_DELIVERIES, FAST_SHIPPING_SHARE, FAST_SHIPPING_WINDOW_DAYS,
  HIGH_RATING_FLOOR, HIGH_RATING_MIN_REVIEWS,
} from "../../../Shared/inventory/vendorHealth.js";
import { ADDON_KINDS } from "../../../Shared/commerce/addons.js";
import { OPTION_NAME_MAX, OPTION_VALUE_MAX } from "../../../Shared/inventory/variantOptions.js";
import { MAX_SIZE_LABEL, MAX_SIZES, MEASURE_BOUNDS, MEASURES } from "../../../Shared/commerce/sizeGuide.js";
import { BULK_UPLOAD_LIMIT, COLUMNS, DEPARTMENT_WORDS, templateCsv } from "../../../Shared/inventory/bulkUpload.js";
import { MAX_INBOUND_LINES, MAX_INBOUND_UNITS } from "../../../Shared/commerce/netletFulfilment.js";
import { MAX_CLAIM_RESPONSE } from "../../../Shared/commerce/damageClaims.js";
import {
  AD_CAPACITY, AD_RATES, AD_SLOTS, BANNER_ASPECT, BANNER_HEADLINE_MAX, BANNER_MAX_WIDTH, BANNER_MIN_WIDTH, BANNER_NOTE_MAX, MAX_AD_DAYS, MAX_AD_LEAD_DAYS,
} from "../../../Shared/commerce/adBookings.js";

export const OUT_DIR = path.resolve(import.meta.dirname, "../NetLet/Resources/Generated");
export const ASSET_DIR = path.resolve(import.meta.dirname, "../NetLet/Resources/Web");
const RESOURCES = path.resolve(import.meta.dirname, "../NetLet/Resources");
const INFO_PLIST = path.resolve(import.meta.dirname, "../Config/Info.plist");

/**
 * Why the app asks for a permission, in both languages: iOS shows the
 * `Info.plist` sentence, translated by each `.lproj`'s `InfoPlist.strings`.
 * The sentences are dictionary keys like every other word on screen.
 */
const PERMISSIONS = {
  NSLocationWhenInUseUsageDescription: "ios.permission.location",
  NSMicrophoneUsageDescription: "ios.permission.microphone",
  NSSpeechRecognitionUsageDescription: "ios.permission.speech",
  NSCameraUsageDescription: "ios.permission.camera",
} as const;

export function buildPermissionStrings(): Record<string, string> {
  const escape = (text: string) => text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const strings = (dictionary: Record<string, string>) =>
    Object.entries(PERMISSIONS).map(([name, key]) => `"${name}" = "${escape(dictionary[key])}";\n`).join("");
  return { "en.lproj/InfoPlist.strings": strings(en), "ar.lproj/InfoPlist.strings": strings(ar) };
}

/** The permissions `Info.plist` lacks, or carries in other words than the dictionary's English. */
function plistPermissionsStale(): string[] {
  const plist = readFileSync(INFO_PLIST, "utf-8");
  return Object.entries(PERMISSIONS)
    .filter(([name, key]) => !plist.includes(`<key>${name}</key>\n\t<string>${en[key]}</string>`))
    .map(([name]) => `Config/Info.plist (${name})`);
}
const WEB = path.resolve(import.meta.dirname, "../../Web");

/** A picture file the web draws, as the web finds it. */
const PICTURE = /\.(webp|png|jpe?g)$/i;

/**
 * Every picture the app draws from the web, by the name it has in the app's
 * bundle (which is flat, so each name says where it came from) and the file
 * it is copied from. The slides are the street, then `assets/hero/` in
 * file-name order — `heroSlides` in `brandAssets.ts`.
 */
export function buildAssets(): { files: Record<string, string>; manifest: { logo: string; footerLogo: string; heroSlides: string[]; departments: Record<string, string> } } {
  const files: Record<string, string> = {
    "brand-logo.png": path.join(WEB, "public/brand/netlet-logo.png"),
    "brand-logo-white.png": path.join(WEB, "public/brand/netlet-logo-white.png"),
  };
  const departments: Record<string, string> = {};
  for (const slug of [...DEPARTMENTS.map(department => department.slug), "all"]) {
    const name = `department-${slug}.webp`;
    files[name] = path.join(WEB, `public/departments/${slug}.webp`);
    departments[slug] = name;
  }
  const heroSlides: string[] = [];
  const street = readdirSync(path.join(WEB, "src/assets/auth")).filter(file => /^welcome\.(webp|png|jpe?g)$/i.test(file)).sort()[0];
  if (street) {
    const name = `hero-street${path.extname(street).toLowerCase()}`;
    files[name] = path.join(WEB, "src/assets/auth", street);
    heroSlides.push(name);
  }
  for (const slide of readdirSync(path.join(WEB, "src/assets/hero")).filter(file => PICTURE.test(file)).sort((left, right) => left.localeCompare(right))) {
    const name = `hero-${slide.toLowerCase().replace(/[^a-z0-9.]+/g, "-")}`;
    files[name] = path.join(WEB, "src/assets/hero", slide);
    heroSlides.push(name);
  }
  return { files, manifest: { logo: "brand-logo.png", footerLogo: "brand-logo-white.png", heroSlides, departments } };
}

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
      /* The words an address line is composed with (`composeAddressLine`). */
      partLabels: { en: PART_LABEL_EN, ar: PART_LABEL_AR },
      /* Where a pin may be, and where the map opens (`Shared/commerce/geo.ts`). */
      bounds: KUWAIT_BOUNDS,
      centre: KUWAIT_CENTRE,
      governorateCentres: GOVERNORATE_CENTRES,
    }),
    "rules.json": json({
      sessionCookie: COOKIE_NAME,
      /* The floor on a password being set — the server's own (`newPassword`). */
      minPasswordLength: MIN_PASSWORD_LENGTH,
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
      /* The footer's contact block before the server has answered, and in the demo. */
      contact: NETLET_CONTACT,
      /* What the account's sections hold a form to, and the choices they offer. */
      account: {
        maxAddresses: MAX_ADDRESSES,
        maxAddressLabel: MAX_LABEL,
        maxAddressLine: MAX_LINE,
        maxAddressNotes: MAX_ADDRESS_NOTES,
        notificationKinds: notificationKinds.map(kind => ({
          kind,
          label: notificationLabelKeys[kind],
          enabledByDefault: defaultNotificationPreferences[kind],
        })),
        moneyParams: MONEY_PARAMS,
        supportTopics: SUPPORT_TOPICS,
        maxSupportMessage: MAX_SUPPORT_MESSAGE,
        maxOpenConversations: MAX_OPEN_CONVERSATIONS,
        ratingMax: RATING_MAX,
        maxReviewTitle: MAX_REVIEW_TITLE,
        maxReviewBody: MAX_REVIEW_BODY,
        attributionDays: ATTRIBUTION_DAYS,
        minAffiliatePayoutFils: Number(MIN_AFFILIATE_PAYOUT_FILS),
        minCashOutPoints: MIN_CASH_OUT_POINTS,
        maxLists: MAX_LISTS_PER_SHOPPER,
        maxListItems: MAX_ITEMS_PER_LIST,
        claimHoldDays: CLAIM_HOLD_DAYS,
        askWindowDays: ASK_WINDOW_DAYS,
        offerWindowDays: OFFER_WINDOW_DAYS,
        maxOfferNote: MAX_OFFER_NOTE,
        maxMessage: MAX_MESSAGE_LENGTH,
        subscriptionIntervals: SUBSCRIPTION_INTERVALS,
      },
      orders: {
        returnKinds: RETURN_KINDS,
        returnReasons: RETURN_REASONS,
        openReturnStatuses: OPEN_RETURN_STATUSES,
        maxReturnNote: MAX_RETURN_NOTE,
        ratingWindowDays: DELIVERY_RATING_WINDOW_DAYS,
        maxDeliveryComment: MAX_DELIVERY_COMMENT,
        claimWindowDays: CLAIM_WINDOW_DAYS,
        maxClaimDescription: MAX_CLAIM_DESCRIPTION,
        filsPerPoint: Number(FILS_PER_POINT),
      },
      ai: {
        chatPath: GATEWAY_ROUTES.chat,
        maxChatTurns: MAX_CHAT_TURNS,
        maxChatText: MAX_CHAT_TEXT,
        maxQuestion: MAX_QUESTION,
        maxBriefDescription: MAX_BRIEF_DESCRIPTION,
        maxSpecRows: MAX_SPEC_ROWS,
        maxSuggestions: MAX_SUGGESTIONS,
        departmentQuestions: DEPARTMENT_QUESTIONS,
        photoMaxEdge: PHOTO_MAX_EDGE,
        maxPhotoChars: MAX_PHOTO_CHARS,
        catalogPath: GATEWAY_ROUTES.catalog,
        maxNotes: MAX_NOTES,
        maxDraftImages: MAX_IMAGES,
      },
    }),
    /* `rankBySearch`'s folding and synonyms, for a search the app answers
       from what it holds — a store's own shelf — by the shop's one rule. */
    "search.json": json({ foldFrom: FOLD_FROM, foldTo: FOLD_TO, foldMarks: FOLD_MARKS, maxQueryWords: MAX_QUERY_WORDS, synonymGroups: SYNONYM_GROUPS }),
    "assets.json": json(buildAssets().manifest),
    "content.json": json(buildContent()),
    /* The portal's menu and the permission model it is filtered by
       (`can`), so the app's portal offers the pages the web's does. */
    "portal.json": json({ menu: ADMIN_MENU, ranks: RANK, needs: NEEDS, adminOnly: ADMIN_ONLY, courier: COURIER_CAPABILITIES,
      bulk: { actions: BULK_ACTIONS, limit: BULK_LIMIT, minPercent: MIN_PERCENT, maxPercent: MAX_PERCENT, maxRestock: MAX_RESTOCK },
      /* Where a line may move next (`nextStates`), so the desk offers only the
         moves the server would take; and the payout schedule's own days. */
      fulfilment: Object.fromEntries(FULFILMENT_STATES.map(state => [state, nextStates(state)])),
      settlement: { cod: SETTLEMENT_DAYS.cod.min, cardMin: SETTLEMENT_DAYS.card.min, cardMax: SETTLEMENT_DAYS.card.max },
      maxBankReference: MAX_BANK_REFERENCE,
      /* The product editor's vocabulary: each department's specification
         rows, how units relate, the stock reasons, the size classes and the
         vehicle each needs, the delivery bands, the add-on kinds and the size
         chart's measures with their bounds. */
      editor: {
        attributeSchema: ATTRIBUTE_SCHEMA, sellUnits: SELL_UNITS, basePerUnit: BASE_PER_UNIT, dimensionOf: DIMENSION_OF,
        canonical: CANONICAL, stockReasons: STOCK_REASONS, sizeClasses: SIZE_CLASSES, vehicleByClass: BY_CLASS,
        deliverySpeeds: DELIVERY_SPEEDS, addonKinds: ADDON_KINDS, optionNameMax: OPTION_NAME_MAX, optionValueMax: OPTION_VALUE_MAX,
        measures: MEASURES, measureBounds: MEASURE_BOUNDS, maxSizes: MAX_SIZES, maxSizeLabel: MAX_SIZE_LABEL,
      },
      /* The spreadsheet import's columns, its department words and its
         template; NetLet's warehouse limits; and the placements' rates,
         room and banner shape. */
      upload: { columns: COLUMNS, departmentWords: DEPARTMENT_WORDS, limit: BULK_UPLOAD_LIMIT, template: templateCsv() },
      inbound: { maxLines: MAX_INBOUND_LINES, maxUnits: MAX_INBOUND_UNITS },
      maxClaimResponse: MAX_CLAIM_RESPONSE,
      ads: {
        slots: AD_SLOTS, rates: AD_RATES, capacity: AD_CAPACITY, maxDays: MAX_AD_DAYS, maxLeadDays: MAX_AD_LEAD_DAYS,
        headlineMax: BANNER_HEADLINE_MAX, noteMax: BANNER_NOTE_MAX, bannerAspect: BANNER_ASPECT, bannerMinWidth: BANNER_MIN_WIDTH, bannerMaxWidth: BANNER_MAX_WIDTH,
      },
      /* The badges a person awards, and the floors the measured ones are
         earned by, which a store's page says in words. */
      badges: {
        awarded: AWARDED_BADGES, highRatingFloor: HIGH_RATING_FLOOR, highRatingMinReviews: HIGH_RATING_MIN_REVIEWS,
        fastShare: FAST_SHIPPING_SHARE, fastHours: FAST_SHIPPING_HOURS, fastWindowDays: FAST_SHIPPING_WINDOW_DAYS,
        fastMinDeliveries: FAST_SHIPPING_MIN_DELIVERIES,
      },
      /* The money desks' limits: an affiliate's highest rate, how long a
         membership may be granted for, and the kinds of discount code. */
      money: {
        maxAffiliatePercent: MAX_AFFILIATE_PERCENT, maxGrantMonths: MAX_GRANT_MONTHS, maxGrantNote: MAX_GRANT_NOTE,
        voucherKinds: VOUCHER_KINDS,
      },
      /* The guide editor's lengths (`guides.ts`), which the router refuses past. */
      guides: {
        titleMax: GUIDE_TITLE_MAX, summaryMax: GUIDE_SUMMARY_MAX, stepTitleMax: STEP_TITLE_MAX, stepBodyMax: STEP_BODY_MAX,
        maxSteps: MAX_GUIDE_STEPS, topicMax: GUIDE_TOPIC_MAX,
      } }),
  };
}

/**
 * The pages that are words: the help page's answers, the three legal
 * documents and the seller application's rules — message keys and the
 * figures their sentences are drawn with, never the sentences themselves,
 * so the app's terms cannot quote a rate or a window the code does not use.
 */
export function buildContent() {
  return {
    help: { groups: HELP_GROUPS, maxQuestion: MAX_HELP_QUESTION },
    legal: {
      updated: LEGAL_UPDATED,
      /* What `pages/Legal.tsx` draws every sentence with. */
      figures: {
        days: RETURN_WINDOW_DAYS,
        commission: Number(DEFAULT_COMMISSION_PERCENT),
        codDays: SETTLEMENT_DAYS.cod.min,
        askDays: ASK_WINDOW_DAYS,
        offerDays: OFFER_WINDOW_DAYS,
        version: AGREEMENT_VERSION,
      },
      documents: {
        terms: { title: "terms.title", intro: "terms.intro", plain: "terms.introPlain", sections: TERMS },
        privacy: { title: "privacy.title", intro: "privacy.intro", plain: "privacy.introPlain", sections: PRIVACY },
        sellers: { title: "sellerTerms.title", intro: "sellerTerms.intro", plain: "sellerTerms.introPlain", sections: SELLER_TERMS },
      },
    },
    selling: {
      agreementVersion: AGREEMENT_VERSION,
      defaultCommission: DEFAULT_COMMISSION_PERCENT,
      maxCommissionNote: MAX_COMMISSION_NOTE,
      documentKinds: DOCUMENT_KINDS,
      documentTypes: DOCUMENT_TYPES,
      maxDocumentBytes: MAX_DOCUMENT_BYTES,
    },
  };
}

/** The names of committed files that differ from what would be written. */
export function staleResources(): string[] {
  const texts = Object.entries(buildResources())
    .filter(([name, text]) => {
      try {
        return readFileSync(path.join(OUT_DIR, name), "utf-8") !== text;
      } catch {
        return true;
      }
    })
    .map(([name]) => name);
  const { files } = buildAssets();
  const pictures = Object.entries(files)
    .filter(([name, source]) => {
      try {
        return !readFileSync(path.join(ASSET_DIR, name)).equals(readFileSync(source));
      } catch {
        return true;
      }
    })
    .map(([name]) => `Web/${name}`);
  /* A picture the web no longer has is one the app should not keep drawing. */
  const leftover = listed(ASSET_DIR).filter(name => !(name in files)).map(name => `Web/${name} (no longer on the web)`);
  const permissions = Object.entries(buildPermissionStrings())
    .filter(([name, text]) => {
      try {
        return readFileSync(path.join(RESOURCES, name), "utf-8") !== text;
      } catch {
        return true;
      }
    })
    .map(([name]) => name);
  return [...texts, ...pictures, ...leftover, ...permissions, ...plistPermissionsStale()];
}

function listed(dir: string): string[] {
  try {
    return readdirSync(dir).filter(name => !name.startsWith("."));
  } catch {
    return [];
  }
}

function writeAssets() {
  const { files } = buildAssets();
  mkdirSync(ASSET_DIR, { recursive: true });
  for (const name of listed(ASSET_DIR)) if (!(name in files)) rmSync(path.join(ASSET_DIR, name));
  for (const [name, source] of Object.entries(files)) writeFileSync(path.join(ASSET_DIR, name), readFileSync(source));
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
    writeAssets();
    for (const [name, text] of Object.entries(buildPermissionStrings())) {
      mkdirSync(path.dirname(path.join(RESOURCES, name)), { recursive: true });
      writeFileSync(path.join(RESOURCES, name), text);
    }
    for (const stale of plistPermissionsStale()) console.warn(`${stale} should say the dictionary's English — edit it by hand.`);
    console.log(`Wrote ${Object.keys(buildResources()).length} files to ${path.relative(process.cwd(), OUT_DIR)} and ${Object.keys(buildAssets().files).length} pictures to ${path.relative(process.cwd(), ASSET_DIR)}`);
  }
}
