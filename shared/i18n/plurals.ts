/**
 * The forms a counted sentence takes, by the number in it.
 *
 * English has two — one and other — and the dictionary already carries most
 * of them as `…One` keys the call site picks. **Arabic has six**, and a
 * dictionary with one Arabic string per key wrote every count in one of them:
 * "3 منتج" on a department page where Arabic says "3 منتجات", and "بقي 3
 * يوماً" under a return window where it says "بقي 3 أيام". Arabic counts its
 * noun in the plural from three to ten, in the accusative singular from eleven
 * to ninety-nine, in the genitive singular from a hundred, in the dual for
 * two and with "one" after it for one — so a single string is right for one
 * band of numbers and wrong for the rest.
 *
 * `Intl.PluralRules` knows the bands (`zero`, `one`, `two`, `few`, `many`,
 * `other`) in both languages, so nothing here counts by hand. Each entry names
 * the value that decides (`count`, `days`, `total`) and gives the sentence for
 * the bands its dictionary string is wrong in; a band it leaves out is the
 * dictionary's own string, which is therefore always one of the forms. Whole
 * sentences rather than a noun swapped into place, because the dual's case
 * follows the sentence — "بقي يومان" but "منذ يومين" — and only the sentence
 * knows which it is.
 *
 * `translate` applies it, so a call site passes the number and nothing else
 * changes. Only sentences whose number moves are here: one written for a
 * constant (the fourteen-day return window) is right for its constant, and
 * `plurals.test.ts` fails when the constant moves into another band.
 */
import type { LocaleCode, MessageKey } from "./dictionary.js";

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

type Forms = Partial<Record<PluralCategory, string>>;

export type PluralEntry = {
  /** The value whose number decides the form. */
  param: string;
  en?: Forms;
  ar?: Forms;
};

