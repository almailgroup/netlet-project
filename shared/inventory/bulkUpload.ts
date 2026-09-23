/**
 * Loading a shelf from a spreadsheet, and guessing where each thing belongs.
 *
 * Requirements 3.3.3 (bulk upload, AI-assisted entry) and 3.3.5 (auto-
 * categorise on bulk upload). Pure, for the reason every other rule here is:
 * an importer is exercised by uploading a real file and looking at what came
 * out, and a rule you can only test that way is one nobody tests. What it
 * decides is what ends up in the shop.
 *
 * ## CSV, not `.xlsx`
 *
 * Excel writes CSV from Save As and every spreadsheet on earth reads it, while
 * parsing `.xlsx` means a zip reader, an XML parser and a dependency carrying
 * both — to arrive at the same rows a seller can already export in two clicks.
 * The honest trade is stated on the page rather than hidden: "export as CSV".
 *
 * Three things about real spreadsheet exports are handled because they are
 * what actually breaks an importer, not because they are interesting:
 *
 * - **Excel writes a UTF-8 BOM**, so the first header arrives as `﻿title`
 *   and an exact match on `title` fails on every file a Windows seller sends.
 * - **A quoted field may contain commas, newlines and doubled quotes.** A
 *   split on `,` turns one Arabic description into four broken columns.
 * - **Line endings are CRLF**, and a trailing `\r` silently becomes part of
 *   the last column's value — a price of `"12.000\r"` parses as NaN.
 *
 * ## Nothing is created from a file that contradicts itself
 *
 * Every row is checked and the problems are reported *with their line numbers*
 * before anything is written. A partial import is the worst outcome: the
 * seller cannot tell what landed, and running the corrected file again
 * duplicates whatever did. So the plan is all-or-nothing and the preview is
 * what they approve.
 *
 * ## The category guess never overrides a seller
 *
 * `suggestDepartment` is consulted only for a row that left the column empty.
 * It scores the title and description against each department's own words and
 * **returns null rather than guessing** when nothing matches — a product filed
 * under the wrong department is harder to find than one filed under none, and
 * "Other" is a department containing everything.
 */
import { DEPARTMENTS } from "../commerce/departments.js";

/**
 * The most rows one upload may carry.
 *
 * A ceiling rather than no ceiling, because every row is written inside one
 * transaction: a file of fifty thousand lines would hold a connection open
 * long enough to look like an outage. Generous enough that no real catalog
 * meets it in one go, and the message says to split the file rather than
 * silently taking the first thousand — which is the `QueryGate` lie again.
 */
export const BULK_UPLOAD_LIMIT = 1000;

/* ------------------------------------------------------------------ csv --- */

/**
 * A spreadsheet's rows, from its text.
 *
 * Written out rather than pulled in: the grammar is small, the edge cases
 * above are the whole job, and a parser whose failure mode is "one seller's
 * catalog is silently wrong" is worth being able to read.
 */
export function parseCsv(text: string): string[][] {
  /* Excel's BOM. Stripped once, here, so no column name ever carries it. */
  const body = text.replace(/^﻿/, "");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];

    if (quoted) {
      if (character !== '"') { field += character; continue; }
      /* A doubled quote inside a quoted field is one quote. */
      if (body[index + 1] === '"') { field += '"'; index += 1; continue; }
      quoted = false;
      continue;
    }

    if (character === '"') { quoted = true; continue; }
    if (character === ",") { row.push(field); field = ""; continue; }
    if (character === "\r") continue;
    if (character === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += character;
  }

  row.push(field);
  rows.push(row);

  /* A file ending in a newline leaves one empty row; so does a blank line
     somebody left between blocks. Neither is a product. */
  return rows.filter(cells => cells.some(cell => cell.trim() !== ""));
}

/* -------------------------------------------------------------- columns --- */

/**
 * What each column is called, and what else it may be called.
 *
 * Aliases because a seller exports from their own system and "Product Name",
 * "name" and "title" are the same column — refusing a file over a header
 * somebody's ERP chose is the importer failing at the only step where it can
 * still be helpful. Matching is case-insensitive and ignores spaces and
 * underscores, so `Compare At Price` and `compare_at_price` are one thing.
 */
export const COLUMNS = {
  title: ["title", "name", "productname", "product"],
  sku: ["sku", "code", "barcode"],
  price: ["price", "sellingprice", "unitprice"],
  compareAtPrice: ["compareatprice", "wasprice", "rrp", "listprice"],
  stock: ["stock", "quantity", "qty", "onhand"],
  category: ["category", "department", "type", "producttype"],
  description: ["description", "details", "about"],
  imageUrl: ["imageurl", "image", "photo", "picture"],
} as const;

