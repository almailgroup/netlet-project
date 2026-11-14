/**
 * Where shipments are kept. `sqlStore` is the database; `memoryStore` holds the
 * demo parcels for a server with none, and answers exactly as the database
 * does, so the pages cannot tell which they are talking to.
 */
import type { Db, Row } from "./db.js";
import { ensureSchema } from "./schema.js";
import type { ShipmentDetails, ShipmentRow, StaffShipment, TrackingEvent, UpdateDetails } from "../shared/shipment.js";
import type { Status } from "../shared/status.js";
import type { Governorate } from "../shared/kuwait.js";
import { demoParcels } from "../shared/demo.js";
import { foldDigits } from "../shared/digits.js";

export const PAGE_SIZE = 25;

export type ShipmentList = { rows: ShipmentRow[]; total: number; page: number; pages: number };

export class DuplicateNumber extends Error {}

export interface Store {
  readonly kind: "postgres" | "demo";
  byNumber(trackingNumber: string): Promise<StaffShipment | null>;
  byId(id: number): Promise<StaffShipment | null>;
  list(search: { q: string; page: number }): Promise<ShipmentList>;
  /** Throws `DuplicateNumber` when the number is taken, so the caller can draw another. */
  create(details: ShipmentDetails, trackingNumber: string, at: Date): Promise<StaffShipment>;
  update(id: number, details: ShipmentDetails): Promise<StaffShipment | null>;
  /** `expectedOn` undefined keeps the expected day; null clears it. */
  addEvent(id: number, update: Omit<UpdateDetails, "expectedOn">, expectedOn: string | null | undefined): Promise<StaffShipment | null>;
  /** Failed staff sign-ins from one address since a moment, and noting one. */
  failuresSince(address: string, since: Date): Promise<number>;
  noteFailure(address: string, at: Date): Promise<void>;
  clearFailures(address: string): Promise<void>;
}

/* ---------- The database ---------- */

const iso = (value: unknown) => new Date(value as string | Date).toISOString();
const count = (value: unknown) => Number(value);

const SHIPMENT_COLUMNS = `id, tracking_number, status, sender_name, recipient_name, recipient_phone, governorate, area, address,
  pieces, cod_fils, to_char(expected_on, 'YYYY-MM-DD') as expected_on, created_at, updated_at`;

