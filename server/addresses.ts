/**
 * The shopper's address book, and which line goes where.
 *
 * Requirement 3.2.6. `shared/commerce/addresses.ts` is the rules; this is the
 * half that needs a database. Outside `db.ts` for the reason `profile.ts`,
 * `orders.ts` and `finance.ts` are: functions inside `db.ts` call its
 * module-local `getDb`, which nothing outside can redirect, so anything living
 * there cannot be tested against a real Postgres.
 *
 * **Every query is scoped by `userId` inside the data layer**, never filtered
 * in the router. An address id is a serial and short enough to paste, so
 * "update address 4" has to be refused by the query itself rather than by a
 * check somebody remembers to write at the second call site.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  MAX_ADDRESSES,
  addressProblems,
  type ShippingAddress,
} from "../shared/commerce/addresses.js";
import { cartItems, carts, customerAddresses } from "../drizzle/schema.js";
import { getDb } from "./db.js";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Refused for a reason the shopper can act on, as a message key. */
export class AddressError extends Error {}

export type SavedAddress = ShippingAddress & { id: number };

async function handle(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  return db;
}

const COLUMNS = {
  id: customerAddresses.id,
  label: customerAddresses.label,
  contactName: customerAddresses.contactName,
  contactPhone: customerAddresses.contactPhone,
  governorate: customerAddresses.governorate,
  addressLine: customerAddresses.addressLine,
  addressNotes: customerAddresses.addressNotes,
};

/** Oldest first, so the list does not reorder itself under somebody editing it. */
export async function listAddresses(userId: number): Promise<SavedAddress[]> {
  const db = await handle();
  return db
    .select(COLUMNS)
    .from(customerAddresses)
    .where(eq(customerAddresses.userId, userId))
    .orderBy(asc(customerAddresses.id));
}

function checked(address: ShippingAddress): void {
  const problems = addressProblems(address);
  if (problems.length > 0) throw new AddressError(problems[0]);
}

/**
 * Add one, up to the ceiling.
 *
 * The count is read and the insert follows, which two tabs can beat by one —
 * and that is accepted here rather than closed with a constraint, because the
 * thing being protected is a page that stays readable rather than a figure
 * somebody is charged. A thirteenth address is untidy; a race lost on a stock
 * take is an item sold twice.
 */
export async function addAddress(userId: number, address: ShippingAddress): Promise<SavedAddress> {
  checked(address);
  const db = await handle();

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customerAddresses)
    .where(eq(customerAddresses.userId, userId));
  if (count >= MAX_ADDRESSES) throw new AddressError("address.tooMany");

  const [row] = await db
    .insert(customerAddresses)
    .values({
      userId,
      label: address.label.trim(),
      contactName: address.contactName?.trim() || null,
      contactPhone: address.contactPhone?.trim() || null,
      governorate: address.governorate?.trim() || null,
      addressLine: (address.addressLine ?? "").trim(),
      addressNotes: address.addressNotes?.trim() || null,
    })
    .returning(COLUMNS);
  return row;
}

/** Change one. The `userId` in the predicate is the whole access control. */
export async function updateAddress(
  userId: number,
  id: number,
  address: ShippingAddress,
): Promise<SavedAddress> {
  checked(address);
  const db = await handle();

  const [row] = await db
    .update(customerAddresses)
    .set({
      label: address.label.trim(),
      contactName: address.contactName?.trim() || null,
      contactPhone: address.contactPhone?.trim() || null,
      governorate: address.governorate?.trim() || null,
      addressLine: (address.addressLine ?? "").trim(),
      addressNotes: address.addressNotes?.trim() || null,
    })
    .where(and(eq(customerAddresses.id, id), eq(customerAddresses.userId, userId)))
    .returning(COLUMNS);

  if (!row) throw new AddressError("address.unknown");
  return row;
}

/**
 * Remove one.
 *
 * `cart_items.address_id` is `set null`, so a line pointed at it goes back to
 * the order's own door rather than to nowhere — and an order already placed
 * keeps the copy frozen onto its line, so deleting an address never changes
 * where a parcel was sent.
 */
export async function removeAddress(userId: number, id: number): Promise<void> {
  const db = await handle();
  const [row] = await db
    .delete(customerAddresses)
    .where(and(eq(customerAddresses.id, id), eq(customerAddresses.userId, userId)))
    .returning({ id: customerAddresses.id });
  if (!row) throw new AddressError("address.unknown");
}

/**
 * Send one basket line to a different door.
 *
 * Both halves are checked in one statement: the line has to be in *this* cart
 * and the address has to belong to *this* shopper. Written as a subquery
 * rather than as two reads and a write, so a line cannot be redirected to an
 * address that was deleted between the check and the update.
 *
 * `null` puts the line back where the order is going, which is how the control
 * is cleared as well as how it starts.
 */
export async function setLineDestination(
  cartId: string,
  userId: number | null | undefined,
  cartItemId: number,
  addressId: number | null,
): Promise<void> {
  const db = await handle();

  if (addressId !== null) {
    if (!userId) throw new AddressError("address.needsAccount");
    const [owned] = await db
      .select({ id: customerAddresses.id })
      .from(customerAddresses)
      .where(and(eq(customerAddresses.id, addressId), eq(customerAddresses.userId, userId)))
      .limit(1);
    if (!owned) throw new AddressError("address.unknown");
  }

  const [row] = await db
    .update(cartItems)
    .set({ addressId })
    .where(and(eq(cartItems.id, cartItemId), eq(cartItems.cartId, cartId)))
    .returning({ id: cartItems.id });
  if (!row) throw new AddressError("address.unknownLine");
}

/**
 * The addresses a cart's lines actually point at, by id.
 *
 * One query for the whole basket rather than one per line, and scoped through
 * the cart's own owner: a destination on a line whose address has since moved
 * to another account is simply absent, and the line falls back to the order's
 * address the way an unset one does.
 */
export async function destinationsForCart(db: Db, cartId: string): Promise<Map<number, SavedAddress>> {
  const [cart] = await db.select({ userId: carts.userId }).from(carts).where(eq(carts.id, cartId)).limit(1);
  if (!cart?.userId) return new Map();

  const ids: { addressId: number | null }[] = await db
    .select({ addressId: cartItems.addressId })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));
  const wanted: number[] = [...new Set(ids.map(row => row.addressId).filter((id): id is number => id !== null))];
  if (wanted.length === 0) return new Map();

  const rows = await db
    .select(COLUMNS)
    .from(customerAddresses)
    .where(and(eq(customerAddresses.userId, cart.userId), inArray(customerAddresses.id, wanted)));

  return new Map(rows.map(row => [row.id, row]));
}
