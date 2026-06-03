# drfuhrman.ai — landing page

Marketing landing page for **DrFuhrman.ai** with an embedded AI chat island.
Built with [Astro](https://astro.build) + React islands and deployed to
**Cloudflare Workers** (Static Assets + a small API worker).

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

```bash
npm install
npm run dev        # astro dev server
```

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

The deployed-target e2e suite expects the preview Basic-Auth credentials to be
supplied via environment variables — they are intentionally **not** committed:

```bash
E2E_BASIC_AUTH_USER=... E2E_BASIC_AUTH_PASS=... npm run test:e2e:deployed
```

## Deploy (Cloudflare Workers)

```bash
npm run deploy:staging   # astro build && wrangler deploy --env staging
npm run deploy:prod      # astro build && wrangler deploy
```

Bindings (KV namespace, Durable Object) and non-secret vars live in
`wrangler.toml`.

### Secrets

These are **not** stored in the repo. Set them per environment with
`wrangler secret put <NAME>` (the worker boots without them and degrades
gracefully — see the header comment in `src/worker.ts`):

| Secret | Purpose |
| --- | --- |
| `BASIC_AUTH_PASSWORD` | Gates the preview/staging build. Unset = gate disabled. |
| `BASIC_AUTH_USERNAME` | Optional; defaults to `dfo`. |
| `RESEND_API_KEY` | Resend API key for magic-link verification emails. |
| `VERIFY_TOKEN_SECRET` | HMAC key for signing email-verification tokens (`openssl rand -hex 32`). |
| `LANDING_PAGE_HMAC_KEY` | Shared HMAC key for signing upstream chat API calls. |
| `VERIFY_EMAIL_FROM` / `VERIFY_EMAIL_FROM_NAME` | Optional sender identity for verification emails. |
| `PUBLIC_BASE_URL` | Public origin used to build verification links. |

## Project layout

```
src/
  worker.ts            Cloudflare Worker entry (auth gate, quota API, asset passthrough)
  quota-coordinator.ts Durable Object: per-email free-message quota
  components/          Astro sections + React chat island
  i18n/                Locale strings + tokenizer
  lib/                 Email normalization, HMAC, verify-token, Resend client
tests/                 Playwright e2e specs
```