export type ColumnName = keyof typeof COLUMNS;

const normaliseHeader = (value: string) => value.trim().toLowerCase().replace(/[\s_-]/g, "");

/** Which column of the file each field came from, or -1 for absent. */
export function mapHeaders(header: string[]): Record<ColumnName, number> {
  const found = {} as Record<ColumnName, number>;
  for (const name of Object.keys(COLUMNS) as ColumnName[]) {
    const aliases = COLUMNS[name] as readonly string[];
    found[name] = header.findIndex(cell => aliases.includes(normaliseHeader(cell)));
  }
  return found;
}

/* ------------------------------------------------------------ the plan --- */

export type DraftProduct = {
  /** The file's own line number, so a problem can be pointed at. */
  line: number;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  stock: number;
  /** What the seller typed, or what was guessed. Null when neither. */
  category: string | null;
  /** True when this row's department was guessed rather than given (3.3.5). */
  categoryGuessed: boolean;
  description: string;
  imageUrl: string | null;
};

export type RowProblem = {
  line: number;
  column: ColumnName | null;
  /** A message key, never a sentence: this is read on an Arabic page too. */
  reason:
    | "bulk.noTitle"
    | "bulk.badPrice"
    | "bulk.badStock"
    | "bulk.duplicateSku"
    | "bulk.missingColumns";
};

export type UploadPlan = {
  products: DraftProduct[];
  problems: RowProblem[];
  /** How many rows had their department guessed, for the line that says so. */
  guessed: number;
};

/** Money as this shop stores it: up to three decimal places, never a float. */
const MONEY = /^\d{1,9}(\.\d{1,3})?$/;

const cell = (row: string[], at: number) => (at >= 0 ? (row[at] ?? "").trim() : "");

/**
 * Turn a file into a plan, or into the reasons there is no plan.
 *
 * Nothing is written from this: the seller sees the rows and the problems and
 * presses the button, so an importer cannot surprise somebody with what it
 * decided a column meant.
 */
export function planUpload(text: string, categories: string[] = DEPARTMENTS.map(d => d.name)): UploadPlan {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { products: [], problems: [{ line: 1, column: null, reason: "bulk.missingColumns" }], guessed: 0 };
  }

  const header = mapHeaders(rows[0]);
  /* Title and price are the two a product cannot exist without — one is what
     it is, the other is what it costs, and `assertPriced` refuses to publish
     anything at zero anyway. */
  if (header.title < 0 || header.price < 0) {
    return { products: [], problems: [{ line: 1, column: null, reason: "bulk.missingColumns" }], guessed: 0 };
  }

  const products: DraftProduct[] = [];
  const problems: RowProblem[] = [];
  const seenSkus = new Set<string>();

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const line = index + 1;

    const title = cell(row, header.title);
    if (!title) { problems.push({ line, column: "title", reason: "bulk.noTitle" }); continue; }

    const price = cell(row, header.price);
    if (!MONEY.test(price)) { problems.push({ line, column: "price", reason: "bulk.badPrice" }); continue; }

    const stockText = cell(row, header.stock);
    const stock = stockText === "" ? 0 : Number(stockText);
    if (!Number.isInteger(stock) || stock < 0) {
      problems.push({ line, column: "stock", reason: "bulk.badStock" });
      continue;
    }

    const sku = cell(row, header.sku) || null;
    if (sku && seenSkus.has(sku.toLowerCase())) {
      /* A file naming one code twice contradicts itself, and picking either
         row is choosing for the seller. */
      problems.push({ line, column: "sku", reason: "bulk.duplicateSku" });
      continue;
    }
    if (sku) seenSkus.add(sku.toLowerCase());

    const compareAt = cell(row, header.compareAtPrice);
    const description = cell(row, header.description);
    const typed = cell(row, header.category);
    const guess = typed ? null : suggestDepartment(`${title} ${description}`, categories);

    products.push({
      line,
      title,
      sku,
      price,
      compareAtPrice: MONEY.test(compareAt) ? compareAt : null,
      stock,
      category: typed || guess,
      categoryGuessed: !typed && guess !== null,
      description,
      imageUrl: cell(row, header.imageUrl) || null,
    });
  }

  return { products, problems, guessed: products.filter(product => product.categoryGuessed).length };
}

