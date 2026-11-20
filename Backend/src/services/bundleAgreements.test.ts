/**
 * Sets made by arrangement (3.3.11, migration 0091), against a real Postgres.
 *
 * A store makes a set with another store's product; the set is not on sale
 * and saves nothing in a bag until that store agrees; a new price takes the
 * answer back; a set with nothing of the owner's own, a store that is not
 * selling, and a store answering a set it is not in are refused; and with the
 * table gone a set with another store's product cannot be made at all.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  auditLog,
  bundleAgreements,
  notifications,
  products,
  productVariants,
  users,
  vendorMembers,
  vendors,
} from "../../database/schema.js";
import type { Actor } from "../../../Shared/inventory/permissions.js";

let db: ReturnType<typeof drizzle>;
let bundlesModule: typeof import("./bundles");

const ids = { acmeOwner: 0, betaOwner: 0, gammaOwner: 0, acme: 0, beta: 0, gamma: 0, closed: 0 };

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client);
  const dir = path.resolve(import.meta.dirname, "../../database");
  for (const file of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(dir, file), "utf-8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  vi.doMock("./db", async () => {
    const actual = await vi.importActual<typeof import("./db.js")>("./db.js");
    return { ...actual, getDb: async () => db };
  });
  bundlesModule = await import("./bundles");

  const [a] = await db.insert(users).values({ email: "owner@acme.test" }).returning();
  const [b] = await db.insert(users).values({ email: "owner@beta.test" }).returning();
  const [g] = await db.insert(users).values({ email: "owner@gamma.test" }).returning();
  ids.acmeOwner = a.id; ids.betaOwner = b.id; ids.gammaOwner = g.id;
  /* Every store holds a valid discount permit, so a set's saving may be shown. */
  const permit = { discountLicenceNumber: "MOC-1", discountLicenceExpiresAt: new Date("2099-01-01") };
  const [acme] = await db.insert(vendors).values({ slug: "acme", name: "Acme", status: "approved", ...permit }).returning();
  const [beta] = await db.insert(vendors).values({ slug: "beta", name: "Beta Home", status: "approved", ...permit }).returning();
  const [gamma] = await db.insert(vendors).values({ slug: "gamma", name: "Gamma", status: "approved", ...permit }).returning();
  const [closed] = await db.insert(vendors).values({ slug: "closed", name: "Closed", status: "suspended", ...permit }).returning();
  ids.acme = acme.id; ids.beta = beta.id; ids.gamma = gamma.id; ids.closed = closed.id;
  await db.insert(vendorMembers).values([
    { vendorId: acme.id, userId: a.id, role: "owner" },
    { vendorId: beta.id, userId: b.id, role: "owner" },
    { vendorId: gamma.id, userId: g.id, role: "owner" },
  ]);
}, 60_000);

const acmeOwner = (): Actor => ({ kind: "vendor", userId: ids.acmeOwner, vendorId: ids.acme, role: "owner" });
const betaOwner = (): Actor => ({ kind: "vendor", userId: ids.betaOwner, vendorId: ids.beta, role: "owner" });
const gammaOwner = (): Actor => ({ kind: "vendor", userId: ids.gammaOwner, vendorId: ids.gamma, role: "owner" });

let serial = 0;
async function variant(vendorId: number, price = "10.000") {
  serial += 1;
  const [row] = await db.insert(products).values({ vendorId, handle: `item-${serial}`, title: `Item ${serial}`, status: "published" }).returning();
  const [v] = await db.insert(productVariants).values({ productId: row.id, title: "Default", price, stock: 5 }).returning();
  return v.id;
}

async function onSale(bundleId: number): Promise<boolean> {
  const db_ = db as unknown as Parameters<typeof bundlesModule.loadBundles>[0];
  return (await bundlesModule.loadBundles(db_, { ids: [bundleId], onlySellable: true })).length === 1;
}

