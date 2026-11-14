/**
 * ShipLee's tables. They are made on the first request a server instance
 * answers (`ensureSchema`), so setting ShipLee up is connecting a database and
 * nothing more: every statement is `if not exists`, and an advisory lock keeps
 * two instances starting at once from racing to make the same table.
 *
 * Row-level security is on with no policies, which closes the tables to
 * Supabase's public API keys; the server connects as the database's owner and
 * is not held by it.
 *
 * `create table if not exists` does not change a table that is already there,
 * so a later change to a column or a status list is an `alter` added below.
 */
import { STATUSES } from "../shared/status.js";
import { GOVERNORATES } from "../shared/kuwait.js";
import { LIMITS } from "../shared/shipment.js";
import type { Db } from "./db.js";

const list = (values: readonly string[]) => values.map(value => `'${value}'`).join(", ");

export const SCHEMA = `
create table if not exists shipments (
  id bigint generated always as identity primary key,
  tracking_number text not null unique check (tracking_number ~ '^SL[0-9]{10}$'),
  status text not null default 'created' check (status in (${list(STATUSES)})),
  sender_name text not null check (char_length(sender_name) between 1 and ${LIMITS.name}),
  recipient_name text check (char_length(recipient_name) <= ${LIMITS.name}),
  recipient_phone text check (recipient_phone ~ '^[245689][0-9]{7}$'),
  governorate text check (governorate in (${list(GOVERNORATES.map(g => g.slug))})),
  area text check (char_length(area) <= ${LIMITS.area}),
  address text check (char_length(address) <= ${LIMITS.address}),
  pieces integer not null default 1 check (pieces between 1 and ${LIMITS.pieces}),
  cod_fils bigint check (cod_fils > 0 and cod_fils <= ${LIMITS.codFils}),
  expected_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shipments_by_update on shipments (updated_at desc, id desc);

create table if not exists shipment_events (
  id bigint generated always as identity primary key,
  shipment_id bigint not null references shipments (id) on delete cascade,
  status text not null check (status in (${list(STATUSES)})),
  location text check (char_length(location) <= ${LIMITS.location}),
  note text check (char_length(note) <= ${LIMITS.note}),
  happened_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists shipment_events_by_shipment on shipment_events (shipment_id, happened_at desc, id desc);

create table if not exists staff_sign_in_failures (
  id bigint generated always as identity primary key,
  address text not null,
  failed_at timestamptz not null default now()
);
create index if not exists staff_sign_in_failures_by_address on staff_sign_in_failures (address, failed_at);

alter table shipments enable row level security;
alter table shipment_events enable row level security;
alter table staff_sign_in_failures enable row level security;
`;

/** Any number will do, so long as nothing else on the database takes the same lock. */
const SCHEMA_LOCK = 7_406_115_533;

export async function ensureSchema(db: Db): Promise<void> {
  await db.transaction(async tx => {
    await tx.query(`select pg_advisory_xact_lock(${SCHEMA_LOCK})`);
    await tx.script(SCHEMA);
  });
}
