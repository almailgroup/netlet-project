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

/**
 * What a subcategory's icon depicts — a name, never a component, the
 * departments' rule (`DEPARTMENT_ICONS`): `Shared/` stays pure, and each
 * client turns the name into its own drawing (lucide on the web, SF Symbols in
 * the app) through a record the type makes exhaustive, so a subcategory added
 * without a picture is a compile error rather than a blank tile. Named for the
 * picture, so two subcategories sharing one is visible here.
 */
export const SUBCATEGORY_ICONS = [
  "phone", "tablet", "laptop", "headphones", "watch", "tv", "camera", "gamepad", "cable",
  "microwave", "dining", "sofa", "lamp", "bed", "washer", "spray",
  "drop", "brush", "scissors", "sparkles", "bath",
  "dress", "shirt", "baby", "shoe", "bag", "glasses", "dumbbell",
  "produce", "wheat", "milk", "croissant", "cookie", "cup", "meat",
  "pill", "zap", "stethoscope", "bandage", "eye", "leaf",
  "bottle", "stroller", "crib",
  "rabbit", "blocks", "dice", "bike", "rocket", "shapes",
  "biceps", "tent", "volleyball", "waves", "fish",
  "car-front", "radio", "cog", "fuel",
  "drill", "wrench", "sprout", "lightbulb", "paint-roller", "hard-hat",
  "cat", "dog", "bird", "squirrel",
  "book-open", "book-heart", "backpack", "paperclip", "pen", "palette",
] as const;
export type SubcategoryIcon = (typeof SUBCATEGORY_ICONS)[number];

export type Subcategory = {
  /** Stable, what `?sub=` carries. Unique within its department. */
  slug: string;
  /** What its row on the Categories page shows beside its name. */
  icon: SubcategoryIcon;
  name: string;
  nameAr: string;
  /** What its products are called, in either language; a phrase needs all its words. */
  words: string[];
};

