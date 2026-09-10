# Running NetLet on the Mac mini

This is the guide for self-hosting the real storefront: the Express + tRPC
server, talking to Postgres for the catalog, the cart and accounts, served from
a Mac mini.

If you are deploying to Vercel instead — which is the supported target — read
`docs/VERCEL.md`. This document is for running it on your own hardware.

## Why this is needed at all

The GitHub Pages site is **not** this. Pages serves static files and cannot run
a server, so the Pages build sets `VITE_DEMO_MODE=true` and answers every tRPC
call in the browser from invented fixtures (`client/src/lib/demoCatalog.ts`).
It never reaches a database — it never makes a network request at all.

`DATABASE_URL` is read server-side, never under a `VITE_` name, because
anything with that prefix is inlined into the browser bundle and would be
public. So the chain is:

```
Postgres  ->  this server (Mac mini)  ->  shopper's browser
```

Until the middle link is running, adding products in the dashboard changes
nothing on the live site.

## What the Mac mini needs

| | |
|---|---|
| Node | 20 or newer (`node --version`) |
| pnpm | `corepack enable && corepack prepare pnpm@latest --activate` |
| Always on | Sleep disabled, or the shop is down whenever it sleeps |
| Postgres | Only for accounts. Browsing, cart and checkout work without it. |

Disable sleep — a sleeping Mac mini is an offline shop:

```sh
sudo pmset -a sleep 0 disksleep 0
sudo pmset -a autorestart 1   # come back up after a power cut
```

## 1. Configure

```sh
pnpm setup:env        # or, by hand: cp .env.example .env
```

Fill in `DATABASE_URL`. `.env.example` documents every other setting and what
breaks without it. Nothing throws at boot when a value is missing — an unset
variable shows up as a dead feature, not an error — so it is worth reading.

```sh
DATABASE_URL=postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres
JWT_SECRET=...                                       # openssl rand -base64 48
```

`.env` is gitignored. Keep it that way; both of those are credentials.

## 2. Create the tables, then check the setup

```sh
pnpm db:push     # applies the migrations
pnpm db:seed     # departments + the house vendor
```

`db:seed` writes no products. A product needs a vendor to own it and a
department to be found in, and those are what it creates; the catalog itself is
yours to add at `/dashboard`.

Then:

```sh
pnpm preflight
```

It reports Node, pnpm, `.env`, the database, the build and the port — and exits
non-zero listing what is still blocking. It catches the mistake that otherwise
surfaces as a bare connection failure: a host and password pasted separately
where the `postgres://` URI belongs.

## 3. Build and run

```sh
pnpm install
pnpm build          # client into dist/public, server into dist/index.js
pnpm start          # serves the API and the built site on PORT (default 3000)
```

Then `http://localhost:3000` on the Mac mini itself should show real products.

`PORT` is honoured exactly in production. If it is taken the server exits with
a message rather than quietly moving to the next free port — a port that drifts
out from under a tunnel is an outage that leaves a healthy-looking process
behind.

## 4. Keep it running

`pnpm start` dies with the terminal. launchd restarts it on crash and on boot.
Write `~/Library/LaunchAgents/com.netlet.storefront.plist`, replacing the two
paths:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>            <string>com.netlet.storefront</string>
  <key>WorkingDirectory</key> <string>/Users/YOU/netlet-project</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/YOU/netlet-project/dist/index.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key> <string>production</string>
    <key>PORT</key>     <string>3000</string>
  </dict>
  <key>RunAtLoad</key>   <true/>
  <key>KeepAlive</key>   <true/>
  <key>StandardOutPath</key>   <string>/Users/YOU/Library/Logs/netlet.log</string>
  <key>StandardErrorPath</key> <string>/Users/YOU/Library/Logs/netlet.error.log</string>
</dict>
</plist>
```

`which node` gives the path for `ProgramArguments` — under Homebrew on Apple
silicon it is `/opt/homebrew/bin/node`, not `/usr/local/bin/node`.

```sh
launchctl load ~/Library/LaunchAgents/com.netlet.storefront.plist
launchctl list | grep netlet          # third column 0 means running
tail -f ~/Library/Logs/netlet.error.log
```

The server reads `.env` from its working directory, which is why
`WorkingDirectory` is set. After changing `.env`:

```sh
launchctl kickstart -k gui/$(id -u)/com.netlet.storefront
```

## 5. Put it on the internet

The Mac mini is behind a home router with a changing IP, so port forwarding is
the fragile option. Cloudflare Tunnel makes an outbound connection instead — no
static IP, no ports opened on the router, and TLS handled for you.

```sh
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create netlet
cloudflared tunnel route dns netlet shop.yourdomain.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: netlet
credentials-file: /Users/YOU/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: shop.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

```sh
cloudflared service install     # survives reboot
```

## 6. Accounts (optional, later)

Browsing, cart and checkout all work as a guest without a database. Sign-in,
saved items, delivery preference and order tracking are what stay dark.

To switch them on, set `DATABASE_URL` in `.env` and create the tables:

```sh
pnpm db:push
pnpm db:studio    # browse the tables in a browser
```

## Deploying an update

```sh
git pull
pnpm install
pnpm build
launchctl kickstart -k gui/$(id -u)/com.netlet.storefront
```

## When something is wrong

| Symptom | Cause |
|---|---|
| Site loads, no products | Either `DATABASE_URL` is unset (`.env` not loaded — check `WorkingDirectory`, then `launchctl kickstart`), or nothing is published yet. A product is only visible when its status is `published` **and** its vendor is `approved`. |
| Dashboard cannot create a product | No vendor exists — run `pnpm db:seed` |
| `Could not find the build directory` | `pnpm build` has not run since the last pull |
| Works locally, not through the domain | Tunnel down (`cloudflared tunnel info netlet`) or pointed at the wrong port |
| Site dead after a reboot | plist not loaded, or the Mac mini slept — see the `pmset` commands above |

## Once this is live

The demo catalog exists only for the Pages preview. When the Mac mini is
serving real products, `client/src/lib/demoCatalog.ts` and `demoLink.ts` can be
deleted along with `VITE_DEMO_MODE` — nothing else references them.