export const PLURAL_FORMS: Partial<Record<MessageKey, PluralEntry>> = {
  /* ------------------------------------------------------------ shoppers --- */
  "browse.countMany": {
    param: "count",
    ar: { two: "منتجان", few: "{count} منتجات", many: "{count} منتجاً" },
  },
  "home.brandCountMany": {
    param: "count",
    ar: { two: "منتجان", many: "{count} منتجاً", other: "{count} منتج" },
  },
  "browse.countBestOf": {
    param: "total",
    ar: { few: "أفضل {count} من {total} منتجات", many: "أفضل {count} من {total} منتجاً" },
  },
  "browse.showResults": {
    param: "count",
    en: { one: "Show 1 result" },
    ar: { one: "عرض نتيجة واحدة", two: "عرض نتيجتين", few: "عرض {count} نتائج" },
  },
  "browse.searchAllMany": {
    param: "count",
    ar: { two: "اعرض نتيجتين في كل الأقسام", many: "اعرض {count} نتيجة في كل الأقسام", other: "اعرض {count} نتيجة في كل الأقسام" },
  },
  "search.suggestionCount": {
    param: "count",
    ar: {
      two: "اقتراحان. استخدم السهمين لأعلى ولأسفل للاختيار.",
      many: "{count} اقتراحاً. استخدم السهمين لأعلى ولأسفل للاختيار.",
      other: "{count} اقتراح. استخدم السهمين لأعلى ولأسفل للاختيار.",
    },
  },
  "saved.count": {
    param: "count",
    ar: { two: "منتجان محفوظان", many: "{count} منتجاً محفوظاً", other: "{count} منتج محفوظ" },
  },
  "wish.itemCount": {
    param: "count",
    en: { one: "1 item" },
    ar: { one: "منتج واحد", two: "منتجان", many: "{count} منتجاً", other: "{count} منتج" },
  },
  "review.count": {
    param: "count",
    en: { one: "1 review" },
    ar: { one: "تقييم واحد", two: "تقييمان", many: "{count} تقييماً", other: "{count} تقييم" },
  },
  "product.reviews": {
    param: "count",
    en: { one: "1 review" },
    ar: { one: "تقييم واحد", two: "تقييمان", many: "{count} تقييماً", other: "{count} تقييم" },
  },
  "product.ratingAriaCount": {
    param: "count",
    en: { one: "Rated {value} out of {max} from 1 review" },
    ar: {
      one: "التقييم {value} من {max} بناءً على تقييم واحد",
      two: "التقييم {value} من {max} بناءً على تقييمين",
      many: "التقييم {value} من {max} بناءً على {count} تقييماً",
      other: "التقييم {value} من {max} بناءً على {count} تقييم",
    },
  },
  "review.stars": {
    param: "count",
    en: { one: "1 star" },
    ar: { one: "نجمة واحدة", two: "نجمتان" },
  },
  "delivery.scoreLine": {
    param: "count",
    en: { one: "{average} from 1 rating" },
    ar: { two: "{average} من تقييمين", many: "{average} من {count} تقييماً", other: "{average} من {count} تقييم" },
  },
  "follow.waiting": {
    param: "count",
    en: { one: "1 person is waiting for this" },
    ar: {
      one: "شخص واحد ينتظر هذا المنتج",
      two: "شخصان ينتظران هذا المنتج",
      many: "{count} شخصاً ينتظرون هذا المنتج",
      other: "{count} شخص ينتظرون هذا المنتج",
    },
  },
  "orders.andMore": {
    param: "count",
    ar: { one: "ومنتج آخر", two: "ومنتجان آخران", few: "و{count} منتجات أخرى", many: "و{count} منتجاً آخر" },
  },
  "cart.recoveryTitle": {
    param: "count",
    ar: { two: "تركت منتجين هنا", many: "تركت {count} منتجاً هنا", other: "تركت {count} منتج هنا" },
  },
  "cart.recoveryNoteDays": {
    param: "days",
    en: { one: "Still in your bag from yesterday. Prices are whatever they are today." },
    ar: {
      one: "ما زالت في سلتك منذ يوم. الأسعار هي أسعار اليوم.",
      two: "ما زالت في سلتك منذ يومين. الأسعار هي أسعار اليوم.",
      many: "ما زالت في سلتك منذ {days} يوماً. الأسعار هي أسعار اليوم.",
      other: "ما زالت في سلتك منذ {days} يوم. الأسعار هي أسعار اليوم.",
    },
  },
  "returns.openUntil": {
    param: "days",
    en: { zero: "Returnable until {date} — last day today", one: "Returnable until {date} — 1 day left" },
    ar: {
      zero: "قابل للإرجاع حتى {date} — اليوم آخر يوم",
      one: "قابل للإرجاع حتى {date} — بقي يوم واحد",
      two: "قابل للإرجاع حتى {date} — بقي يومان",
      few: "قابل للإرجاع حتى {date} — بقي {days} أيام",
      other: "قابل للإرجاع حتى {date} — بقي {days} يوم",
    },
  },
  "offers.statusOfferedNote": {
    param: "days",
    en: { one: "Yours for 1 more day. It is applied in your bag automatically." },
    ar: {
      one: "السعر لك يوماً آخر، ويُطبَّق في سلتك تلقائياً.",
      two: "السعر لك يومين آخرين، ويُطبَّق في سلتك تلقائياً.",
      many: "السعر لك {days} يوماً آخر، ويُطبَّق في سلتك تلقائياً.",
      other: "السعر لك {days} يوم آخر، ويُطبَّق في سلتك تلقائياً.",
    },
  },
  "subscribe.weeks": {
    param: "count",
    en: { one: "1 week" },
    ar: { one: "أسبوع واحد", two: "أسبوعان", many: "{count} أسبوعاً", other: "{count} أسبوع" },
  },
  "ads.quoteLine": {
    param: "days",
    ar: {
      one: "{total} — {rate} لليوم لمدة يوم واحد",
      two: "{total} — {rate} لليوم لمدة يومين",
      few: "{total} — {rate} لليوم لمدة {days} أيام",
      other: "{total} — {rate} لليوم لمدة {days} يوم",
    },
  },
  "sizeGuide.runsSmall": {
    param: "total",
    ar: {
      many: "مقاسه صغير: {count} من {total} متسوقاً أعادوه بسبب المقاس قالوا إنه صغير.",
      other: "مقاسه صغير: {count} من {total} متسوق أعادوه بسبب المقاس قالوا إنه صغير.",
    },
  },
  "sizeGuide.runsLarge": {
    param: "total",
    ar: {
      many: "مقاسه كبير: {count} من {total} متسوقاً أعادوه بسبب المقاس قالوا إنه كبير.",
      other: "مقاسه كبير: {count} من {total} متسوق أعادوه بسبب المقاس قالوا إنه كبير.",
    },
  },

  /* --------------------------------------------------------------- staff --- */
  "dispatch.items": {
    param: "count",
    ar: { two: "قطعتان", many: "{count} قطعة", other: "{count} قطعة" },
  },
  "dispatch.truncated": {
    param: "count",
    ar: {
      many: "تُعرض أحدث {count} طلباً. الطرود الأقدم غير مدرجة.",
      other: "تُعرض أحدث {count} طلب. الطرود الأقدم غير مدرجة.",
    },
  },
  "admin.orderSellers": {
    param: "count",
    en: { one: "1 seller" },
    ar: { one: "بائع واحد", two: "بائعان", many: "{count} بائعاً", other: "{count} بائع" },
  },
  "admin.variantCount": {
    param: "count",
    ar: { two: "خياران", many: "{count} خياراً", other: "{count} خيار" },
  },
  "admin.peopleCount": {
    param: "count",
    en: { one: "1 account" },
    ar: { one: "حساب واحد", two: "حسابان", many: "{count} حساباً", other: "{count} حساب" },
  },
  "admin.statDrafts": {
    param: "count",
    en: { one: "1 draft" },
    ar: { one: "مسودة واحدة", two: "مسودتان", many: "{count} مسودة", other: "{count} مسودة" },
  },
  "admin.bundleCrossVendor": {
    param: "count",
    ar: { two: "عبر متجرين", many: "عبر {count} متجراً", other: "عبر {count} متجر" },
  },
  "admin.incompletePlural": {
    param: "count",
    ar: { two: "ما زال هناك بيانان ناقصان", many: "ما زال هناك {count} بياناً ناقصاً", other: "ما زال هناك {count} بيان ناقص" },
  },
  "admin.newFixMany": {
    param: "count",
    ar: { two: "حقلان يحتاجان إلى مراجعة.", many: "{count} حقلاً تحتاج إلى مراجعة.", other: "{count} حقل تحتاج إلى مراجعة." },
  },
  "admin.bulkRestockTitle": {
    param: "count",
    en: { one: "Add stock to 1 product" },
    ar: { one: "إضافة مخزون إلى منتج واحد", two: "إضافة مخزون إلى منتجين", many: "إضافة مخزون إلى {count} منتجاً", other: "إضافة مخزون إلى {count} منتج" },
  },
  "admin.bulkRepriceTitle": {
    param: "count",
    en: { one: "Change the price of 1 product" },
    ar: { one: "تغيير سعر منتج واحد", two: "تغيير سعر منتجين", many: "تغيير سعر {count} منتجاً", other: "تغيير سعر {count} منتج" },
  },
  "admin.bulkDraftTitle": {
    param: "count",
    en: { one: "Move 1 product to draft?" },
    ar: { one: "نقل منتج واحد إلى المسودات؟", two: "نقل منتجين إلى المسودات؟", many: "نقل {count} منتجاً إلى المسودات؟", other: "نقل {count} منتج إلى المسودات؟" },
  },
  "admin.bulkArchiveTitle": {
    param: "count",
    en: { one: "Archive 1 product?" },
    ar: { one: "أرشفة منتج واحد؟", two: "أرشفة منتجين؟", many: "أرشفة {count} منتجاً؟", other: "أرشفة {count} منتج؟" },
  },
  "admin.bulkPublishTitle": {
    param: "count",
    en: { one: "Publish 1 product?" },
    ar: { one: "نشر منتج واحد؟", two: "نشر منتجين؟", many: "نشر {count} منتجاً؟", other: "نشر {count} منتج؟" },
  },
  "admin.waitingForRestock": {
    param: "count",
    en: { one: "1 shopper asked to hear when it is back" },
    ar: {
      one: "متسوق واحد طلب إشعاره عند توفره",
      two: "متسوقان طلبا إشعارهما عند توفره",
      many: "{count} متسوقاً طلبوا إشعارهم عند توفره",
      other: "{count} متسوق طلبوا إشعارهم عند توفره",
    },
  },
  "admin.deleteOpenOrders": {
    param: "count",
    en: { one: "1 order with it still needs sending. It keeps its copy of the product and stays on Orders." },
    ar: {
      one: "طلب واحد يحتويه ما زال بانتظار الإرسال. يحتفظ بنسخته من المنتج ويبقى في صفحة الطلبات.",
      two: "طلبان يحتويانه ما زالا بانتظار الإرسال. يحتفظان بنسختهما من المنتج ويبقيان في صفحة الطلبات.",
      many: "{count} طلباً تحتويه ما زالت بانتظار الإرسال. تحتفظ بنسختها من المنتج وتبقى في صفحة الطلبات.",
      other: "{count} طلب تحتويه ما زالت بانتظار الإرسال. تحتفظ بنسختها من المنتج وتبقى في صفحة الطلبات.",
    },
  },
  "admin.payoutPrepareAllTitle": {
    param: "count",
    en: { one: "Prepare 1 payout?" },
    ar: { one: "تجهيز دفعة واحدة؟", two: "تجهيز دفعتين؟", few: "تجهيز {count} دفعات؟" },
  },
  "fulfilment.packedToast": {
    param: "count",
    en: { one: "1 line packed and ready to collect." },
    ar: {
      one: "سطر واحد مغلّف وجاهز للاستلام.",
      two: "سطران مغلّفان وجاهزان للاستلام.",
      few: "{count} أسطر مغلّفة وجاهزة للاستلام.",
      many: "{count} سطراً مغلّفاً وجاهزاً للاستلام.",
    },
  },
  "fulfilment.receivedToast": {
    param: "count",
    en: { one: "Counted in: 1 unit." },
    ar: { one: "تم الجرد: وحدة واحدة.", two: "تم الجرد: وحدتان.", few: "تم الجرد: {count} وحدات." },
  },
};

const rules = new Map<LocaleCode, Intl.PluralRules>();

/** The band a number falls in, in a language. */
export function pluralCategory(locale: LocaleCode, n: number): PluralCategory {
  let rule = rules.get(locale);
  if (!rule) {
    rule = new Intl.PluralRules(locale);
    rules.set(locale, rule);
  }
  return rule.select(n) as PluralCategory;
}

/**
 * The form of `key` for the number in `values`, or null to use the
 * dictionary's own string. A value that is not a whole number — a string some
 * caller formatted, or nothing at all — leaves the dictionary's string alone.
 */
export function pluralForm(
  locale: LocaleCode,
  key: MessageKey,
  values: Record<string, string | number> | undefined,
): string | null {
  const entry = PLURAL_FORMS[key];
  const forms = entry?.[locale];
  if (!entry || !forms || !values || !(entry.param in values)) return null;
  const n = Number(values[entry.param]);
  if (!Number.isInteger(n)) return null;
  return forms[pluralCategory(locale, n)] ?? null;
}