export const SUBCATEGORIES: Record<string, Subcategory[]> = {
  electronics: [
    { slug: "phones", icon: "phone", name: "Mobile phones", nameAr: "الهواتف", words: ["phone", "smartphone", "mobile", "iphone", "galaxy", "pixel", "هاتف", "هواتف", "جوال", "جوالات", "موبايل", "ايفون"] },
    { slug: "tablets", icon: "tablet", name: "Tablets", nameAr: "الأجهزة اللوحية", words: ["tablet", "ipad", "لوحي", "تابلت", "ايباد"] },
    { slug: "computers", icon: "laptop", name: "Laptops & computers", nameAr: "الحواسيب", words: ["laptop", "notebook", "macbook", "computer", "desktop", "monitor", "keyboard", "mouse", "لابتوب", "حاسوب", "حاسب", "كمبيوتر", "كيبورد", "ماوس"] },
    { slug: "audio", icon: "headphones", name: "Audio", nameAr: "الصوتيات", words: ["headphone", "headset", "earphone", "earbud", "airpod", "speaker", "soundbar", "سماعة", "سماعات", "مكبر"] },
    { slug: "wearables", icon: "watch", name: "Wearables", nameAr: "الأجهزة القابلة للارتداء", words: ["smartwatch", "watch", "band", "tracker", "ساعة", "ساعات", "سوار"] },
    { slug: "tv", icon: "tv", name: "TV & video", nameAr: "التلفزيون والفيديو", words: ["tv", "television", "projector", "streaming", "تلفزيون", "تلفاز", "بروجكتر"] },
    { slug: "cameras", icon: "camera", name: "Cameras", nameAr: "الكاميرات", words: ["camera", "lens", "gopro", "drone", "كاميرا", "كاميرات", "عدسة", "درون"] },
    { slug: "gaming", icon: "gamepad", name: "Gaming", nameAr: "الألعاب", words: ["playstation", "ps5", "xbox", "nintendo", "console", "controller", "gaming", "بلايستيشن", "العاب", "يد تحكم"] },
    { slug: "accessories", icon: "cable", name: "Accessories", nameAr: "الإكسسوارات", words: ["charger", "cable", "case", "cover", "adapter", "powerbank", "power bank", "battery", "screen protector", "شاحن", "كيبل", "كابل", "غطاء", "كفر", "حافظة", "بطارية", "باور بانك"] },
  ],
  "home-and-kitchen": [
    { slug: "kitchen-appliances", icon: "microwave", name: "Kitchen appliances", nameAr: "أجهزة المطبخ", words: ["blender", "mixer", "fryer", "airfryer", "kettle", "toaster", "microwave", "oven", "coffee", "espresso", "processor", "juicer", "خلاط", "قلاية", "غلاية", "محمصة", "ميكروويف", "فرن", "قهوة", "عصارة"] },
    { slug: "cookware", icon: "dining", name: "Cookware & dining", nameAr: "أواني الطبخ والمائدة", words: ["pan", "pot", "cookware", "knife", "plate", "bowl", "cup", "mug", "cutlery", "dinnerware", "مقلاة", "قدر", "سكين", "صحن", "صحون", "كوب", "اكواب", "فنجان"] },
    { slug: "furniture", icon: "sofa", name: "Furniture", nameAr: "الأثاث", words: ["sofa", "couch", "chair", "table", "desk", "bed", "wardrobe", "shelf", "cabinet", "كنبة", "قنفة", "كرسي", "طاولة", "مكتب", "سرير", "خزانة", "رف"] },
    { slug: "decor", icon: "lamp", name: "Decor & lighting", nameAr: "الديكور والإضاءة", words: ["lamp", "light", "lighting", "vase", "mirror", "rug", "carpet", "curtain", "frame", "candle", "planter", "مصباح", "اضاءة", "مزهرية", "مراة", "سجادة", "ستارة", "برواز", "شمعة"] },
    { slug: "bedding", icon: "bed", name: "Bedding & bath", nameAr: "المفروشات والحمّام", words: ["bedding", "sheet", "pillow", "duvet", "blanket", "towel", "bathrobe", "شرشف", "مخدة", "وسادة", "لحاف", "بطانية", "منشفة", "فوطة"] },
    { slug: "home-appliances", icon: "washer", name: "Home appliances", nameAr: "الأجهزة المنزلية", words: ["vacuum", "iron", "fan", "heater", "purifier", "humidifier", "washer", "fridge", "refrigerator", "مكنسة", "مكواة", "مروحة", "دفاية", "منقي", "ثلاجة", "غسالة"] },
    { slug: "cleaning", icon: "spray", name: "Cleaning & storage", nameAr: "التنظيف والتخزين", words: ["mop", "broom", "cleaner", "detergent", "laundry", "storage", "organiser", "organizer", "basket", "ممسحة", "منظف", "غسيل", "تخزين", "منظم", "سلة"] },
  ],
  beauty: [
    { slug: "skincare", icon: "drop", name: "Skincare", nameAr: "العناية بالبشرة", words: ["skin", "skincare", "cream", "serum", "moisturiser", "moisturizer", "cleanser", "sunscreen", "toner", "mask", "بشرة", "كريم", "سيروم", "مرطب", "غسول", "واقي", "قناع"] },
    { slug: "makeup", icon: "brush", name: "Makeup", nameAr: "المكياج", words: ["makeup", "lipstick", "mascara", "foundation", "eyeliner", "blush", "palette", "concealer", "مكياج", "روج", "ماسكارا", "كحل", "بلاشر"] },
    { slug: "haircare", icon: "scissors", name: "Hair care", nameAr: "العناية بالشعر", words: ["hair", "shampoo", "conditioner", "straightener", "curler", "شعر", "شامبو", "بلسم", "مكواة شعر"] },
    { slug: "fragrance", icon: "sparkles", name: "Fragrance", nameAr: "العطور", words: ["perfume", "fragrance", "oud", "cologne", "musk", "bakhoor", "incense", "عطر", "عطور", "عود", "دهن", "مسك", "بخور"] },
    { slug: "personal-care", icon: "bath", name: "Personal care", nameAr: "العناية الشخصية", words: ["razor", "shaver", "trimmer", "toothbrush", "toothpaste", "deodorant", "soap", "lotion", "حلاقة", "ماكينة", "فرشاة", "معجون", "مزيل", "صابون", "لوشن"] },
  ],
  style: [
    { slug: "women", icon: "dress", name: "Women's clothing", nameAr: "ملابس نسائية", words: ["women", "woman", "ladies", "dress", "abaya", "skirt", "blouse", "نسائي", "نسائية", "فستان", "عباية", "تنورة", "بلوزة"] },
    { slug: "men", icon: "shirt", name: "Men's clothing", nameAr: "ملابس رجالية", words: ["men", "mens", "man", "dishdasha", "thobe", "shirt", "trousers", "رجالي", "رجالية", "دشداشة", "ثوب", "قميص", "بنطلون"] },
    { slug: "kids", icon: "baby", name: "Kids", nameAr: "الأطفال", words: ["kids", "kid", "children", "child", "boys", "girls", "baby", "اطفال", "طفل", "ولادي", "بناتي", "مواليد"] },
    { slug: "shoes", icon: "shoe", name: "Shoes", nameAr: "الأحذية", words: ["shoe", "sneaker", "trainer", "sandal", "boot", "heels", "slipper", "loafer", "حذاء", "احذية", "جوتي", "نعال", "صندل", "بوت"] },
    { slug: "bags", icon: "bag", name: "Bags", nameAr: "الحقائب", words: ["bag", "handbag", "backpack", "wallet", "purse", "tote", "luggage", "حقيبة", "حقائب", "شنطة", "محفظة"] },
    { slug: "accessories", icon: "glasses", name: "Accessories", nameAr: "الإكسسوارات", words: ["jewellery", "jewelry", "ring", "necklace", "bracelet", "earring", "sunglasses", "belt", "scarf", "watch", "مجوهرات", "خاتم", "قلادة", "سوار", "حلق", "نظارة", "حزام", "شال", "ساعة"] },
    { slug: "sportswear", icon: "dumbbell", name: "Sportswear", nameAr: "الملابس الرياضية", words: ["sport", "sportswear", "gym", "running", "training", "yoga", "رياضي", "رياضية", "جيم"] },
  ],
  grocery: [
    { slug: "fresh", icon: "produce", name: "Fruit & vegetables", nameAr: "الفواكه والخضروات", words: ["fruit", "vegetable", "apple", "banana", "orange", "tomato", "potato", "onion", "cucumber", "فواكه", "فاكهة", "خضار", "خضروات", "تفاح", "موز", "برتقال", "طماطم", "بطاطا", "بصل", "خيار"] },
    { slug: "pantry", icon: "wheat", name: "Pantry", nameAr: "المؤن", words: ["rice", "basmati", "pasta", "flour", "sugar", "oil", "salt", "spice", "sauce", "beans", "lentil", "عيش", "رز", "ارز", "معكرونة", "طحين", "سكر", "زيت", "ملح", "بهارات", "عدس"] },
    { slug: "dairy", icon: "milk", name: "Dairy & eggs", nameAr: "الألبان والبيض", words: ["milk", "cheese", "yoghurt", "yogurt", "laban", "butter", "cream cheese", "egg", "حليب", "جبن", "جبنة", "لبن", "زبادي", "زبدة", "بيض"] },
    { slug: "bakery", icon: "croissant", name: "Bakery", nameAr: "المخبوزات", words: ["bread", "bakery", "croissant", "cake", "bun", "khubz", "خبز", "كعك", "كيك", "صمون"] },
    { slug: "snacks", icon: "cookie", name: "Snacks, dates & sweets", nameAr: "الوجبات الخفيفة والتمور والحلويات", words: ["snack", "chips", "crisps", "chocolate", "biscuit", "cookie", "candy", "dates", "medjool", "nuts", "تمر", "تمور", "رطب", "شوكولاتة", "بسكويت", "حلويات", "مكسرات", "شيبس"] },
    { slug: "beverages", icon: "cup", name: "Beverages", nameAr: "المشروبات", words: ["water", "juice", "tea", "coffee", "soda", "drink", "ماء", "مياه", "عصير", "شاي", "قهوة", "مشروب", "مشروبات"] },
    { slug: "meat", icon: "meat", name: "Meat & seafood", nameAr: "اللحوم والمأكولات البحرية", words: ["meat", "chicken", "beef", "lamb", "mutton", "fish", "shrimp", "prawn", "لحم", "لحوم", "دجاج", "غنم", "سمك", "روبيان"] },
  ],
  "health-and-wellness": [
    { slug: "vitamins", icon: "pill", name: "Vitamins & supplements", nameAr: "الفيتامينات والمكملات", words: ["vitamin", "multivitamin", "supplement", "omega", "collagen", "probiotic", "zinc", "magnesium", "capsule", "فيتامين", "فيتامينات", "مكمل", "مكملات", "اوميغا", "كولاجين", "بروبيوتيك", "زنك", "مغنيسيوم", "كبسولات"] },
    { slug: "sports-nutrition", icon: "zap", name: "Sports nutrition", nameAr: "التغذية الرياضية", words: ["protein", "whey", "creatine", "bcaa", "pre-workout", "preworkout", "mass gainer", "electrolyte", "بروتين", "واي", "كرياتين", "الكترولايت"] },
    { slug: "medical-devices", icon: "stethoscope", name: "Medical devices", nameAr: "الأجهزة الطبية", words: ["thermometer", "blood pressure", "glucometer", "glucose", "oximeter", "nebuliser", "nebulizer", "stethoscope", "ميزان حرارة", "جهاز ضغط", "جهاز سكر", "اوكسيميتر", "بخاخ", "سماعة طبيب"] },
    { slug: "first-aid", icon: "bandage", name: "First aid", nameAr: "الإسعافات الأولية", words: ["first aid", "bandage", "plaster", "gauze", "antiseptic", "sanitiser", "sanitizer", "اسعافات", "ضماد", "لزقة", "شاش", "مطهر", "معقم"] },
    { slug: "eye-care", icon: "eye", name: "Eye care", nameAr: "العناية بالعيون", words: ["contact lens", "lenses", "eye drops", "reading glasses", "lens solution", "عدسات", "عدسة لاصقة", "قطرة عين", "نظارة قراءة"] },
    { slug: "wellness", icon: "leaf", name: "Wellness & relaxation", nameAr: "العافية والاسترخاء", words: ["massager", "massage", "essential oil", "aromatherapy", "herbal", "sleep aid", "diffuser", "مساج", "مدلك", "زيت عطري", "اعشاب", "استرخاء", "فواحة"] },
  ],
  baby: [
    { slug: "diapers", icon: "baby", name: "Diapers & wipes", nameAr: "الحفاضات والمناديل", words: ["diaper", "nappy", "nappies", "wipes", "pampers", "huggies", "حفاضات", "حفاض", "بامبرز", "مناديل مبللة"] },
    { slug: "feeding", icon: "bottle", name: "Feeding", nameAr: "الرضاعة والتغذية", words: ["feeding bottle", "baby bottle", "formula", "pacifier", "dummy", "teether", "bib", "breast pump", "sterilizer", "steriliser", "رضاعة", "حليب اطفال", "لهاية", "مصاصة", "عضاضة", "مريلة", "شفاط", "معقم رضاعات"] },
    { slug: "strollers", icon: "stroller", name: "Strollers & car seats", nameAr: "العربات ومقاعد السيارة", words: ["stroller", "pram", "pushchair", "car seat", "carrier", "baby walker", "عربة اطفال", "عربانة", "كرسي سيارة", "حمالة اطفال", "مشاية"] },
    { slug: "nursery", icon: "crib", name: "Nursery", nameAr: "غرفة الطفل", words: ["crib", "cot", "cradle", "bassinet", "playpen", "baby monitor", "سرير اطفال", "مهد", "سرير هزاز", "حظيرة اطفال", "جهاز مراقبة"] },
    { slug: "bath-and-care", icon: "bath", name: "Bath & care", nameAr: "الاستحمام والعناية", words: ["baby shampoo", "baby lotion", "baby oil", "baby bath", "rash cream", "baby powder", "شامبو اطفال", "لوشن اطفال", "زيت اطفال", "حوض استحمام", "كريم تسلخات", "بودرة اطفال"] },
    { slug: "baby-clothing", icon: "shirt", name: "Baby clothing", nameAr: "ملابس الرضّع", words: ["onesie", "bodysuit", "romper", "sleepsuit", "swaddle", "newborn", "بدي", "سالوبيت", "قماط", "لفافة", "مواليد"] },
  ],
  "toys-and-games": [
    { slug: "dolls", icon: "rabbit", name: "Dolls & soft toys", nameAr: "الدمى والألعاب المحشوة", words: ["doll", "barbie", "plush", "teddy", "stuffed", "soft toy", "action figure", "دمية", "دمى", "باربي", "دبدوب", "محشو", "مجسم"] },
    { slug: "building", icon: "blocks", name: "Building sets", nameAr: "ألعاب التركيب", words: ["lego", "building blocks", "construction", "magnetic tiles", "bricks", "ليغو", "ليجو", "مكعبات", "تركيب"] },
    { slug: "board-games", icon: "dice", name: "Board games & puzzles", nameAr: "ألعاب الطاولة والألغاز", words: ["board game", "puzzle", "jigsaw", "card game", "monopoly", "uno", "chess", "بزل", "لغز", "احجية", "شطرنج", "مونوبولي", "اونو", "كوتشينة"] },
    { slug: "outdoor-play", icon: "bike", name: "Outdoor & ride-ons", nameAr: "الألعاب الخارجية والدراجات", words: ["scooter", "kids bike", "tricycle", "trampoline", "swing", "slide", "ride-on", "water gun", "سكوتر", "سيكل اطفال", "دراجة ثلاثية", "ترامبولين", "مرجيحة", "زحليقة", "مسدس ماء"] },
    { slug: "remote-control", icon: "rocket", name: "Remote control", nameAr: "ألعاب التحكم عن بعد", words: ["remote control", "rc car", "rc", "helicopter", "racing car", "ريموت", "تحكم عن بعد", "سيارة تحكم", "هليكوبتر"] },
    { slug: "learning", icon: "shapes", name: "Learning toys", nameAr: "الألعاب التعليمية", words: ["educational", "learning", "stem", "montessori", "alphabet", "abacus", "science kit", "تعليمية", "تعليمي", "مونتيسوري", "حروف", "علوم"] },
  ],
  "sports-and-outdoors": [
    { slug: "fitness", icon: "biceps", name: "Fitness equipment", nameAr: "معدات اللياقة", words: ["dumbbell", "kettlebell", "treadmill", "weight bench", "resistance band", "yoga mat", "exercise bike", "weights", "دمبل", "دمبلز", "اثقال", "جهاز مشي", "سير مشي", "حبل مقاومة", "سجادة يوغا"] },
    { slug: "cycling", icon: "bike", name: "Cycling", nameAr: "الدراجات", words: ["bicycle", "bike", "cycling", "mountain bike", "bike helmet", "دراجة", "دراجات", "سيكل", "خوذة"] },
    { slug: "camping", icon: "tent", name: "Camping & trips", nameAr: "التخييم والكشتات", words: ["tent", "camping", "sleeping bag", "cooler", "hiking", "lantern", "barbecue", "bbq", "خيمة", "خيام", "كشتة", "تخييم", "كيس نوم", "ترمس", "فانوس", "منقل", "شواية"] },
    { slug: "team-sports", icon: "volleyball", name: "Team sports", nameAr: "الرياضات الجماعية", words: ["football", "soccer", "basketball", "volleyball", "goal", "padel", "tennis", "racket", "كرة", "كرة قدم", "كرة سلة", "كرة طائرة", "بادل", "تنس", "مضرب"] },
    { slug: "water-sports", icon: "waves", name: "Water sports", nameAr: "الرياضات المائية", words: ["swimming", "goggles", "snorkel", "diving", "surf", "paddle board", "kayak", "life jacket", "سباحة", "نظارة سباحة", "غطس", "سنوركل", "تجديف", "قارب", "سترة نجاة"] },
    { slug: "fishing", icon: "fish", name: "Fishing", nameAr: "صيد السمك", words: ["fishing", "fishing rod", "reel", "hook", "lure", "bait", "حداق", "سنارة", "شص", "طعم", "بكرة صيد"] },
  ],
  automotive: [
    { slug: "car-accessories", icon: "car-front", name: "Car accessories", nameAr: "إكسسوارات السيارات", words: ["seat cover", "floor mat", "phone holder", "steering cover", "sunshade", "car organiser", "car organizer", "غطاء مقعد", "دواسات", "فرش سيارة", "حامل جوال", "غطاء سكان", "مظلة سيارة"] },
    { slug: "car-care", icon: "spray", name: "Car care", nameAr: "العناية بالسيارة", words: ["car wash", "car shampoo", "wax", "polish", "microfiber", "tyre shine", "tire shine", "غسيل سيارة", "شامبو سيارة", "شمع", "ملمع", "تلميع", "منشفة مايكروفايبر"] },
    { slug: "car-electronics", icon: "radio", name: "Car electronics", nameAr: "إلكترونيات السيارة", words: ["dash cam", "dashcam", "car charger", "car stereo", "gps", "jump starter", "inverter", "car speaker", "كاميرا سيارة", "داش كام", "شاحن سيارة", "مسجل سيارة", "جي بي اس", "اشتراك بطارية"] },
    { slug: "parts", icon: "cog", name: "Parts & tyres", nameAr: "قطع الغيار والإطارات", words: ["tyre", "tire", "wheel", "brake pads", "filter", "wiper", "headlight", "car battery", "spark plug", "اطار", "تاير", "فلتر", "مساحات", "سطب", "بطارية سيارة", "بواجي", "فحمات"] },
    { slug: "oils", icon: "fuel", name: "Oils & fluids", nameAr: "الزيوت والسوائل", words: ["engine oil", "motor oil", "coolant", "brake fluid", "transmission oil", "additive", "زيت محرك", "زيت مكينة", "ماء رديتر", "سائل فرامل", "زيت قير"] },
  ],
  "tools-and-home-improvement": [
    { slug: "power-tools", icon: "drill", name: "Power tools", nameAr: "العدد الكهربائية", words: ["drill", "grinder", "saw", "sander", "heat gun", "impact driver", "دريل", "شنيور", "صاروخ", "منشار", "صنفرة", "مسدس حرارة"] },
    { slug: "hand-tools", icon: "wrench", name: "Hand tools", nameAr: "العدد اليدوية", words: ["hammer", "wrench", "spanner", "screwdriver", "pliers", "tape measure", "toolbox", "tool kit", "مطرقة", "شاكوش", "مفتاح ربط", "مفك", "كماشة", "زرادية", "متر قياس", "صندوق عدة"] },
    { slug: "garden", icon: "sprout", name: "Garden", nameAr: "الحديقة", words: ["garden", "hose", "lawn", "mower", "seeds", "soil", "fertiliser", "fertilizer", "sprinkler", "حديقة", "زراعة", "خرطوم", "عشب", "بذور", "تربة", "سماد", "رشاش"] },
    { slug: "electrical", icon: "lightbulb", name: "Electrical & lighting", nameAr: "الكهرباء والإنارة", words: ["bulb", "led", "extension", "socket", "switch", "wire", "spotlight", "لمبة", "ليد", "توصيلة", "فيش", "سلك", "كشاف"] },
    { slug: "paint", icon: "paint-roller", name: "Paint & decorating", nameAr: "الدهانات والديكور", words: ["paint", "paint roller", "primer", "wallpaper", "masking tape", "putty", "صبغ", "دهان", "رول دهان", "ورق جدران", "معجون"] },
    { slug: "safety", icon: "hard-hat", name: "Safety & security", nameAr: "السلامة والأمان", words: ["padlock", "lock", "safe box", "work gloves", "fire extinguisher", "smoke detector", "cctv", "security camera", "قفل", "خزنة", "قفازات عمل", "طفاية حريق", "كاشف دخان", "كاميرا مراقبة"] },
  ],
  "pet-supplies": [
    { slug: "cats", icon: "cat", name: "Cats", nameAr: "القطط", words: ["cat", "kitten", "cat litter", "scratcher", "قطة", "قطط", "بسة", "رمل قطط", "مخدش"] },
    { slug: "dogs", icon: "dog", name: "Dogs", nameAr: "الكلاب", words: ["dog", "puppy", "leash", "collar", "kennel", "كلب", "كلاب", "جرو", "رسن", "طوق"] },
    { slug: "birds", icon: "bird", name: "Birds", nameAr: "الطيور", words: ["bird", "parrot", "budgie", "birdcage", "bird seed", "طير", "طيور", "ببغاء", "بادجي", "قفص طيور", "حب طيور"] },
    { slug: "fish", icon: "fish", name: "Fish & aquariums", nameAr: "الأسماك والأحواض", words: ["aquarium", "fish tank", "fish food", "aquarium filter", "حوض سمك", "حوض اسماك", "اسماك زينة", "اكل سمك"] },
    { slug: "small-animals", icon: "squirrel", name: "Small animals", nameAr: "الحيوانات الصغيرة", words: ["rabbit", "hamster", "guinea pig", "turtle", "tortoise", "ارنب", "هامستر", "خنزير غينيا", "سلحفاة"] },
  ],
  "books-and-stationery": [
    { slug: "books", icon: "book-open", name: "Books", nameAr: "الكتب", words: ["book", "novel", "paperback", "hardcover", "biography", "cookbook", "كتاب", "كتب", "رواية", "سيرة"] },
    { slug: "kids-books", icon: "book-heart", name: "Children's books", nameAr: "كتب الأطفال", words: ["children", "kids", "children's book", "kids book", "storybook", "bedtime stories", "اطفال", "قصص اطفال", "كتب اطفال", "قصة مصورة"] },
    { slug: "school", icon: "backpack", name: "School supplies", nameAr: "المستلزمات المدرسية", words: ["school", "school bag", "pencil case", "ruler", "eraser", "sharpener", "lunch box", "مدرسة", "مدرسي", "شنطة مدرسية", "مقلمة", "مسطرة", "ممحاة", "مبراة"] },
    { slug: "office", icon: "paperclip", name: "Office supplies", nameAr: "مستلزمات المكتب", words: ["stapler", "printer paper", "folder", "envelope", "ink cartridge", "toner", "calculator", "دباسة", "ورق طباعة", "ملف", "ظرف", "حبر", "حاسبة"] },
    { slug: "pens-and-notebooks", icon: "pen", name: "Pens & notebooks", nameAr: "الأقلام والدفاتر", words: ["pen", "pencil", "marker", "highlighter", "notebook", "journal", "diary", "planner", "قلم", "اقلام", "دفتر", "دفاتر", "مفكرة", "اجندة", "هايلايتر"] },
    { slug: "art-and-craft", icon: "palette", name: "Art & craft", nameAr: "الفنون والأشغال اليدوية", words: ["canvas", "sketchbook", "watercolour", "watercolor", "acrylic", "crayon", "glitter", "craft", "رسم", "لوحة رسم", "الوان مائية", "اكريليك", "اشغال يدوية"] },
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