describe("a set made with another store's product", () => {
  it("is made at once, asks the other store, and is not on sale or priced until it agrees", async () => {
    const lamp = await variant(ids.acme, "20.000");
    const rug = await variant(ids.beta, "30.000");
    const { id } = await bundlesModule.saveBundle(acmeOwner(), {
      name: "Lamp and rug", vendorId: ids.acme, bundlePrice: "45.000",
      members: [{ variantId: lamp, quantity: 1 }, { variantId: rug, quantity: 1 }],
    });

    expect(await onSale(id)).toBe(false);
    const asked = await bundlesModule.listAskedBundles(betaOwner());
    expect(asked.map(view => [view.id, view.myState])).toContainEqual([id, "waiting"]);
    const told = await db.select().from(notifications).where(and(eq(notifications.userId, ids.betaOwner), eq(notifications.kind, "seller_bundle_asked")));
    expect(told).toHaveLength(1);

    const db_ = db as unknown as Parameters<typeof bundlesModule.bundlePricing>[0];
    const lines = [{ variantId: lamp, quantity: 1, bundleId: id }, { variantId: rug, quantity: 1, bundleId: id }];
    expect((await bundlesModule.bundlePricing(db_, lines)).size).toBe(0);

    expect(await bundlesModule.answerBundle(betaOwner(), { bundleId: id, state: "agreed" })).toEqual({ agreed: true });
    expect(await onSale(id)).toBe(true);
    expect((await bundlesModule.bundlePricing(db_, lines)).size).toBe(2);
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.action, "bundle.agree"), eq(auditLog.subjectId, id)));
    expect(audit).toMatchObject({ vendorId: ids.beta });
    const ownerTold = await db.select().from(notifications).where(and(eq(notifications.userId, ids.acmeOwner), eq(notifications.kind, "seller_bundle_agreed")));
    expect(ownerTold).toHaveLength(1);
  });

  it("asks again when the price changes, and keeps the answer for a new name", async () => {
    const lamp = await variant(ids.acme, "20.000");
    const rug = await variant(ids.beta, "30.000");
    const members = [{ variantId: lamp, quantity: 1 }, { variantId: rug, quantity: 1 }];
    const { id } = await bundlesModule.saveBundle(acmeOwner(), { name: "Pair", vendorId: ids.acme, bundlePrice: "45.000", members });
    await bundlesModule.answerBundle(betaOwner(), { bundleId: id, state: "agreed" });

    await bundlesModule.saveBundle(acmeOwner(), { id, name: "Pair, renamed", vendorId: ids.acme, bundlePrice: "45.000", members });
    expect(await onSale(id)).toBe(true);

    await bundlesModule.saveBundle(acmeOwner(), { id, name: "Pair, renamed", vendorId: ids.acme, bundlePrice: "40.000", members });
    expect(await onSale(id)).toBe(false);
    expect(await db.select().from(bundleAgreements).where(eq(bundleAgreements.bundleId, id))).toHaveLength(0);
  });

  it("stays off sale while any store declines, and declining needs words", async () => {
    const lamp = await variant(ids.acme, "20.000");
    const rug = await variant(ids.beta, "30.000");
    const vase = await variant(ids.gamma, "10.000");
    const { id } = await bundlesModule.saveBundle(acmeOwner(), {
      name: "Three shops", vendorId: ids.acme, bundlePrice: "50.000",
      members: [{ variantId: lamp, quantity: 1 }, { variantId: rug, quantity: 1 }, { variantId: vase, quantity: 1 }],
    });
    await expect(bundlesModule.answerBundle(gammaOwner(), { bundleId: id, state: "declined", note: " " })).rejects.toThrow("bundle.declineNeedsNote");
    await bundlesModule.answerBundle(betaOwner(), { bundleId: id, state: "agreed" });
    expect(await bundlesModule.answerBundle(gammaOwner(), { bundleId: id, state: "declined", note: "Too low for the vase" })).toEqual({ agreed: false });
    expect(await onSale(id)).toBe(false);

    const [view] = await bundlesModule.listBundles(acmeOwner()).then(all => all.filter(entry => entry.id === id));
    expect(view.agreement.declined).toBe(true);
    expect(view.agreement.asked.find(entry => entry.vendorId === ids.gamma)).toMatchObject({ state: "declined", note: "Too low for the vase" });

    /* Changing its mind: the set goes on sale once the last store agrees. */
    expect(await bundlesModule.answerBundle(gammaOwner(), { bundleId: id, state: "agreed" })).toEqual({ agreed: true });
    expect(await onSale(id)).toBe(true);
  });

  it("refuses a set of other stores' goods alone, and a store that is not selling", async () => {
    const rug = await variant(ids.beta);
    const vase = await variant(ids.gamma);
    await expect(bundlesModule.saveBundle(acmeOwner(), {
      name: "Not mine", vendorId: ids.acme, bundlePrice: "15.000",
      members: [{ variantId: rug, quantity: 1 }, { variantId: vase, quantity: 1 }],
    })).rejects.toThrow("bundle.needsYours");

    const lamp = await variant(ids.acme);
    const shut = await variant(ids.closed);
    await expect(bundlesModule.saveBundle(acmeOwner(), {
      name: "Shut", vendorId: ids.acme, bundlePrice: "15.000",
      members: [{ variantId: lamp, quantity: 1 }, { variantId: shut, quantity: 1 }],
    })).rejects.toThrow("bundle.storeUnavailable");
  });

  it("refuses an answer from a store that is not in the set, and from its owner", async () => {
    const lamp = await variant(ids.acme);
    const rug = await variant(ids.beta);
    const { id } = await bundlesModule.saveBundle(acmeOwner(), {
      name: "Two", vendorId: ids.acme, bundlePrice: "15.000",
      members: [{ variantId: lamp, quantity: 1 }, { variantId: rug, quantity: 1 }],
    });
    await expect(bundlesModule.answerBundle(gammaOwner(), { bundleId: id, state: "agreed" })).rejects.toThrow("bundle.notAsked");
    await expect(bundlesModule.answerBundle(acmeOwner(), { bundleId: id, state: "agreed" })).rejects.toThrow("bundle.notAsked");
  });

  it("names the set, its items and its stores in Arabic too, for the Arabic page", async () => {
    await db.update(vendors).set({ nameAr: "بيتا" }).where(eq(vendors.id, ids.beta));
    await db.update(vendors).set({ nameAr: "أكمي" }).where(eq(vendors.id, ids.acme));
    const lamp = await variant(ids.acme);
    const rug = await variant(ids.beta);
    await db.update(products).set({ titleAr: "سجادة" }).where(sql`id = (select product_id from product_variants where id = ${rug})`);
    const { id } = await bundlesModule.saveBundle(acmeOwner(), {
      name: "Named", nameAr: "طقم", vendorId: ids.acme, bundlePrice: "15.000",
      members: [{ variantId: lamp, quantity: 1 }, { variantId: rug, quantity: 1 }],
    });
    const [view] = (await bundlesModule.listAskedBundles(betaOwner())).filter(entry => entry.id === id);
    expect(view).toMatchObject({ nameAr: "طقم", ownerNameAr: "أكمي" });
    expect(view.agreement.asked).toEqual([expect.objectContaining({ vendorId: ids.beta, vendorNameAr: "بيتا" })]);
    expect(view.members.find(member => member.vendorId === ids.beta)).toMatchObject({ productTitleAr: "سجادة", vendorNameAr: "بيتا" });
  });

  it("asks nobody about a store's own set, which is on sale at once", async () => {
    const lamp = await variant(ids.acme);
    const bulb = await variant(ids.acme);
    const { id } = await bundlesModule.saveBundle(acmeOwner(), {
      name: "Own", vendorId: ids.acme, bundlePrice: "15.000",
      members: [{ variantId: lamp, quantity: 1 }, { variantId: bulb, quantity: 1 }],
    });
    expect(await onSale(id)).toBe(true);
  });
});