function rowOf(row: Row): ShipmentRow {
  return {
    id: count(row.id),
    trackingNumber: String(row.tracking_number),
    status: row.status as Status,
    senderName: String(row.sender_name),
    recipientName: (row.recipient_name as string | null) ?? null,
    recipientPhone: (row.recipient_phone as string | null) ?? null,
    governorate: (row.governorate as Governorate | null) ?? null,
    area: (row.area as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    pieces: count(row.pieces),
    codFils: row.cod_fils === null || row.cod_fils === undefined ? null : count(row.cod_fils),
    expectedOn: (row.expected_on as string | null) ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function eventOf(row: Row): TrackingEvent {
  return {
    status: row.status as Status,
    location: (row.location as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    happenedAt: iso(row.happened_at),
  };
}

/** `%` and `_` typed into the search are letters, not patterns. */
const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === "23505") return true;
  }
  return false;
}

export function sqlStore(db: Db): Store {
  let ready: Promise<void> | null = null;
  /* The tables are made once per server instance, before its first query; a failure is tried again next time. */
  const prepared = () => (ready ??= ensureSchema(db).catch(error => { ready = null; throw error; }));

  async function load(where: string, value: unknown, on: Db = db): Promise<StaffShipment | null> {
    const [row] = await on.query(`select ${SHIPMENT_COLUMNS} from shipments where ${where} = $1`, [value]);
    if (!row) return null;
    const events = await on.query(
      `select status, location, note, happened_at from shipment_events where shipment_id = $1 order by happened_at desc, id desc`,
      [row.id],
    );
    return { ...rowOf(row), events: events.map(eventOf) };
  }

  return {
    kind: "postgres",
    async byNumber(trackingNumber) {
      await prepared();
      return load("tracking_number", trackingNumber);
    },
    async byId(id) {
      await prepared();
      return load("id", id);
    },
    async list({ q, page }) {
      await prepared();
      const term = foldDigits(q.trim());
      const params: unknown[] = [];
      let where = "";
      if (term) {
        params.push(likeTerm(term), likeTerm(term.replace(/\s+/g, "")));
        where = `where (sender_name ilike $1 or recipient_name ilike $1 or area ilike $1 or tracking_number ilike $2 or recipient_phone like $2)`;
      }
      const [{ total } = { total: 0 }] = await db.query<{ total: unknown }>(`select count(*) as total from shipments ${where}`, params);
      const pages = Math.max(1, Math.ceil(count(total) / PAGE_SIZE));
      const shown = Math.min(Math.max(1, page), pages);
      const rows = await db.query(
        `select ${SHIPMENT_COLUMNS} from shipments ${where} order by updated_at desc, id desc limit ${PAGE_SIZE} offset ${(shown - 1) * PAGE_SIZE}`,
        params,
      );
      return { rows: rows.map(rowOf), total: count(total), page: shown, pages };
    },
    async create(details, trackingNumber, at) {
      await prepared();
      try {
        return await db.transaction(async tx => {
          const [row] = await tx.query<{ id: unknown }>(
            `insert into shipments (tracking_number, sender_name, recipient_name, recipient_phone, governorate, area, address, pieces, cod_fils, expected_on, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) returning id`,
            [trackingNumber, details.senderName, details.recipientName, details.recipientPhone, details.governorate, details.area, details.address, details.pieces, details.codFils, details.expectedOn, at],
          );
          await tx.query(`insert into shipment_events (shipment_id, status, happened_at) values ($1, 'created', $2)`, [row!.id, at]);
          return (await load("id", row!.id, tx))!;
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateNumber();
        throw error;
      }
    },
    async update(id, details) {
      await prepared();
      const rows = await db.query(
        `update shipments set sender_name = $2, recipient_name = $3, recipient_phone = $4, governorate = $5, area = $6, address = $7,
           pieces = $8, cod_fils = $9, expected_on = $10, updated_at = now() where id = $1 returning id`,
        [id, details.senderName, details.recipientName, details.recipientPhone, details.governorate, details.area, details.address, details.pieces, details.codFils, details.expectedOn],
      );
      return rows.length ? load("id", id) : null;
    },
    async addEvent(id, update, expectedOn) {
      await prepared();
      return db.transaction(async tx => {
        /* The row is locked, so two updates added at once settle the status in order. */
        const [found] = await tx.query(`select id from shipments where id = $1 for update`, [id]);
        if (!found) return null;
        await tx.query(`insert into shipment_events (shipment_id, status, location, note, happened_at) values ($1, $2, $3, $4, $5)`, [id, update.status, update.location, update.note, update.happenedAt]);
        /* The status is the newest update's by when it happened, so an update entered late for earlier in the day does not move the parcel backwards. */
        await tx.query(
          `update shipments set updated_at = now(),
             status = (select status from shipment_events where shipment_id = $1 order by happened_at desc, id desc limit 1)
             ${expectedOn === undefined ? "" : ", expected_on = $2"}
           where id = $1`,
          expectedOn === undefined ? [id] : [id, expectedOn],
        );
        return load("id", id, tx);
      });
    },
    async failuresSince(address, since) {
      await prepared();
      const [{ n } = { n: 0 }] = await db.query<{ n: unknown }>(`select count(*) as n from staff_sign_in_failures where address = $1 and failed_at > $2`, [address, since]);
      return count(n);
    },
    async noteFailure(address, at) {
      await prepared();
      await db.query(`insert into staff_sign_in_failures (address, failed_at) values ($1, $2)`, [address, at]);
      /* Old failures say nothing any more; they are cleared as new ones come. */
      await db.query(`delete from staff_sign_in_failures where failed_at < $1`, [new Date(at.getTime() - 24 * 60 * 60 * 1000)]);
    },
    async clearFailures(address) {
      await prepared();
      await db.query(`delete from staff_sign_in_failures where address = $1`, [address]);
    },
  };
}

/* ---------- The demo, in memory ---------- */

type Kept = { row: ShipmentRow; events: (TrackingEvent & { order: number })[] };

export function memoryStore(now: Date = new Date()): Store {
  const kept: Kept[] = [];
  const failures: { address: string; at: Date }[] = [];
  let nextId = 1;
  let nextOrder = 1;

  const view = (k: Kept): StaffShipment => ({
    ...k.row,
    events: [...k.events]
      .sort((a, b) => b.happenedAt.localeCompare(a.happenedAt) || b.order - a.order)
      .map(({ order: _order, ...event }) => event),
  });
  const settle = (k: Kept) => {
    k.row.status = view(k).events[0]?.status ?? "created";
  };

  for (const parcel of demoParcels(now)) {
    const createdAt = new Date(now.getTime() - parcel.events[0]!.hoursAgo * 3_600_000).toISOString();
    const k: Kept = {
      row: {
        id: nextId++,
        trackingNumber: parcel.trackingNumber,
        status: "created",
        senderName: parcel.senderName,
        recipientName: parcel.recipientName,
        recipientPhone: parcel.recipientPhone,
        governorate: parcel.governorate,
        area: parcel.area,
        address: parcel.address,
        pieces: parcel.pieces,
        codFils: parcel.codFils,
        expectedOn: parcel.expectedOn,
        createdAt,
        updatedAt: new Date(now.getTime() - parcel.events.at(-1)!.hoursAgo * 3_600_000).toISOString(),
      },
      events: parcel.events.map(event => ({
        status: event.status,
        location: event.location,
        note: event.note ?? null,
        happenedAt: new Date(now.getTime() - event.hoursAgo * 3_600_000).toISOString(),
        order: nextOrder++,
      })),
    };
    settle(k);
    kept.push(k);
  }

  const find = (id: number) => kept.find(k => k.row.id === id) ?? null;

  return {
    kind: "demo",
    async byNumber(trackingNumber) {
      const k = kept.find(k => k.row.trackingNumber === trackingNumber);
      return k ? view(k) : null;
    },
    async byId(id) {
      const k = find(id);
      return k ? view(k) : null;
    },
    async list({ q, page }) {
      const term = foldDigits(q.trim()).toLowerCase();
      const compact = term.replace(/\s+/g, "");
      const matching = kept
        .filter(({ row }) => !term
          || [row.senderName, row.recipientName ?? "", row.area ?? ""].some(text => text.toLowerCase().includes(term))
          || row.trackingNumber.toLowerCase().includes(compact)
          || (row.recipientPhone ?? "").includes(compact))
        .sort((a, b) => b.row.updatedAt.localeCompare(a.row.updatedAt) || b.row.id - a.row.id);
      const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
      const shown = Math.min(Math.max(1, page), pages);
      return { rows: matching.slice((shown - 1) * PAGE_SIZE, shown * PAGE_SIZE).map(k => ({ ...k.row })), total: matching.length, page: shown, pages };
    },
    async create(details, trackingNumber, at) {
      if (kept.some(k => k.row.trackingNumber === trackingNumber)) throw new DuplicateNumber();
      const k: Kept = {
        row: { id: nextId++, trackingNumber, status: "created", ...details, createdAt: at.toISOString(), updatedAt: at.toISOString() },
        events: [{ status: "created", location: null, note: null, happenedAt: at.toISOString(), order: nextOrder++ }],
      };
      kept.push(k);
      return view(k);
    },
    async update(id, details) {
      const k = find(id);
      if (!k) return null;
      Object.assign(k.row, details, { updatedAt: new Date().toISOString() });
      return view(k);
    },
    async addEvent(id, update, expectedOn) {
      const k = find(id);
      if (!k) return null;
      k.events.push({ status: update.status, location: update.location, note: update.note, happenedAt: update.happenedAt.toISOString(), order: nextOrder++ });
      settle(k);
      if (expectedOn !== undefined) k.row.expectedOn = expectedOn;
      k.row.updatedAt = new Date().toISOString();
      return view(k);
    },
    async failuresSince(address, since) {
      return failures.filter(f => f.address === address && f.at > since).length;
    },
    async noteFailure(address, at) {
      failures.push({ address, at });
    },
    async clearFailures(address) {
      for (let i = failures.length - 1; i >= 0; i--) if (failures[i]!.address === address) failures.splice(i, 1);
    },
  };
}
