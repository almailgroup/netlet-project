/**
 * Each department's subcategories, on the owner's word ("make subcategories
 * for the categories page, so when you tap on any category it expands to show
 * the subcategories").
 *
 * **In code beside the departments, for their reason**: three things must
 * agree — the Categories page that lists them, the department page that
 * narrows to one, and the product editor that files a product under one — and
 * a table with an editor would be a second product to maintain before anybody
 * asked. The slug is the stable key (`?sub=phones`); the names are what
 * people read, in both languages.
 *
 * **A product's subcategory is its seller's choice, or else its words.** The
 * seller files it with the department's "Type" row (`type`, offered by the
 * attribute schema with these names as its options, so the editor and the
 * catalogue drafter both ask). Until somebody has, the words decide: each
 * subcategory names the words its products are called by, in both languages,
 * and the subcategory whose words a product's titles hold most (a word in a
 * title counts twice a tag) is its own — the first listed on a tie, none when
 * no word is held. Words are compared as search compares them (`searchWords`:
 * folded, stemmed), so "Headphones", "headphone" and "سماعات" all count.
 *
 * Worked out on the server, from both titles, and carried on the product
 * (`Product.subcategory`), so a count on the Categories page and the page it
 * opens cannot disagree whichever language the shopper reads in.
 */
import { DEPARTMENTS } from "./departments.js";
import { searchWords } from "./search.js";

export type Subcategory = {
  /** Stable, what `?sub=` carries. Unique within its department. */
  slug: string;
  name: string;
  nameAr: string;
  /** What its products are called, in either language; a phrase needs all its words. */
  words: string[];
};

