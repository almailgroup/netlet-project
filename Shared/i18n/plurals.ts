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
  "header.seeAllCount": {
    param: "count",
    en: { one: "See the 1 result for “{query}”" },
    ar: { one: "عرض النتيجة الوحيدة لـ ”{query}“" },
  },
  "frequent.boughtTimes": {
    param: "count",
    en: { one: "Bought once" },
    ar: {
      one: "اشتريته مرة واحدة",
      two: "اشتريته مرتين",
      many: "اشتريته {count} مرة",
      other: "اشتريته {count} مرة",
    },
  },
  "checkout.confirmStores": {
    param: "count",
    ar: {
      two: "من متجرين",
      many: "من {count} متجرًا",
      other: "من {count} متجر",
    },
  },
  "cart.itemCount": {
    param: "count",
    en: { one: "1 item" },
    ar: {
      one: "منتج واحد",
      two: "منتجان",
      many: "{count} منتجاً",
      other: "{count} منتج",
    },
  },
  "rewards.balance": {
    param: "points",
    en: { one: "1 point" },
    ar: {
      one: "نقطة واحدة",
      two: "نقطتان",
      few: "{points} نقاط",
    },
  },
  "checkout.usePoints": {
    param: "points",
    en: { one: "Use 1 point ({value} off)" },
    ar: {
      one: "استخدم نقطة واحدة (خصم {value})",
      two: "استخدم نقطتين (خصم {value})",
      few: "استخدم {points} نقاط (خصم {value})",
    },
  },
  "rewards.held": {
    param: "points",
    en: { one: "1 point is held until its sale's return window passes." },
    ar: {
      one: "نقطة واحدة محجوزة حتى تنقضي مهلة الإرجاع.",
      two: "نقطتان محجوزتان حتى تنقضي مهلة الإرجاع.",
      few: "{points} نقاط محجوزة حتى تنقضي مهلة الإرجاع.",
    },
  },
  "notice.bagReminder": {
    param: "count",
    en: { one: "You left an item in your cart." },
    ar: {
      one: "تركت منتجاً في سلتك.",
      two: "تركت منتجين في سلتك.",
      many: "تركت {count} منتجاً في سلتك.",
      other: "تركت {count} منتج في سلتك.",
    },
  },
  "guides.stepCount": {
    param: "count",
    en: { one: "1 step" },
    ar: { one: "خطوة واحدة", two: "خطوتان", few: "{count} خطوات", many: "{count} خطوة", other: "{count} خطوة" },
  },
  "notices.unread": {
    param: "count",
    ar: { one: "إشعار واحد غير مقروء", two: "إشعاران غير مقروءين", few: "{count} إشعارات غير مقروءة", many: "{count} إشعاراً غير مقروء", other: "{count} إشعار غير مقروء" },
  },
  "browse.countMany": {
    param: "count",
    ar: { two: "منتجان", few: "{count} منتجات", many: "{count} منتجاً" },
  },
  "stores.countMany": {
    param: "count",
    ar: { two: "متجران", few: "{count} متاجر", many: "{count} متجراً", other: "{count} متجر" },
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
  "review.ratingsCount": {
    param: "count",
    en: { one: "1 rating" },
    ar: { one: "تقييم واحد", two: "تقييمان", many: "{count} تقييماً", other: "{count} تقييم" },
  },
  "review.writtenCount": {
    param: "count",
    en: { one: "1 review" },
    ar: { one: "مراجعة واحدة", two: "مراجعتان", many: "{count} مراجعةً", other: "{count} مراجعة" },
  },
  "product.reviews": {
    param: "count",
    en: { one: "1 rating" },
    ar: { one: "تقييم واحد", two: "تقييمان", many: "{count} تقييماً", other: "{count} تقييم" },
  },
  "product.ratingAriaCount": {
    param: "count",
    en: { one: "Rated {value} out of {max} from 1 rating" },
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
  "admin.bulkBrandTitle": {
    param: "count",
    en: { one: "Set the brand of 1 product" },
    ar: { one: "تحديد العلامة التجارية لمنتج واحد", two: "تحديد العلامة التجارية لمنتجين", many: "تحديد العلامة التجارية لـ {count} منتجاً", other: "تحديد العلامة التجارية لـ {count} منتج" },
  },
  "admin.bulkPhotosTitle": {
    param: "count",
    en: { one: "Copy 1 photo to NetLet" },
    ar: { one: "نسخ صورة واحدة إلى نت لت", two: "نسخ صورتين إلى نت لت", many: "نسخ {count} صورة إلى نت لت", other: "نسخ {count} صورة إلى نت لت" },
  },
  "admin.bulkPhotosDone": {
    param: "count",
    en: { one: "1 photo copied to NetLet." },
    ar: { one: "نُسخت صورة واحدة إلى نت لت.", two: "نُسخت صورتان إلى نت لت.", many: "نُسخت {count} صورة إلى نت لت.", other: "نُسخت {count} صورة إلى نت لت." },
  },
  "admin.bulkPhotosKept": {
    param: "count",
    en: { one: "1 photo could not be read and stays where it was." },
    ar: { one: "تعذّرت قراءة صورة واحدة فبقيت في مكانها.", two: "تعذّرت قراءة صورتين فبقيتا في مكانهما.", many: "تعذّرت قراءة {count} صورة فبقيت في مكانها.", other: "تعذّرت قراءة {count} صورة فبقيت في مكانها." },
  },
  "admin.bulkDepartmentTitle": {
    param: "count",
    en: { one: "Move 1 product to a department" },
    ar: { one: "نقل منتج واحد إلى قسم", two: "نقل منتجين إلى قسم", many: "نقل {count} منتجاً إلى قسم", other: "نقل {count} منتج إلى قسم" },
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
  /* ------------------------------------------------- the return window --- */
  /* An administrator sets it (`returns.windowDays`, one to ninety days), so
     every sentence quoting it takes the form its number needs: written for
     fourteen, each was right for eleven to ninety-nine and wrong below. */
  "returns.emptyNote": {
    param: "days",
    en: { one: "Returns live here too. Once an item is delivered you will have 1 day to send it back, and the window for each item is shown beside it." },
    ar: {
      one: "الإرجاع يظهر هنا أيضاً. بعد استلام القطعة سيكون أمامك يوم واحد لإرجاعها، وتُعرض المهلة المتبقية بجانب كل قطعة.",
      two: "الإرجاع يظهر هنا أيضاً. بعد استلام القطعة سيكون أمامك يومان لإرجاعها، وتُعرض المهلة المتبقية بجانب كل قطعة.",
      few: "الإرجاع يظهر هنا أيضاً. بعد استلام القطعة سيكون أمامك {days} أيام لإرجاعها، وتُعرض المهلة المتبقية بجانب كل قطعة.",
    },
  },
  "help.item.windowClosed": {
    param: "days",
    en: { one: "The 1-day return window for {item} has closed." },
    ar: {
      one: "انتهت مهلة الإرجاع (يوم واحد) لـ{item}.",
      two: "انتهت مهلة الإرجاع (يومان) لـ{item}.",
      few: "انتهت مهلة الإرجاع ({days} أيام) لـ{item}.",
    },
  },
  "returns.howTo": {
    param: "days",
    en: { one: "You have 1 day from delivery to return or exchange an item. Use the button beside it; damaged, faulty and wrong items are approved straight away." },
    ar: {
      one: "أمامك يوم واحد من تاريخ الاستلام لإرجاع أي قطعة أو استبدالها. استخدم الزر بجانبها؛ تُقبل القطع التالفة والمعيبة والخاطئة فوراً.",
      two: "أمامك يومان من تاريخ الاستلام لإرجاع أي قطعة أو استبدالها. استخدم الزر بجانبها؛ تُقبل القطع التالفة والمعيبة والخاطئة فوراً.",
      few: "أمامك {days} أيام من تاريخ الاستلام لإرجاع أي قطعة أو استبدالها. استخدم الزر بجانبها؛ تُقبل القطع التالفة والمعيبة والخاطئة فوراً.",
    },
  },
  "help.a.returns": {
    param: "days",
    en: { one: "Within 1 day of delivery, open the order and press Return or exchange beside the item. Damaged, faulty and wrong items are approved straight away." },
    ar: {
      one: "خلال يوم واحد من الاستلام، افتح الطلب واضغط «إرجاع أو استبدال» بجانب القطعة. تُقبل القطع التالفة والمعيبة والخاطئة فورًا.",
      two: "خلال يومين من الاستلام، افتح الطلب واضغط «إرجاع أو استبدال» بجانب القطعة. تُقبل القطع التالفة والمعيبة والخاطئة فورًا.",
      few: "خلال {days} أيام من الاستلام، افتح الطلب واضغط «إرجاع أو استبدال» بجانب القطعة. تُقبل القطع التالفة والمعيبة والخاطئة فورًا.",
    },
  },
  "returnsPage.intro": {
    param: "days",
    en: { one: "You have 1 day from delivery to send an item back for a refund or swap it for the same thing again." },
    ar: {
      one: "أمامك يوم واحد من تاريخ الاستلام لإرجاع القطعة واسترداد ثمنها أو استبدالها بمثلها.",
      two: "أمامك يومان من تاريخ الاستلام لإرجاع القطعة واسترداد ثمنها أو استبدالها بمثلها.",
      few: "أمامك {days} أيام من تاريخ الاستلام لإرجاع القطعة واسترداد ثمنها أو استبدالها بمثلها.",
    },
  },
  "home.returnsWithin": {
    param: "days",
    en: { one: "Returns within 1 day" },
    ar: {
      one: "إرجاع خلال يوم واحد",
      two: "إرجاع خلال يومين",
      few: "إرجاع خلال {days} أيام",
    },
  },
  "support.answerReturnClosed": {
    param: "days",
    en: { one: "Nothing on {reference} can be returned from your account right now — a return is open for 1 day from delivery, and only once the item has arrived." },
    ar: {
      one: "لا يمكن إرجاع شيء من {reference} من حسابك الآن — الإرجاع متاح لمدة يوم واحد من التوصيل، وبعد وصول القطعة فقط.",
      two: "لا يمكن إرجاع شيء من {reference} من حسابك الآن — الإرجاع متاح لمدة يومين من التوصيل، وبعد وصول القطعة فقط.",
      few: "لا يمكن إرجاع شيء من {reference} من حسابك الآن — الإرجاع متاح لمدة {days} أيام من التوصيل، وبعد وصول القطعة فقط.",
    },
  },
  "support.answerReturnPolicy": {
    param: "days",
    en: { one: "You can return an item within 1 day of its delivery from the order at the top of this page. A damaged, faulty or wrong item is always accepted in that time." },
    ar: {
      one: "يمكنك إرجاع قطعة خلال يوم واحد من توصيلها من الطلب في أعلى هذه الصفحة. القطعة التالفة أو المعيبة أو الخاطئة مقبولة دائماً خلال هذه المدة.",
      two: "يمكنك إرجاع قطعة خلال يومين من توصيلها من الطلب في أعلى هذه الصفحة. القطعة التالفة أو المعيبة أو الخاطئة مقبولة دائماً خلال هذه المدة.",
      few: "يمكنك إرجاع قطعة خلال {days} أيام من توصيلها من الطلب في أعلى هذه الصفحة. القطعة التالفة أو المعيبة أو الخاطئة مقبولة دائماً خلال هذه المدة.",
    },
  },
  "returns.howToPaused": {
    param: "days",
    en: { one: "Online returns are paused for now. You still have 1 day from delivery to return an item — contact NetLet with the order number and which item." },
    ar: {
      one: "الإرجاع عبر الإنترنت متوقف مؤقتاً. لا يزال أمامك يوم واحد من تاريخ الاستلام لإرجاع أي قطعة — تواصل مع نت‑لت مع رقم الطلب والقطعة المطلوبة.",
      two: "الإرجاع عبر الإنترنت متوقف مؤقتاً. لا يزال أمامك يومان من تاريخ الاستلام لإرجاع أي قطعة — تواصل مع نت‑لت مع رقم الطلب والقطعة المطلوبة.",
      few: "الإرجاع عبر الإنترنت متوقف مؤقتاً. لا يزال أمامك {days} أيام من تاريخ الاستلام لإرجاع أي قطعة — تواصل مع نت‑لت مع رقم الطلب والقطعة المطلوبة.",
    },
  },
  "terms.returns.window": {
    param: "days",
    en: { one: "You can ask to return an item within 1 day of its delivery, from Your orders. An item that arrives damaged, faulty, wrong or not as described is accepted straight away." },
    ar: {
      one: "يمكنك طلب إرجاع منتج خلال يوم واحد من توصيله، من صفحة طلباتك. ويُقبل فوراً إرجاع المنتج الذي يصل تالفاً أو معيباً أو مختلفاً أو غير مطابق للوصف.",
      two: "يمكنك طلب إرجاع منتج خلال يومين من توصيله، من صفحة طلباتك. ويُقبل فوراً إرجاع المنتج الذي يصل تالفاً أو معيباً أو مختلفاً أو غير مطابق للوصف.",
      few: "يمكنك طلب إرجاع منتج خلال {days} أيام من توصيله، من صفحة طلباتك. ويُقبل فوراً إرجاع المنتج الذي يصل تالفاً أو معيباً أو مختلفاً أو غير مطابق للوصف.",
    },
  },
  "sellerTerms.returns.window": {
    param: "days",
    en: { one: "Shoppers may return an item within 1 day of delivery. A damaged, faulty or wrong item, or one not as described, is accepted at once; a change of mind is accepted too, except on groceries and other perishable goods. Anything else is decided by a person." },
    ar: {
      one: "يحق للمتسوّق إرجاع المنتج خلال يوم واحد من التسليم. يُقبل فوراً المنتج التالف أو المعطوب أو الخطأ أو المخالف للوصف، ويُقبل تغيير الرأي كذلك إلا في البقالة وغيرها من البضائع سريعة التلف. وأي حالة أخرى يقررها شخص.",
      two: "يحق للمتسوّق إرجاع المنتج خلال يومين من التسليم. يُقبل فوراً المنتج التالف أو المعطوب أو الخطأ أو المخالف للوصف، ويُقبل تغيير الرأي كذلك إلا في البقالة وغيرها من البضائع سريعة التلف. وأي حالة أخرى يقررها شخص.",
      few: "يحق للمتسوّق إرجاع المنتج خلال {days} أيام من التسليم. يُقبل فوراً المنتج التالف أو المعطوب أو الخطأ أو المخالف للوصف، ويُقبل تغيير الرأي كذلك إلا في البقالة وغيرها من البضائع سريعة التلف. وأي حالة أخرى يقررها شخص.",
    },
  },
  "returns.window.body": {
    param: "days",
    en: { one: "Changed your mind? Return within 1 day of delivery for a full refund — except perishable groceries." },
    ar: {
      one: "غيّرت رأيك؟ أرجع المنتج خلال يوم واحد من الاستلام واسترد المبلغ كاملاً — باستثناء المواد الغذائية القابلة للتلف.",
      two: "غيّرت رأيك؟ أرجع المنتج خلال يومين من الاستلام واسترد المبلغ كاملاً — باستثناء المواد الغذائية القابلة للتلف.",
      few: "غيّرت رأيك؟ أرجع المنتج خلال {days} أيام من الاستلام واسترد المبلغ كاملاً — باستثناء المواد الغذائية القابلة للتلف.",
    },
  },
  "ios.tutorial.ordersBody": {
    param: "days",
    en: { one: "Pay cash when your order arrives. Follow each parcel from {profile} → {orders}, and return an item within 1 day." },
    ar: {
      one: "ادفع نقداً عند وصول طلبك. تابع كل طرد من {profile} ← {orders}، ويمكنك إرجاع المنتج خلال يوم واحد.",
      two: "ادفع نقداً عند وصول طلبك. تابع كل طرد من {profile} ← {orders}، ويمكنك إرجاع المنتج خلال يومين.",
      few: "ادفع نقداً عند وصول طلبك. تابع كل طرد من {profile} ← {orders}، ويمكنك إرجاع المنتج خلال {days} أيام.",
    },
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
  /* A count drawn with its thousands grouped ("1,250 points") is still that
     count: the grouping marks come out before it is read. */
  const raw = values[entry.param];
  const n = Number(typeof raw === "string" ? raw.replace(/[,\u066C\u00A0\u202F]/g, "") : raw);
  if (!Number.isInteger(n)) return null;
  return forms[pluralCategory(locale, n)] ?? null;
}
