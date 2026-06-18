# drfuhrman.ai — landing page

Marketing landing page for **DrFuhrman.ai** with an embedded AI chat island.
Built with [Astro](https://astro.build) + React islands and deployed to
**Cloudflare Workers** (Static Assets + a small API worker).

This repo is the reference implementation for the Divinci SDK's
[**Deploy to Cloudflare Workers**](https://sdk.divinci.ai/guides/cloudflare-workers/)
guide — a gated, anonymous landing-page chat backed by a Divinci Release.

### How the chat authenticates

The chat is **anonymous** — there's no Divinci API key or user token anywhere in
this repo, and there's no slot for one. The Worker authenticates each upstream
call to the Divinci API with a **landing-page HMAC**: it signs
`${ts}.${releaseId}.${newPrompt}` with `LANDING_PAGE_HMAC_KEY` and sends
`X-Landing-Page-Ts` / `X-Landing-Page-Sig`. The API (with the Release's
`requireSignedAnonymousChat` on) verifies the signature. A `403
landing_page_sig_invalid` means the key doesn't match the API's — and pasting a
`divinci_…` API key into the HMAC slot will always 403, because it's the wrong
kind of credential.

### Conversation persistence

The chat island mints a stable per-visitor `sessionId`
(`crypto.randomUUID()`, kept in localStorage escrow) and sends it with every
chat-send and feedback call. The Divinci API persists the conversation under
that id as a customer chat — used for usage analytics and for linking a
feedback report to its full conversation. The visitor's **email is never
stored on the persisted chat** (it appears only on feedback notifications).
Session ids are validated end-to-end (8–128 chars of `[A-Za-z0-9_-]`, clamped
in the Worker and re-validated server-side) and persistence is append-only —
a page reload that restarts the client's signed chain can't overwrite the
stored history.

## Tech stack

- **Astro 5** static site, **React 19** islands for the interactive chat
- **Tailwind CSS v4** (via `@tailwindcss/vite`)
- **Cloudflare Workers** runtime (`src/worker.ts`), KV + a Durable Object for
  per-email free-message quota
- **i18n** — UI strings under `src/i18n/ui/` (50+ locales)
- Tests: **Vitest** (unit) + **Playwright** (e2e)

## Prerequisites

- Node.js **>= 22**
- A Cloudflare account with `wrangler` access (for deploys)

## Local development

This project is **two things at once**: an Astro static site (pages + React
islands) and a Cloudflare **Worker** (`src/worker.ts`) that owns every `/api/*`
route — `welcome`, `chat-send`, `chat-feedback`, `verify-email`, and the admin
quota-reset. `astro dev` serves the site but **does not run the Worker**, so
under it alone the `/api/*` routes return **404**. To exercise the chat locally
you run the Worker with `wrangler dev` and supply its secrets via `.dev.vars`.

### 1. Local secrets — `.dev.vars`

`wrangler dev` reads `.dev.vars` (gitignored) for the Worker's secrets. The one
that matters for chat is `LANDING_PAGE_HMAC_KEY`: the Worker HMAC-signs every
upstream `/ai-chat/anonymous-chat` call with it, and the Divinci API rejects the
call without a matching signature. Use the **same value as the target env's
worker secret** (the default `DIVINCI_API_BASE` points at staging, so use the
staging key).

```bash
# .dev.vars  — do NOT commit (it's gitignored)
LANDING_PAGE_HMAC_KEY=<same value as the target env's worker secret>
```

Non-secret vars (`DIVINCI_API_BASE`, `DIVINCI_RELEASE_ID`) come from
`wrangler.toml` and point at **staging** by default — so local chat talks to the
staging backend.

### 2. Run it

```bash
pnpm install

# Option A — full DX: UI hot-reload AND a working chat (two terminals)
pnpm dev:worker    # terminal 1 → real Worker on http://localhost:8787
pnpm dev           # terminal 2 → Astro UI on http://localhost:4321
#                    vite proxies /api → :8787; open http://localhost:4321

# Option B — simplest: everything on one port, no hot-reload
pnpm dev:worker    # → http://localhost:8787 (Worker serves built assets + /api)
```

`pnpm dev` alone (`astro dev`, port 4321) is fine for pure UI/markup work, but
its `/api/*` calls will **404** until `pnpm dev:worker` is also running. If you
see `404` on `/api/welcome` or `/api/chat-send`, the Worker isn't running.

The Worker port is pinned to **8787** (`[dev]` in `wrangler.toml`) to match the
vite `/api` proxy. If wrangler says 8787 is taken and drifts to another port,
the proxy breaks silently — free 8787 (kill the stale `wrangler dev`) instead.

The Worker calls the Divinci API **server-to-server with no `Origin` header**,
so CORS never applies — local dev, any port, and any deployed domain all work
without allowlisting. (The HMAC signature is the gate, not the origin.)

### 3. Resetting the local free-message quota

Each email gets **one** free manual message, tracked in `wrangler dev`'s local
KV + Durable Object state. Once you've used it, `chat-send` returns **402
`quota_exhausted`** (that's the Worker's own gate, *before* any upstream call —
nothing to do with the HMAC key). Two ways to clear it locally:

```bash
# A. Targeted — reset one email (needs ADMIN_RESET_TOKEN in .dev.vars;
#    restart pnpm dev:worker after adding it):
curl -X POST http://localhost:8787/api/admin/reset-quota \
  -H "Authorization: Bearer $(cat .admin-reset-token)" \
  -d '{"email":"you@example.com"}'

# B. Fresh slate — wipe ALL local quota state, then restart:
rm -rf .wrangler/state
pnpm dev:worker
```

This is purely local simulated state — it never touches staging or prod.

## Build & preview

```bash
npm run build      # outputs to dist/
npm run preview
```

## Tests

```bash
npm run test            # unit tests (vitest)
npm run test:coverage   # unit tests with coverage
npm run test:e2e        # playwright e2e (local)
```



## Deploy (Cloudflare Workers)

```bash
npm run deploy:staging   # astro build && wrangler deploy --env staging
npm run deploy:prod      # astro build && wrangler deploy
```

Bindings (KV namespace, Durable Object) and non-secret vars live in
`wrangler.toml`.

### Environments & multi-account deploys (handoff)

KV namespace `id`s are **Cloudflare-account-scoped** — an id from one account
doesn't exist in another, and deploying it elsewhere fails with
`KV namespace '<id>' not found [code: 10041]`. Rather than rewrite the file per
deploy, each account gets its **own named environment** in `wrangler.toml`, so
the one committed file is the source of truth for all of them:

| Env | Command | Account / worker | KV id |
| --- | --- | --- | --- |
| base | `wrangler deploy` | Divinci · `drfuhrman-ai-landing` | Divinci |
| staging | `wrangler deploy --env staging` | Divinci · `…-staging` | Divinci |
| production | `wrangler deploy --env production` | **DrFuhrman** · `drfuhrman-ai-landing` | DrFuhrman |

Each `wrangler deploy --env <x>` reads only that env's block and deploys to
whatever account it's authenticated against, so there's **nothing to edit before
a deploy** — a CI job (or a repo-to-repo sync) just runs the right
`--env`. Divinci owns base + staging; the DrFuhrman team owns production.

**One-time setup for a new account's environment** (e.g. the DrFuhrman
production env — do this once, then never touch the file again):

1. Create that account's KV namespace (logged into it via `wrangler login`):
   ```bash
   wrangler kv namespace create EMAIL_QUOTA --env production
   ```
2. Paste the printed `id` into the `[[env.production.kv_namespaces]]` block.
3. Set its secrets — at minimum `LANDING_PAGE_HMAC_KEY`:
   ```bash
   wrangler secret put LANDING_PAGE_HMAC_KEY --env production
   ```
4. The Durable Object (`EmailQuotaCoordinator`) is auto-created by the
   `[[migrations]]` block on first deploy — nothing to pre-create.

**Divinci-API-side coordination** (ask the Divinci team) — the chat won't work
end-to-end until `LANDING_PAGE_HMAC_KEY` **matches** the value the API verifies
for that env's `DIVINCI_RELEASE_ID` (else `403 landing_page_sig_invalid`), and
the Release permits anonymous chat. No CORS / origin allowlisting is needed —
the Worker calls the API server-to-server with no `Origin` header, so any domain
works out of the box.

### Secrets

These are **not** stored in the repo. Set them per environment with
`wrangler secret put <NAME>` (the worker boots without them and degrades
gracefully — see the header comment in `src/worker.ts`):

| Secret | Purpose |
| --- | --- |
| `RESEND_API_KEY` | **Dormant** — Resend key for magic-link verification emails. Not set on staging or prod, so verification emails are OFF (the code guards on it and no-ops). Slated for replacement by the Divinci platform's free-chat gate (Cloudflare Email Service) — see `src/worker-v2.ts` header. |
| `VERIFY_TOKEN_SECRET` | HMAC key for signing email-verification tokens (`openssl rand -hex 32`). |
| `LANDING_PAGE_HMAC_KEY` | Shared HMAC key for signing upstream chat API calls. Also goes in `.dev.vars` for local chat. |
| `VERIFY_EMAIL_FROM` / `VERIFY_EMAIL_FROM_NAME` | Optional sender identity for verification emails. |
| `PUBLIC_BASE_URL` | Public origin used to build verification links. |
| `ADMIN_RESET_TOKEN` | Bearer token for `POST /api/admin/reset-quota` (support tooling). Unset = endpoint disabled (404). |

### The `LANDING_PAGE_HMAC_KEY` (generating + placing it)

This is the **single most important secret** — without a matching value the
Divinci API rejects every chat with `403 landing_page_sig_invalid`. It's a
**shared secret**: the Worker signs each upstream call with it, and the Divinci
API verifies the signature with the *same* value for that release. Both sides
must hold the **identical string**.

**It is shared, not per-deployment.** A new customer/environment does **not**
generate its own key — you use the value the Divinci team already configured for
the API environment you point at (`DIVINCI_API_BASE`). Generating a fresh one is
only for **standing up a new API environment or rotating** the existing key, and
must be done in lockstep on both sides.

1. **Generate** (only when creating/rotating the shared key — 32 random bytes as
   hex):
   ```bash
   openssl rand -hex 32
   ```
2. **Place it on the Divinci API side** (Divinci team) — store that value in the
   API's secret manager (Infisical) as `LANDING_PAGE_HMAC_KEY` for the matching
   environment, so the API verifies against it.
3. **Place it on the Worker side** (this repo) — as a Wrangler secret per
   environment, and in `.dev.vars` for local dev:
   ```bash
   wrangler secret put LANDING_PAGE_HMAC_KEY --env production   # (and --env staging)
   echo 'LANDING_PAGE_HMAC_KEY=<same value>' >> .dev.vars       # local only, gitignored
   ```

If you're a customer standing up your own environment, **ask the Divinci team
for the value** for the API you're pointing at — don't invent one.

### Resetting a free-message quota

Each visitor gets one free manual message (plus a small starter budget), keyed
by a hash of their email in KV + a Durable Object. To clear a specific email's
quota (e.g. for testing), `POST /api/admin/reset-quota` with the bearer token.
The route sits **before** the Basic-Auth gate, so it needs only the token:

```bash
TOKEN=$(cat .admin-reset-token)   # the token value, also set via `wrangler secret put ADMIN_RESET_TOKEN`
# staging
curl -X POST https://drfuhrman-ai-landing-staging.divinci-ai.workers.dev/api/admin/reset-quota \
  -H "Authorization: Bearer $TOKEN" -d '{"email":"you@example.com"}'
# production
curl -X POST https://drfuhrman-ai-landing.divinci-ai.workers.dev/api/admin/reset-quota \
  -H "Authorization: Bearer $TOKEN" -d '{"email":"you@example.com"}'
```

Set the token per env with `wrangler secret put ADMIN_RESET_TOKEN`
(staging: `--env staging`). Note `wrangler secret put` keeps a trailing
newline if piped via `< file`; pipe with `printf %s "$(cat file)" | wrangler …`
to avoid a token mismatch.

## Project layout

```
src/
  worker.ts            Cloudflare Worker entry (quota API, asset passthrough)
  quota-coordinator.ts Durable Object: per-email free-message quota
  components/          Astro sections + React chat island
  i18n/                Locale strings + tokenizer
  lib/                 Email normalization, HMAC, verify-token, Resend client
tests/                 Playwright e2e specs
```
