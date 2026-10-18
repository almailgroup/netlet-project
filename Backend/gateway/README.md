# NetLet AI gateway

A Cloudflare Worker that holds the Gemini API key and is the only thing that
talks to Gemini — for every model call NetLet makes. A browser reaches it with
a short-lived token that NetLet's own server signs, and the server reaches it
the same way for its own calls, so the key never leaves Cloudflare and nobody
can use the gateway without NetLet's say-so.

```
browser ── tRPC ai.gateway ──▶ NetLet server   (who is asking? may they? is `ai` on?)
   │                              │ signs a 5-minute token with AI_GATEWAY_SECRET
   │ ◀────── { url, token } ──────┘
   │
   └── POST /api/ai/chat, Authorization: Bearer <token> ──▶ this Worker ──▶ Gemini
                                    (origin, token, scope, ceilings, body, contact filter)

NetLet server ── POST /api/ai/generate, a 1-minute `server` token ──▶ this Worker ──▶ Gemini
   (search refinement, Picked for you, photo search, support drafts, the review queue, the Arabic name)
```

| Route | Scope | Answers |
| --- | --- | --- |
| `GET /` or `/healthz` | none | `{ ok, data: { configured, model } }` — never the key |
| `POST /api/ai/chat` | `chat` | Server-Sent Events: `{type:"delta",text}` … `{type:"done",finish}` |
| `POST /api/ai/catalog-assist` | `catalog` | `{ ok: true, data: CatalogDraft }` |
| `POST /api/ai/generate` | `server` | `{ ok: true, data: { text } }` — NetLet's server only; the token is never handed out |

Every refusal is `{ ok: false, error: { code, message, field? } }` with the
status in `GATEWAY_STATUS`. The request and response types, the token and the
request checks are `shared/ai/gateway.ts`, the one file the Worker, NetLet's
server and the browser all import.

## What you need

- A Cloudflare account (the free plan is enough to start).
- A Gemini API key from Google AI Studio. Set a spending cap on the project in
  Google Cloud as well: the gateway's ceilings stop one caller, the cap stops
  everything.
- Node 20 or newer. Commands use `npx wrangler@4`; nothing is added to
  NetLet's own dependencies.

## 1. Sign in and make the shared secret

Run these from this folder (`workers/ai-gateway`).

```sh
npx wrangler@4 login

# 32+ random characters. NetLet's server needs the same value (step 4).
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 2. Try it locally

Put the two secrets in `.dev.vars` (ignored by git — never commit it):

```sh
cat > .dev.vars <<'EOF'
GEMINI_API_KEY=your-gemini-key
AI_GATEWAY_SECRET=the-value-from-step-1
ALLOWED_ORIGINS=http://localhost:3000
EOF

npx wrangler@4 dev            # http://127.0.0.1:8787
curl http://127.0.0.1:8787/healthz
```

`ALLOWED_ORIGINS` in `.dev.vars` replaces the production list for local runs.
The rate limits work locally too. Point a local NetLet at it with
`AI_GATEWAY_URL=http://127.0.0.1:8787` and the same `AI_GATEWAY_SECRET` in
NetLet's `.env`.

The Worker's tests run with NetLet's own (`pnpm test`), against a stand-in
Gemini:

```sh
pnpm vitest run workers shared/ai      # from the repository root
```

## 3. Deploy

```sh
npx wrangler@4 secret put GEMINI_API_KEY        # paste the key when asked
npx wrangler@4 secret put AI_GATEWAY_SECRET     # paste the value from step 1
npx wrangler@4 deploy
```

`deploy` prints the address, `https://netlet-ai-gateway.<your-subdomain>.workers.dev`.
Before deploying, set `ALLOWED_ORIGINS` in `wrangler.toml` to the addresses
NetLet is served from (the Vercel address too, while it is in use). To serve
the gateway from NetLet's own domain instead, add it under Workers → the
Worker → Settings → Domains & Routes, e.g. `ai.netlet.net`.

```sh
curl https://netlet-ai-gateway.<your-subdomain>.workers.dev/healthz
# {"ok":true,"data":{"configured":true,"model":"gemini-2.5-flash"}}
```

`npx wrangler@4 deploy --dry-run --outdir dist` checks the configuration and
the bundle (about 150 KB gzipped) without an account.

## 4. Connect NetLet

In Vercel → the project → Settings → Environment Variables:

| Name | Value |
| --- | --- |
| `AI_GATEWAY_URL` | the address from step 3, no trailing slash |
| `AI_GATEWAY_SECRET` | the same value as the Worker's |

Redeploy NetLet. Unset, `ai.gateway` answers `{ available: false }` and
nothing that uses the gateway is drawn — the rule every optional service here
follows. The `ai` switch on `/admin/features` turns it off as well; tokens
already handed out last at most five minutes.

## Changing things

- **The prompts** are in `src/prompts.ts`. The chat's facts come from the help
  page's own answers (`shared/commerce/helpArticles.ts`) and the catalogue's
  departments and rows from `shared/commerce/`, so a policy change on NetLet's
  side reaches the gateway at its next deploy — deploy it with NetLet when
  those files change.
- **The ceilings** are the `[[ratelimits]]` in `wrangler.toml`: per caller per
  minute for each route, and per network address across both.
- **The model** is `GEMINI_MODEL` in `wrangler.toml`.
- **Rotating the secret**: set the new value on the Worker and on Vercel
  together; tokens signed with the old one stop working within five minutes.