export const SUBCATEGORIES: Record<string, Subcategory[]> = {
  electronics: [
    { slug: "phones", name: "Mobile phones", nameAr: "الهواتف", words: ["phone", "smartphone", "mobile", "iphone", "galaxy", "pixel", "هاتف", "هواتف", "جوال", "جوالات", "موبايل", "ايفون"] },
    { slug: "tablets", name: "Tablets", nameAr: "الأجهزة اللوحية", words: ["tablet", "ipad", "لوحي", "تابلت", "ايباد"] },
    { slug: "computers", name: "Laptops & computers", nameAr: "الحواسيب", words: ["laptop", "notebook", "macbook", "computer", "desktop", "monitor", "keyboard", "mouse", "لابتوب", "حاسوب", "حاسب", "كمبيوتر", "كيبورد", "ماوس"] },
    { slug: "audio", name: "Audio", nameAr: "الصوتيات", words: ["headphone", "headset", "earphone", "earbud", "airpod", "speaker", "soundbar", "سماعة", "سماعات", "مكبر"] },
    { slug: "wearables", name: "Wearables", nameAr: "الأجهزة القابلة للارتداء", words: ["smartwatch", "watch", "band", "tracker", "ساعة", "ساعات", "سوار"] },
    { slug: "tv", name: "TV & video", nameAr: "التلفزيون والفيديو", words: ["tv", "television", "projector", "streaming", "تلفزيون", "تلفاز", "بروجكتر"] },
    { slug: "cameras", name: "Cameras", nameAr: "الكاميرات", words: ["camera", "lens", "gopro", "drone", "كاميرا", "كاميرات", "عدسة", "درون"] },
    { slug: "gaming", name: "Gaming", nameAr: "الألعاب", words: ["playstation", "ps5", "xbox", "nintendo", "console", "controller", "gaming", "بلايستيشن", "العاب", "يد تحكم"] },
    { slug: "accessories", name: "Accessories", nameAr: "الإكسسوارات", words: ["charger", "cable", "case", "cover", "adapter", "powerbank", "power bank", "battery", "screen protector", "شاحن", "كيبل", "كابل", "غطاء", "كفر", "حافظة", "بطارية", "باور بانك"] },
  ],
  "home-and-kitchen": [
    { slug: "kitchen-appliances", name: "Kitchen appliances", nameAr: "أجهزة المطبخ", words: ["blender", "mixer", "fryer", "airfryer", "kettle", "toaster", "microwave", "oven", "coffee", "espresso", "processor", "juicer", "خلاط", "قلاية", "غلاية", "محمصة", "ميكروويف", "فرن", "قهوة", "عصارة"] },
    { slug: "cookware", name: "Cookware & dining", nameAr: "أواني الطبخ والمائدة", words: ["pan", "pot", "cookware", "knife", "plate", "bowl", "cup", "mug", "cutlery", "dinnerware", "مقلاة", "قدر", "سكين", "صحن", "صحون", "كوب", "اكواب", "فنجان"] },
    { slug: "furniture", name: "Furniture", nameAr: "الأثاث", words: ["sofa", "couch", "chair", "table", "desk", "bed", "wardrobe", "shelf", "cabinet", "كنبة", "قنفة", "كرسي", "طاولة", "مكتب", "سرير", "خزانة", "رف"] },
    { slug: "decor", name: "Decor & lighting", nameAr: "الديكور والإضاءة", words: ["lamp", "light", "lighting", "vase", "mirror", "rug", "carpet", "curtain", "frame", "candle", "planter", "مصباح", "اضاءة", "مزهرية", "مراة", "سجادة", "ستارة", "برواز", "شمعة"] },
    { slug: "bedding", name: "Bedding & bath", nameAr: "المفروشات والحمّام", words: ["bedding", "sheet", "pillow", "duvet", "blanket", "towel", "bathrobe", "شرشف", "مخدة", "وسادة", "لحاف", "بطانية", "منشفة", "فوطة"] },
    { slug: "home-appliances", name: "Home appliances", nameAr: "الأجهزة المنزلية", words: ["vacuum", "iron", "fan", "heater", "purifier", "humidifier", "washer", "fridge", "refrigerator", "مكنسة", "مكواة", "مروحة", "دفاية", "منقي", "ثلاجة", "غسالة"] },
    { slug: "cleaning", name: "Cleaning & storage", nameAr: "التنظيف والتخزين", words: ["mop", "broom", "cleaner", "detergent", "laundry", "storage", "organiser", "organizer", "basket", "ممسحة", "منظف", "غسيل", "تخزين", "منظم", "سلة"] },
  ],
  beauty: [
    { slug: "skincare", name: "Skincare", nameAr: "العناية بالبشرة", words: ["skin", "skincare", "cream", "serum", "moisturiser", "moisturizer", "cleanser", "sunscreen", "toner", "mask", "بشرة", "كريم", "سيروم", "مرطب", "غسول", "واقي", "قناع"] },
    { slug: "makeup", name: "Makeup", nameAr: "المكياج", words: ["makeup", "lipstick", "mascara", "foundation", "eyeliner", "blush", "palette", "concealer", "مكياج", "روج", "ماسكارا", "كحل", "بلاشر"] },
    { slug: "haircare", name: "Hair care", nameAr: "العناية بالشعر", words: ["hair", "shampoo", "conditioner", "straightener", "curler", "شعر", "شامبو", "بلسم", "مكواة شعر"] },
    { slug: "fragrance", name: "Fragrance", nameAr: "العطور", words: ["perfume", "fragrance", "oud", "cologne", "musk", "bakhoor", "incense", "عطر", "عطور", "عود", "دهن", "مسك", "بخور"] },
    { slug: "personal-care", name: "Personal care", nameAr: "العناية الشخصية", words: ["razor", "shaver", "trimmer", "toothbrush", "toothpaste", "deodorant", "soap", "lotion", "حلاقة", "ماكينة", "فرشاة", "معجون", "مزيل", "صابون", "لوشن"] },
  ],
  style: [
    { slug: "women", name: "Women's clothing", nameAr: "ملابس نسائية", words: ["women", "woman", "ladies", "dress", "abaya", "skirt", "blouse", "نسائي", "نسائية", "فستان", "عباية", "تنورة", "بلوزة"] },
    { slug: "men", name: "Men's clothing", nameAr: "ملابس رجالية", words: ["men", "mens", "man", "dishdasha", "thobe", "shirt", "trousers", "رجالي", "رجالية", "دشداشة", "ثوب", "قميص", "بنطلون"] },
    { slug: "kids", name: "Kids", nameAr: "الأطفال", words: ["kids", "kid", "children", "child", "boys", "girls", "baby", "اطفال", "طفل", "ولادي", "بناتي", "مواليد"] },
    { slug: "shoes", name: "Shoes", nameAr: "الأحذية", words: ["shoe", "sneaker", "trainer", "sandal", "boot", "heels", "slipper", "loafer", "حذاء", "احذية", "جوتي", "نعال", "صندل", "بوت"] },
    { slug: "bags", name: "Bags", nameAr: "الحقائب", words: ["bag", "handbag", "backpack", "wallet", "purse", "tote", "luggage", "حقيبة", "حقائب", "شنطة", "محفظة"] },
    { slug: "accessories", name: "Accessories", nameAr: "الإكسسوارات", words: ["jewellery", "jewelry", "ring", "necklace", "bracelet", "earring", "sunglasses", "belt", "scarf", "watch", "مجوهرات", "خاتم", "قلادة", "سوار", "حلق", "نظارة", "حزام", "شال", "ساعة"] },
    { slug: "sportswear", name: "Sportswear", nameAr: "الملابس الرياضية", words: ["sport", "sportswear", "gym", "running", "training", "yoga", "رياضي", "رياضية", "جيم"] },
  ],
  grocery: [
    { slug: "fresh", name: "Fruit & vegetables", nameAr: "الفواكه والخضروات", words: ["fruit", "vegetable", "apple", "banana", "orange", "tomato", "potato", "onion", "cucumber", "فواكه", "فاكهة", "خضار", "خضروات", "تفاح", "موز", "برتقال", "طماطم", "بطاطا", "بصل", "خيار"] },
    { slug: "pantry", name: "Pantry", nameAr: "المؤن", words: ["rice", "basmati", "pasta", "flour", "sugar", "oil", "salt", "spice", "sauce", "beans", "lentil", "عيش", "رز", "ارز", "معكرونة", "طحين", "سكر", "زيت", "ملح", "بهارات", "عدس"] },
    { slug: "dairy", name: "Dairy & eggs", nameAr: "الألبان والبيض", words: ["milk", "cheese", "yoghurt", "yogurt", "laban", "butter", "cream cheese", "egg", "حليب", "جبن", "جبنة", "لبن", "زبادي", "زبدة", "بيض"] },
    { slug: "bakery", name: "Bakery", nameAr: "المخبوزات", words: ["bread", "bakery", "croissant", "cake", "bun", "khubz", "خبز", "كعك", "كيك", "صمون"] },
    { slug: "snacks", name: "Snacks, dates & sweets", nameAr: "الوجبات الخفيفة والتمور والحلويات", words: ["snack", "chips", "crisps", "chocolate", "biscuit", "cookie", "candy", "dates", "medjool", "nuts", "تمر", "تمور", "رطب", "شوكولاتة", "بسكويت", "حلويات", "مكسرات", "شيبس"] },
    { slug: "beverages", name: "Beverages", nameAr: "المشروبات", words: ["water", "juice", "tea", "coffee", "soda", "drink", "ماء", "مياه", "عصير", "شاي", "قهوة", "مشروب", "مشروبات"] },
    { slug: "meat", name: "Meat & seafood", nameAr: "اللحوم والمأكولات البحرية", words: ["meat", "chicken", "beef", "lamb", "mutton", "fish", "shrimp", "prawn", "لحم", "لحوم", "دجاج", "غنم", "سمك", "روبيان"] },
  ],
};

