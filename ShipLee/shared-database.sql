-- ShipLee inside NetLet's Supabase database, walled off from NetLet.
--
-- Paste this into NetLet's Supabase project: SQL Editor -> New query.
-- First put a password of your own where it says CHOOSE-A-PASSWORD below:
-- 20 or more characters, letters and numbers only, so it works inside the
-- connection address. Then press Run. Running it again is safe, and running
-- it with a different password changes the password.
--
-- What it makes:
--   * a section of the database called "shiplee", where ShipLee keeps its
--     four tables (ShipLee makes them itself on its first visit);
--   * a login called "shiplee_app" that can make and use tables in that
--     section and nothing else: it cannot read or change any NetLet table;
--   * limits on that login, at most 10 database connections and 30 seconds a
--     query, so ShipLee can never crowd NetLet out.
--
-- The last line shows the login it made. ShipLee's DATABASE_URL is then NetLet's
-- "Transaction pooler" address with two changes: the user "postgres.<ref>"
-- becomes "shiplee_app.<ref>", and the password is the one chosen here.

do $$
declare
  shiplee_password text := 'CHOOSE-A-PASSWORD';
begin
  if shiplee_password like 'CHOOSE-%' then
    raise exception 'Put your own password on the shiplee_password line first.';
  end if;
  if length(shiplee_password) < 20 then
    raise exception 'The password needs 20 or more characters.';
  end if;
  if shiplee_password !~ '^[A-Za-z0-9]+$' then
    raise exception 'Use letters and numbers only, so the password works inside the connection address.';
  end if;

  if exists (select 1 from pg_roles where rolname = 'shiplee_app') then
    execute format('alter role shiplee_app with login password %L connection limit 10', shiplee_password);
  else
    execute format('create role shiplee_app with login password %L connection limit 10', shiplee_password);
  end if;
end $$;

create schema if not exists shiplee;
grant usage, create on schema shiplee to shiplee_app;

-- ShipLee names its tables without a section, so they land in "shiplee".
alter role shiplee_app set search_path = shiplee;
alter role shiplee_app set statement_timeout = '30s';

select rolname as login, rolconnlimit as connection_limit, rolconfig as settings
from pg_roles
where rolname = 'shiplee_app';
