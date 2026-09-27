/** Property probe: the money identities this codebase says it holds. */
import { freezeLine, draftOrder, sliceByVendor, type PriceableLine } from "../shared/commerce/order.js";
import { commissionFor } from "../shared/inventory/commission.js";
import { toFils, fromFils, addMoney, multiplyMoney, subtractMoney } from "../shared/money.js";
import { settle } from "../shared/commerce/vouchers.js";
import { splitBundlePrice, separatelyTotal, chargedTotal } from "../shared/commerce/bundles.js";
import { quoteDelivery, groupForDelivery, freezeDelivery, frozenTotal, type DeliveryRule } from "../shared/commerce/delivery.js";
import { addonsTotal } from "../shared/commerce/addons.js";

let seed = 123456789;
let worstLoss = { fils: 0n, bundlePrice: "", charged: "", lines: 0, units: 0 };
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const money = (maxFils = 500_000) => fromFils(BigInt(Math.floor(rnd() * maxFils)));
const qty = () => 1 + Math.floor(rnd() * 12);

const fails: string[] = [];
const check = (name: string, ok: boolean, detail: string) => { if (!ok) fails.push(`${name}: ${detail}`); };

/* 1. commission + vendorNet === lineTotal, exactly, on every line. */
for (let i = 0; i < 40000; i += 1) {
  const line: PriceableLine = {
    variantId: 1, productId: 1, vendorId: 1, vendorName: "V",
    productTitle: "P", variantTitle: null, sku: null,
    unitPrice: money(), quantity: qty(),
    vendorRule: { percent: pick([null, "0.00", "10.00", "7.35", "100.00", "33.33"]), fixed: pick([null, "0.000", "1.500", "0.001"]) },
    productRule: pick([null, { percent: pick([null, "0.00", "5.00", "99.99"]), fixed: pick([null, "0.000", "2.250"]) }]),
    addons: rnd() < 0.35 ? [{ id: 1, kind: "installation", label: "fit", price: money(20000) }] : [],
  };
  const frozen = freezeLine(line);
  check("commission identity",
    toFils(frozen.commissionAmount) + toFils(frozen.vendorNet) === toFils(frozen.lineTotal),
    `${frozen.unitPrice}x${frozen.quantity} → ${frozen.commissionAmount}+${frozen.vendorNet} != ${frozen.lineTotal}`);
  check("commission never negative", toFils(frozen.commissionAmount) >= 0n, frozen.commissionAmount);
  check("vendorNet never negative", toFils(frozen.vendorNet) >= 0n,
    `net ${frozen.vendorNet} on line ${frozen.lineTotal} (rule ${JSON.stringify(line.vendorRule)}/${JSON.stringify(line.productRule)})`);
  check("lineTotal = goods + addons",
    toFils(frozen.lineTotal) === toFils(multiplyMoney(frozen.unitPrice, frozen.quantity)) + toFils(frozen.addonsTotal),
    `${frozen.lineTotal}`);
}

/* 2. draftOrder totals are the sum of its lines. */
for (let i = 0; i < 4000; i += 1) {
  const lines: PriceableLine[] = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, n) => ({
    variantId: n + 1, productId: n + 1, vendorId: 1 + Math.floor(rnd() * 3), vendorName: "V",
    productTitle: "P", variantTitle: null, sku: null,
    unitPrice: money(), quantity: qty(),
    vendorRule: { percent: pick([null, "10.00", "2.50"]), fixed: null },
    productRule: null, addons: [],
  }));
  const delivery = money(5000);
  const draft = draftOrder(lines, delivery);
  const sum = draft.lines.reduce((acc, l) => acc + toFils(l.lineTotal), 0n);
  check("itemsTotal = sum of lines", toFils(draft.totals.itemsTotal) === sum, `${draft.totals.itemsTotal}`);
  check("grandTotal = items + delivery",
    toFils(draft.totals.grandTotal) === sum + toFils(delivery), `${draft.totals.grandTotal}`);
  check("commissionTotal = sum",
    toFils(draft.totals.commissionTotal) === draft.lines.reduce((a, l) => a + toFils(l.commissionAmount), 0n), "");
  const slices = sliceByVendor(draft.lines);
  check("slices cover every line", slices.reduce((a, s) => a + s.lines.length, 0) === draft.lines.length, "");
}