/* ----------------------------------------------------- auto-categorising --- */

/**
 * The words that mean a department, in both languages.
 *
 * Keyed by slug rather than by name so a merchant department (one NetLet does
 * not know) simply has no words and is never guessed into — which is right:
 * these are NetLet's own five, and inventing keywords for somebody else's
 * category would be guessing on their behalf.
 *
 * Arabic is here because half this catalog is typed in it, and an importer
 * that only understands English titles auto-categorises half a shop.
 */
const DEPARTMENT_WORDS: Record<string, string[]> = {
  electronics: [
    "laptop", "phone", "mobile", "tablet", "camera", "headphone", "earbud", "speaker", "tv", "television",
    "monitor", "charger", "cable", "console", "router", "printer", "watch", "smart",
    "لابتوب", "هاتف", "جوال", "تابلت", "كاميرا", "سماعة", "سماعات", "تلفزيون", "شاشة", "شاحن", "ساعة",
  ],
  "home-and-kitchen": [
    "kettle", "pan", "pot", "cooker", "blender", "mug", "cup", "plate", "cutlery", "lamp", "cushion",
    "sofa", "chair", "table", "rug", "curtain", "towel", "mattress", "vacuum", "kitchen", "oven",
    "غلاية", "قدر", "مقلاة", "خلاط", "كوب", "صحن", "مصباح", "وسادة", "أريكة", "كرسي", "طاولة", "سجاد", "مطبخ",
  ],
  beauty: [
    "cream", "serum", "lipstick", "perfume", "shampoo", "lotion", "makeup", "skincare", "fragrance",
    "moisturiser", "moisturizer", "cleanser", "mascara", "nail",
    "كريم", "سيروم", "عطر", "شامبو", "مكياج", "عناية", "بشرة", "مرطب",
  ],
  style: [
    "shirt", "dress", "abaya", "trouser", "jeans", "shoe", "sneaker", "sandal", "bag", "handbag",
    "scarf", "jacket", "coat", "sunglasses", "belt", "cotton", "silk",
    "قميص", "فستان", "عباية", "بنطلون", "حذاء", "حقيبة", "وشاح", "جاكيت", "نظارة",
  ],
  grocery: [
    "rice", "oil", "sugar", "flour", "tea", "coffee", "milk", "cheese", "tomato", "date", "honey",
    "water", "juice", "spice", "kg", "litre", "liter", "pack",
    "أرز", "زيت", "سكر", "طحين", "شاي", "قهوة", "حليب", "جبن", "طماطم", "تمر", "عسل", "ماء", "عصير", "بهار",
  ],
};

/**
 * Which department a title sounds like, or null.
 *
 * Deterministic and keyword-based, and that is the choice rather than a
 * shortcut. A model could be asked, and this codebase's own rule is that **a
 * model reorders and never chooses** — so the most a model could honestly do
 * here is pick among the departments this already scored, for an answer a word
 * match gets right on "Brass Reading Lamp". What it would add is a network
 * call, a key, a timeout and a failure branch on the one path where being
 * slow is most obvious: a seller waiting on a preview of four hundred rows.
 *
 * **Null is a real answer.** A product filed under the wrong department is
 * harder to find than one filed under none, and the seller sees every guess in
 * the preview before anything is written.
 */
export function suggestDepartment(text: string, categories: string[]): string | null {
  const haystack = ` ${text.toLowerCase()} `;

  let best: { name: string; score: number } | null = null;
  for (const department of DEPARTMENTS) {
    /* Only ever a department this shop actually carries: guessing into one
       that is not in the catalog files a product nowhere anybody can browse. */
    if (!categories.includes(department.name)) continue;

    const words = DEPARTMENT_WORDS[department.slug] ?? [];
    const score = words.reduce((total, word) => (haystack.includes(` ${word}`) ? total + 1 : total), 0);
    if (score > 0 && (!best || score > best.score)) best = { name: department.name, score };
  }

  return best?.name ?? null;
}

/**
 * The file a seller starts from.
 *
 * Shipped as text rather than a link to a document nobody updates: it is
 * generated from `COLUMNS`, so a column added here appears in the template on
 * the next build and the two cannot drift.
 */
export function templateCsv(): string {
  const header = (Object.keys(COLUMNS) as ColumnName[]).map(name => COLUMNS[name][0]).join(",");
  return `${header}\nBrass Reading Lamp,LAMP-01,24.500,31.000,12,,A warm brass lamp for a side table,https://example.com/lamp.jpg\n`;
}
