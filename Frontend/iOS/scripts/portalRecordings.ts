/**
 * The demo answers for the portal's dashboard, its stock page and its
 * co-pilot, written by the shop's own rules.
 *
 * Every other recording in `NetLet/Resources/Demo/` was captured off a server
 * with the development seed. These three need sales spread over months and a
 * shelf with something running low, which that seed does not have, so they
 * are made here instead — but never by hand: the lines are the demo store's
 * own products (the ones its recorded orders and product list name), and the
 * answers are what `buildDashboard`, `briefFrom`, `daysOfCover` and
 * `reorderFor` make of them, so their shape is the server's exactly. The day
 * is the recordings' own (`TODAY`, the last day of `demo.inventory.sales`).
 *
 * The model is never stood in for: a question asked of the demo co-pilot gets
 * the server's "could not answer", which is what a server with no gateway
 * says, and the brief is the part that needs no model.
 *
 *     pnpm ios:portal-recordings            # write the files
 *     pnpm ios:portal-recordings --check    # fail when they are stale
 *
 * `portalRecordings.test.ts` runs the check in `pnpm test`.
 */
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import superjson from "superjson";
import { briefFrom, COPILOT_PAGES, reorderFor, type CopilotFacts, type CopilotPage } from "../../../Shared/ai/copilot.js";
import { buildDashboard, daysOfCover, stockState, type Dashboard, type DashboardLine, type StockHealth } from "../../../Shared/commerce/dashboard.js";
import { DEPARTMENTS } from "../../../Shared/commerce/departments.js";
import { translate } from "../../../Shared/i18n/dictionary.js";
import { can, type Actor } from "../../../Shared/inventory/permissions.js";
import { fromFils, toFils } from "../../../Shared/money.js";
import { kuwaitDay } from "../../../Shared/kuwaitDay.js";