/* 3. settle(): never charges more than owed, never negative. */
for (let i = 0; i < 20000; i += 1) {
  const goods = money(), delivery = money(4000);
  const bill = settle({ goods, delivery, discount: money(), points: money(), giftCard: money() });
  const owed = toFils(goods) + toFils(delivery);
  check("payable never negative", toFils(bill.payable) >= 0n, bill.payable);
  check("payable <= owed", toFils(bill.payable) <= owed, `${bill.payable} > ${goods}+${delivery}`);
  const applied = toFils(bill.discount) + toFils(bill.points) + toFils(bill.giftCard);
  check("reductions + payable = owed", applied + toFils(bill.payable) === owed,
    `${applied} + ${bill.payable} != ${owed}`);
}

/* 4. A bundle never charges more than its price. */
for (let i = 0; i < 20000; i += 1) {
  const members = Array.from({ length: 2 + Math.floor(rnd() * 3) }, (_, n) => ({
    variantId: n + 1, productId: n + 1, vendorId: 1, vendorName: "V",
    productTitle: "P", variantTitle: null, unitPrice: money(200_000), quantity: qty(),
  }));
  const separately = separatelyTotal(members as never);
  if (toFils(separately) === 0n) continue;
  const bundlePrice = fromFils(toFils(separately) * BigInt(50 + Math.floor(rnd() * 49)) / 100n);
  const priced = splitBundlePrice({ bundlePrice, members } as never);
  const charged = chargedTotal(priced);
  check("bundle never charges more than its price",
    toFils(charged) <= toFils(bundlePrice),
    `charged ${charged} > bundle ${bundlePrice} (separately ${separately})`);
  const lost = toFils(bundlePrice) - toFils(charged);
  if (lost > worstLoss.fils) worstLoss = { fils: lost, bundlePrice, charged, lines: priced.length, units: members.reduce((a, m) => a + m.quantity, 0) };
  for (const line of priced) {
    check("member never priced above its own list", toFils(line.bundleUnitPrice) <= toFils(line.unitPrice),
      `${line.bundleUnitPrice} > ${line.unitPrice}`);
  }
}

/* 5. Delivery: the total is the sum of the parcels, frozen and live. */
for (let i = 0; i < 20000; i += 1) {
  const rules = new Map<number | null, DeliveryRule>();
  for (let v = 1; v <= 3; v += 1) rules.set(v, { flat: pick([null, "0.000", money(4000)]), freeOver: pick([null, money()]) });
  const lines = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => ({
    vendorId: 1 + Math.floor(rnd() * 3), vendorName: "V",
    destinationId: pick([null, 1, 2]), destinationLabel: null, value: money(),
  }));
  const quote = quoteDelivery(groupForDelivery(lines, rules));
  const sum = quote.perVendor.reduce((a, r) => a + toFils(r.fee), 0n);
  check("delivery total = sum of parcels", toFils(quote.total) === sum, `${quote.total} != ${fromFils(sum)}`);
  check("frozen total matches", frozenTotal(freezeDelivery(quote)) === quote.total, "");
  for (const row of quote.perVendor) {
    check("a free parcel costs nothing", !row.free || toFils(row.fee) === 0n, `${row.fee}`);
    check("toFree is only a live nudge", row.toFree === null || (!row.free && toFils(row.toFree) > 0n), `${row.toFree}`);
  }
}

/* 6. addonsTotal is per unit, times quantity. */
for (let i = 0; i < 20000; i += 1) {
  const addons = Array.from({ length: Math.floor(rnd() * 4) }, (_, n) => ({ id: n, kind: "installation" as const, label: "x", price: money(9000) }));
  const q = qty();
  const expected = addons.reduce((a, x) => a + toFils(x.price), 0n) * BigInt(q);
  check("addons scale with quantity", toFils(addonsTotal(addons, q)) === expected, `${addonsTotal(addons, q)}`);
}

console.log("worst bundle shortfall:", JSON.stringify(worstLoss, (_, v) => typeof v === "bigint" ? String(v) : v));
console.log(fails.length ? `FAILURES (${fails.length}):\n` + [...new Set(fails)].slice(0, 12).join("\n") : "all money properties held");
