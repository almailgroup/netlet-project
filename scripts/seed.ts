/**
 * `pnpm db:seed` — the rows a fresh NetLet cannot start without.
 *
 * A brand-new database has no categories and no vendors, and the admin portal
 * cannot create a product without both: a product needs a vendor to belong to
 * before it can exist, and a department before it can be found. This writes
 * exactly those, and nothing else.
 *
 * It does NOT write sample products. An invented catalog on a real
 * deployment is worse than an empty one — it looks like the shop is open.
 *
 * Safe to run more than once: every insert is keyed on the natural unique and
 * skipped when the row is already there, so re-running after adding a
 * department does not disturb what is already published.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { categories, users, vendorMembers, vendors } from "../drizzle/schema";
import { DEPARTMENTS } from "../Shared/commerce/departments";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set. See .env.example — this script has nothing to write to.");
  process.exit(1);
}

const sql = postgres(url, { prepare: false });
const db = drizzle(sql);

async function seedDepartments() {
  let added = 0;
  for (const department of DEPARTMENTS) {
    const [existing] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, department.slug)).limit(1);
    if (existing) continue;
    await db.insert(categories).values(department);
    added += 1;
  }
  console.log(`Departments: ${added} added, ${DEPARTMENTS.length - added} already there.`);
}

/**
 * The house vendor.
 *
 * NetLet sells its own stock as well as its vendors', and something has to
 * own a product before a product can exist. It is approved and auto-publishes
 * — an admin reviewing their own listings is a step that teaches nothing.
 */
async function seedHouseVendor() {
  const [existing] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.slug, "netlet")).limit(1);
  if (existing) {
    console.log("House vendor: already there.");
    return existing.id;
  }
  const [created] = await db
    .insert(vendors)
    .values({
      slug: "netlet",
      name: "NetLet",
      nameAr: "نتلت",
      status: "approved",
      autoPublish: true,
      // NetLet takes nothing from itself.
      commissionPercent: "0.00",
    })
    .returning();
  console.log("House vendor: created.");
  return created.id;
}

/**
 * Put the owner account in the house vendor, if it exists yet.
 *
 * OWNER_EMAIL is granted the admin role when it registers, and an admin
 * already reaches everything — but being a member of a vendor is what makes
 * the portal's vendor-side pages show something real to test with.
 */
async function linkOwner(vendorId: number) {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!email) {
    console.log("Owner link: OWNER_EMAIL not set, skipped.");
    return;
  }
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!owner) {
    console.log(`Owner link: no account for ${email} yet — register it, then run this again.`);
    return;
  }
  const [member] = await db
    .select({ id: vendorMembers.id })
    .from(vendorMembers)
    .where(eq(vendorMembers.userId, owner.id))
    .limit(1);
  if (member) {
    console.log("Owner link: already a member.");
    return;
  }
  await db.insert(vendorMembers).values({ vendorId, userId: owner.id, role: "owner" });
  console.log(`Owner link: ${email} added as owner of the house vendor.`);
}

async function main() {
  await seedDepartments();
  const vendorId = await seedHouseVendor();
  await linkOwner(vendorId);
  console.log("\nDone. Add products at /admin.");
}

main()
  .catch(error => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
