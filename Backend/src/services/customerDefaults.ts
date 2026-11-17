/**
 * An account's defaults, the database half (migration 0088): the delivery
 * address and the way to pay every order starts from. The rule is
 * `Shared/commerce/customerDefaults.ts`.
 *
 * **Every query is scoped by the account inside the query**, for the address
 * book's reason: an address id is a serial, short enough to type, so "make
 * address 4 my default" has to be refused by the `where` that reads it, and
 * an address that is somebody else's reads as no address.
 *
 * **Closed, not broken, until 0088 is pasted.** A missing table reads as no
 * default (`ready: false`), and a write answers `saved: false` rather than
 * failing: the device keeps the address in use until then (`lib/lastAddress`
 * on the web, `UserDefaults` in the app), so choosing an address in the
 * header's book goes on working before the paste and is kept on the account
 * after it.
 */
import { and, eq, sql } from "drizzle-orm";
import { customerAddresses, customerDefaults } from "../../database/schema.js";
import {
  choosablePayments,
  defaultPayment,
  type CustomerDefaults,
  type PaymentMethod,
} from "../../../Shared/commerce/customerDefaults.js";
import { featureOn } from "./features.js";
import { getDb } from "./db.js";
import { isMissingTable } from "../core/describeError.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Refused for a reason the shopper can act on, as a message key. */
export class DefaultsRefused extends Error {
  constructor(public readonly reason: "defaults.noSuchAddress" | "defaults.paymentNotOffered") {
    super(reason);
    this.name = "DefaultsRefused";
  }
}

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

async function choosable(): Promise<PaymentMethod[]> {
  return choosablePayments({ cashOnDelivery: await featureOn("cashOnDelivery") });
}

/** The account's defaults, as the page draws them. */
export async function defaultsFor(userId: number): Promise<CustomerDefaults> {
  const db = await handle();
  const ways = await choosable();
  try {
    const [row] = await db
      .select({ addressId: customerDefaults.addressId, payment: customerDefaults.paymentMethod, governorate: customerAddresses.governorate })
      .from(customerDefaults)
      .leftJoin(customerAddresses, and(eq(customerAddresses.id, customerDefaults.addressId), eq(customerAddresses.userId, userId)))
      .where(eq(customerDefaults.userId, userId))
      .limit(1);
    return {
      ready: true,
      addressId: row?.addressId ?? null,
      governorate: row?.governorate ?? null,
      payment: defaultPayment(row?.payment, ways),
      choosable: ways,
    };
  } catch (error) {
    if (isMissingTable(error)) return { ready: false, addressId: null, governorate: null, payment: defaultPayment(null, ways), choosable: ways };
    throw error;
  }
}

/**
 * Makes `addressId` the account's default, or clears it with null. The address
 * is read with the account in the `where`, so another shopper's id is refused
 * as one that does not exist.
 */
export async function setDefaultAddress(userId: number, addressId: number | null): Promise<{ saved: boolean }> {
  const db = await handle();
  if (addressId !== null) {
    const [own] = await db
      .select({ id: customerAddresses.id })
      .from(customerAddresses)
      .where(and(eq(customerAddresses.id, addressId), eq(customerAddresses.userId, userId)))
      .limit(1);
    if (!own) throw new DefaultsRefused("defaults.noSuchAddress");
  }
  try {
    await db
      .insert(customerDefaults)
      .values({ userId, addressId })
      .onConflictDoUpdate({ target: customerDefaults.userId, set: { addressId, updatedAt: sql`now()` } });
    return { saved: true };
  } catch (error) {
    if (isMissingTable(error)) return { saved: false };
    throw error;
  }
}

/** Keeps `method` as the account's way to pay, only while the shop offers it. */
export async function setDefaultPayment(userId: number, method: PaymentMethod): Promise<{ saved: boolean }> {
  const db = await handle();
  if (!(await choosable()).includes(method)) throw new DefaultsRefused("defaults.paymentNotOffered");
  try {
    await db
      .insert(customerDefaults)
      .values({ userId, paymentMethod: method })
      .onConflictDoUpdate({ target: customerDefaults.userId, set: { paymentMethod: method, updatedAt: sql`now()` } });
    return { saved: true };
  } catch (error) {
    if (isMissingTable(error)) return { saved: false };
    throw error;
  }
}
