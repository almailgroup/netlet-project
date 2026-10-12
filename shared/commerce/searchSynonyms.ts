/**
 * Words people use for the same thing, in both languages and in Kuwait's own.
 *
 * A shopper types the word they say, not the seller's: "جوال" for a phone a
 * seller called "Smart phone", "قنفة" for a sofa, "جوتي" for trainers, "عيش"
 * for rice. Most of the catalogue is titled in one language, so without these
 * an Arabic search finds nothing English-titled and the other way round, and a
 * Gulf word finds nothing at all.
 *
 * **Curated and short, on purpose.** Each group is words that mean the same
 * *product* — never a looser "related" — because a synonym widens every search
 * that uses it, and "screen" in the TV group would put every screen protector
 * in a search for a television. Single words only; a phrase is matched word
 * by word anyway. A synonym counts for a little less than the word typed
 * (`search.ts`), so a product named with the shopper's own word still comes
 * first. Add to it from what shoppers actually type.
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["phone", "mobile", "smartphone", "cellphone", "هاتف", "جوال", "موبايل", "تلفون", "تليفون"],
  ["tv", "television", "تلفزيون", "تلفاز"],
  ["laptop", "notebook", "لابتوب"],
  ["computer", "pc", "كمبيوتر", "حاسوب"],
  ["tablet", "ipad", "تابلت"],
  ["headphones", "headphone", "earphones", "earbuds", "headset", "سماعة", "سماعات"],
  ["charger", "شاحن"],
  ["cable", "كيبل", "سلك"],
  ["watch", "ساعة"],
  ["console", "playstation", "بلايستيشن"],
  ["fridge", "refrigerator", "ثلاجة"],
  ["aircon", "conditioner", "مكيف"],
  ["kettle", "غلاية"],
  ["blender", "خلاط"],
  ["fryer", "قلاية"],
  ["vacuum", "مكنسة"],
  ["sofa", "couch", "كنبة", "قنفة"],
  ["cushion", "pillow", "وسادة", "مخدة"],
  ["blanket", "بطانية", "لحاف"],
  ["lamp", "مصباح", "لمبة"],
  ["perfume", "fragrance", "cologne", "عطر", "عطور"],
  ["shirt", "قميص"],
  ["dress", "فستان"],
  ["shoes", "sneakers", "trainers", "حذاء", "جوتي", "جزمة"],
  ["bag", "handbag", "شنطة", "حقيبة"],
  ["tomato", "طماطم", "طماط"],
  ["oil", "زيت"],
  ["rice", "رز", "أرز", "عيش"],
  ["milk", "حليب"],
  ["water", "مياه", "ماء", "ماي"],
  ["coffee", "قهوة"],
  ["tea", "شاي"],
];