/** Noon in Kuwait on the recordings' last day. */
const TODAY = new Date("2026-10-21T09:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

type Item = { productId: number; title: string; department: string | null; price: string; weight: number; store: number };

/* The demo store (Acme Electronics, vendor 2) sells these, as its recorded
   product list and orders name them; Gulf Grocers and Souq Style are the
   shop's other two stores, seen only by NetLet's administrator. */
const ITEMS: Item[] = [
  { productId: 3, title: "Smart watch", department: "electronics", price: "70.000", weight: 3, store: 2 },
  { productId: 10, title: "Linen shirt", department: "style", price: "12.500", weight: 5, store: 2 },
  { productId: 2, title: "USB-C charger 65W", department: "electronics", price: "8.750", weight: 4, store: 2 },
  { productId: 216, title: "Wireless earbuds", department: "electronics", price: "10.000", weight: 3, store: 2 },
  { productId: 217, title: "Power bank 20000 mAh", department: "electronics", price: "5.000", weight: 2, store: 2 },
  { productId: 218, title: "Bluetooth speaker", department: "electronics", price: "14.000", weight: 2, store: 2 },
  { productId: 228, title: "Basmati rice 5 kg", department: "grocery", price: "4.750", weight: 6, store: 3 },
  { productId: 227, title: "Medjool dates 1 kg", department: "grocery", price: "6.250", weight: 5, store: 3 },
  { productId: 226, title: "Cotton dishdasha", department: "style", price: "19.500", weight: 3, store: 4 },
  { productId: 225, title: "Leather sandals", department: "style", price: "15.000", weight: 2, store: 4 },
];

/** A small deterministic generator, so the files are the same on every run. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Ninety-five days of orders with a Gulf week's rhythm (Thursday and Friday busiest) and a slow rise. */
function linesFor(stores: number[]): DashboardLine[] {
  const next = random(stores.length * 7919 + stores[0]);
  const items = ITEMS.filter(item => stores.includes(item.store));
  const weights = items.reduce((sum, item) => sum + item.weight, 0);
  const pick = () => {
    let roll = next() * weights;
    for (const item of items) {
      roll -= item.weight;
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  };
  const lines: DashboardLine[] = [];
  let orderId = 1000;
  for (let back = 190; back >= 0; back--) {
    const at = new Date(TODAY.getTime() - back * DAY_MS);
    const weekday = new Date(`${kuwaitDay(at)}T12:00:00Z`).getUTCDay();
    const rhythm = weekday === 4 ? 1.7 : weekday === 5 ? 1.4 : weekday === 6 ? 0.8 : 1;
    const rise = 1 + (190 - back) / 190;
    const orders = Math.max(0, Math.round((stores.length > 1 ? 4 : 1.2) * rhythm * rise * rise + (next() - 0.5) * 2));
    for (let n = 0; n < orders; n++) {
      orderId += 1;
      const buyerId = 100 + Math.floor(next() * (stores.length > 1 ? 160 : 90));
      const placedAt = new Date(at.getTime() - Math.floor(next() * 8 * 3_600_000));
      const count = next() < 0.3 ? 2 : 1;
      for (let line = 0; line < count; line++) {
        const item = pick();
        const quantity = next() < 0.2 ? 2 : 1;
        lines.push({
          orderId,
          placedAt,
          lineTotal: fromFils(toFils(item.price) * BigInt(quantity)),
          quantity,
          buyerId,
          department: item.department,
          productId: item.productId,
          productTitle: item.title,
        });
      }
    }
  }
  return lines;
}

/** Accounts opened each day, for the administrator's activity line. */
function accountDays(): string[] {
  const next = random(4242);
  const days: string[] = [];
  for (let back = 190; back >= 0; back--) {
    const at = new Date(TODAY.getTime() - back * DAY_MS);
    const joined = Math.round(2 + (190 - back) / 60 + next() * 3);
    for (let n = 0; n < joined; n++) days.push(kuwaitDay(at));
  }
  return days;
}

type LowRow = {
  variantId: number;
  variantTitle: string;
  sku: string | null;
  stock: number;
  lowStockAt: number | null;
  preorderStock: number;
  productId: number;
  productTitle: string;
  productStatus: "published";
  vendorName: string;
  waiting: number;
  soldLately: number;
};

/* The demo store's shelves that are low, as `inventory.lowStock` lists them:
   worst first, by stock less the reorder point. Variant ids are the seed's
   (a product's first variant shares its id; the shirt's sizes are 10–13). */
const ACME_LOW: LowRow[] = [
  { variantId: 2, variantTitle: "Default", sku: "USBC-65", stock: 0, lowStockAt: 3, preorderStock: 0, productId: 2, productTitle: "USB-C charger 65W", productStatus: "published", vendorName: "Acme Electronics", waiting: 3, soldLately: 12 },
  { variantId: 3, variantTitle: "Default", sku: "WATCH-1", stock: 2, lowStockAt: 5, preorderStock: 0, productId: 3, productTitle: "Smart watch", productStatus: "published", vendorName: "Acme Electronics", waiting: 0, soldLately: 11 },
  { variantId: 11, variantTitle: "M", sku: "LIN-M", stock: 4, lowStockAt: 6, preorderStock: 0, productId: 10, productTitle: "Linen shirt", productStatus: "published", vendorName: "Acme Electronics", waiting: 1, soldLately: 9 },
];
const OTHER_LOW: LowRow[] = [
  { variantId: 145, variantTitle: "Default", sku: null, stock: 0, lowStockAt: null, preorderStock: 40, productId: 228, productTitle: "Basmati rice 5 kg", productStatus: "published", vendorName: "Gulf Grocers", waiting: 0, soldLately: 30 },
  { variantId: 142, variantTitle: "Default", sku: null, stock: 1, lowStockAt: 4, preorderStock: 0, productId: 225, productTitle: "Leather sandals", productStatus: "published", vendorName: "Souq Style", waiting: 2, soldLately: 5 },
];

function shelfOf(rows: LowRow[], variants: number): StockHealth {
  const shelf: StockHealth = { healthy: 0, low: 0, out: 0, preorder: 0 };
  for (const row of rows) shelf[stockState(row)] += 1;
  shelf.healthy = variants - shelf.low - shelf.out - shelf.preorder;
  return shelf;
}

function lowPage(rows: LowRow[]) {
  const sorted = [...rows].sort((a, b) => a.stock - (a.lowStockAt ?? 0) - (b.stock - (b.lowStockAt ?? 0)) || a.variantId - b.variantId);
  return { rows: sorted, total: sorted.length, page: 1, pageSize: 50 };
}

function factsFor(actor: Actor, board: Dashboard, rows: LowRow[], waiting: CopilotFacts["waiting"]): CopilotFacts {
  const scope = actor.kind === "vendor" ? actor.vendorId : undefined;
  const pages = (Object.keys(COPILOT_PAGES) as CopilotPage[]).filter(page => can(actor, COPILOT_PAGES[page], scope));
  const name = (slug: string | null, other?: boolean) =>
    other ? "Other departments" : DEPARTMENTS.find(department => department.slug === slug)?.name ?? "Not in a department";
  return {
    today: kuwaitDay(TODAY),
    sales: {
      days: board.range,
      total: board.totals.sales.current,
      previous: board.totals.sales.previous,
      change: board.totals.sales.change,
      orders: board.totals.orders.current,
      averageOrder: board.totals.averageOrder.current,
      customers: board.totals.customers.current,
      forecastNext7: fromFils(board.forecast.reduce((sum, day) => sum + toFils(day.sales), 0n)),
      last14: board.days.slice(-14).map(day => ({ day: day.day, sales: day.sales })),
      departments: board.departments.map(entry => ({ slug: entry.slug, name: name(entry.slug, entry.other), sales: entry.sales, percent: entry.percent })),
    },
    stock: {
      ...board.stock,
      lowest: rows.map(row => ({
        variantId: row.variantId,
        product: row.productTitle,
        variant: row.variantTitle,
        stock: row.stock,
        reorderAt: row.lowStockAt,
        soldLast28: row.soldLately,
        daysOfCover: daysOfCover(row.stock, row.soldLately),
        suggestedReorderAt: reorderFor(row.soldLately),
      })),
    },
    waiting,
    pages,
  };
}

/** Every file this writes, by its name under `Resources/Demo/` without the `demo.` and `.json`. */
export function portalRecordings(): Record<string, unknown> {
  const acme: Actor = { kind: "vendor", userId: 5, vendorId: 2, role: "owner" };
  const admin: Actor = { kind: "admin", userId: 1 };
  const acmeShelf = shelfOf(ACME_LOW, 10);
  const allShelf = shelfOf([...ACME_LOW, ...OTHER_LOW], 14);
  const acmeBoard = buildDashboard({ lines: linesFor([2]), now: TODAY, range: 30, stock: acmeShelf, accountDays: null });
  const adminBoard = buildDashboard({ lines: linesFor([2, 3, 4]), now: TODAY, range: 30, stock: allShelf, accountDays: accountDays() });
  const adminWaiting: CopilotFacts["waiting"] = [
    { page: "/admin/support", label: "copilot.waitSupport", what: translate("en", "copilot.waitSupport"), count: 2 },
    { page: "/admin/returns", label: "copilot.waitReturns", what: translate("en", "copilot.waitReturns"), count: 1 },
  ];
  const acmeLow = lowPage(ACME_LOW);
  const allLow = lowPage([...ACME_LOW, ...OTHER_LOW]);
  return {
    "inventory.dashboard": acmeBoard,
    "inventory.dashboard.admin": adminBoard,
    "inventory.stockHealth": acmeShelf,
    "inventory.stockHealth.admin": allShelf,
    "inventory.lowStock": acmeLow,
    "inventory.lowStock.admin": allLow,
    "inventory.copilot.brief": { insights: briefFrom(factsFor(acme, acmeBoard, acmeLow.rows, [])), ask: true, inquiries: 0 },
    "inventory.copilot.brief.admin": { insights: briefFrom(factsFor(admin, adminBoard, allLow.rows, adminWaiting)), ask: true, inquiries: 2 },
    "inventory.copilot.ask": { kind: "unavailable" },
    "inventory.variants.setReorderPoint": { variantId: 3, lowStockAt: 6 },
    "inventory.variants.adjustStock": 6,
    /* The captured overview, its two stock counts kept in step with the shelf above. */
    "inventory.overview": {
      ...capturedOverview(),
      outOfStock: ACME_LOW.filter(row => row.stock <= 0).length,
      lowStock: ACME_LOW.filter(row => row.lowStockAt !== null && row.stock > 0 && row.stock <= row.lowStockAt).length,
    },
  };
}

function capturedOverview(): Record<string, unknown> {
  const file = JSON.parse(readFileSync(path.join(DEMO, "demo.inventory.overview.json"), "utf-8"));
  return superjson.deserialize(file.result.data);
}

const DEMO = path.resolve(import.meta.dirname, "../NetLet/Resources/Demo");

/** The file's text, as superjson sends an answer. */
export function recordingText(value: unknown): string {
  return `${JSON.stringify({ result: { data: superjson.serialize(value) } }, null, 2)}\n`;
}

export function stalePortalRecordings(): string[] {
  return Object.entries(portalRecordings())
    .filter(([name, value]) => {
      try {
        return readFileSync(path.join(DEMO, `demo.${name}.json`), "utf-8") !== recordingText(value);
      } catch {
        return true;
      }
    })
    .map(([name]) => name);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  if (process.argv.includes("--check")) {
    const stale = stalePortalRecordings();
    if (stale.length) {
      console.error(`Stale portal recordings: ${stale.join(", ")}. Run pnpm ios:portal-recordings.`);
      process.exit(1);
    }
  } else {
    for (const [name, value] of Object.entries(portalRecordings())) writeFileSync(path.join(DEMO, `demo.${name}.json`), recordingText(value));
  }
}