/** The department's slug for its catalogue name (`productType`), or null. */
function departmentSlugOf(productType: string | null | undefined): string | null {
  const name = productType?.trim().toLowerCase();
  if (!name) return null;
  return DEPARTMENTS.find(department => department.name.toLowerCase() === name)?.slug ?? null;
}

/** A department's subcategories, in the order the Categories page lists them. */
export function subcategoriesOf(departmentSlug: string | null | undefined): Subcategory[] {
  return departmentSlug ? SUBCATEGORIES[departmentSlug] ?? [] : [];
}

/** One subcategory of a department by its slug, or null. */
export function findSubcategory(departmentSlug: string | null | undefined, slug: string | null | undefined): Subcategory | null {
  if (!slug) return null;
  return subcategoriesOf(departmentSlug).find(entry => entry.slug === slug) ?? null;
}

/** A subcategory's name in the page's language. */
export function subcategoryName(subcategory: Subcategory, arabic: boolean): string {
  return arabic ? subcategory.nameAr : subcategory.name;
}

/* Each subcategory's words as search reads them, a phrase as all of its stems. */
const STEMS: Record<string, string[][][]> = Object.fromEntries(
  Object.entries(SUBCATEGORIES).map(([department, entries]) => [
    department,
    entries.map(entry => entry.words.map(word => searchWords(word)).filter(stems => stems.length > 0)),
  ]),
);

const TITLE_WEIGHT = 2;
const TAG_WEIGHT = 1;

export type SubcategoryInput = {
  /** The department's catalogue name (`productType`). */
  department: string | null | undefined;
  /** Every title the product has — both languages, so either page agrees. */
  titles: (string | null | undefined)[];
  tags: string[];
  /** The seller's "Type" row, when they set one. */
  type?: string | null;
};

/**
 * The subcategory a product is in, by its slug, or null: the seller's own
 * "Type" when it names one of the department's (in either language), else the
 * one whose words its titles and tags hold most.
 */
export function subcategoryFor(input: SubcategoryInput): string | null {
  const department = departmentSlugOf(input.department);
  if (!department) return null;
  const entries = subcategoriesOf(department);
  if (!entries.length) return null;

  const chosen = input.type?.trim().toLowerCase();
  if (chosen) {
    const named = entries.find(entry => entry.name.toLowerCase() === chosen || entry.nameAr === input.type?.trim() || entry.slug === chosen);
    if (named) return named.slug;
  }

  const titleWords = new Set(input.titles.flatMap(title => searchWords(title)));
  const tagWords = new Set(input.tags.flatMap(tag => searchWords(tag)));
  const holds = (words: Set<string>, phrase: string[]) => phrase.every(stem => words.has(stem));

  let best: string | null = null;
  let bestScore = 0;
  STEMS[department].forEach((phrases, index) => {
    let score = 0;
    for (const phrase of phrases) {
      if (holds(titleWords, phrase)) score += TITLE_WEIGHT;
      else if (holds(tagWords, phrase)) score += TAG_WEIGHT;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entries[index].slug;
    }
  });
  return best;
}

/** The "Type" row's options for a department: the subcategories' names, in English and Arabic. */
export function typeOptions(departmentSlug: string): { options: string[]; optionsAr: string[] } {
  const entries = subcategoriesOf(departmentSlug);
  return { options: entries.map(entry => entry.name), optionsAr: entries.map(entry => entry.nameAr) };
}