describe("before migration 0091 is pasted", () => {
  it("refuses a set with another store's product and leaves a store's own sets alone", async () => {
    await db.execute(sql`alter table bundle_agreements rename to bundle_agreements_away`);
    bundlesModule.forgetBundleAgreementReadiness();
    try {
      const lamp = await variant(ids.acme);
      const rug = await variant(ids.beta);
      await expect(bundlesModule.saveBundle(acmeOwner(), {
        name: "Waits", vendorId: ids.acme, bundlePrice: "15.000",
        members: [{ variantId: lamp, quantity: 1 }, { variantId: rug, quantity: 1 }],
      })).rejects.toThrow("bundle.arrangementUnavailable");
      expect(await bundlesModule.listAskedBundles(betaOwner())).toEqual([]);

      const bulb = await variant(ids.acme);
      const { id } = await bundlesModule.saveBundle(acmeOwner(), {
        name: "Own still", vendorId: ids.acme, bundlePrice: "15.000",
        members: [{ variantId: lamp, quantity: 1 }, { variantId: bulb, quantity: 1 }],
      });
      expect(await onSale(id)).toBe(true);
    } finally {
      await db.execute(sql`alter table bundle_agreements_away rename to bundle_agreements`);
      bundlesModule.forgetBundleAgreementReadiness();
    }
  });
});
