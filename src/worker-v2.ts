/**
 * DrFurman.ai landing-page worker — P7 cutover version.
 *
 * Replaces the v42a bespoke implementation (quota-coordinator DO +
 * verify-token + resend-send + normalize-email + verify-email-templates +
 * upstream-hmac) with thin proxies to the Divinci platform's Free-Chat
 * Gate endpoints. The release is configured server-side with
 * `freeChatGate.mode = "captcha+magic-link"`; the platform handles
 * Turnstile + email sending + DKIM + the entire quota engine.
 *
 * One responsibility left on the worker:
 *
 *   1. Three pass-throughs (no auth gate):
 *        POST /api/chat-start  → upstream POST /ai-chat/free-chat-gate/start
 *        POST /api/chat-send   → upstream POST /ai-chat/free-chat-gate/chat-send
 *        GET  /api/verify-email → 302 to upstream GET /ai-chat/free-chat-gate/verify
 *
 *      Each proxy is a single fetch() with the body shape the upstream
 *      expects. No state, no PII, no quota math. The upstream's
 *      `freeChatGate.brand` Release config drives the email template
 *      branding ("DrFurman.ai" from-name, etc).
 *
 *   2. Everything else → static-asset pass-through (Astro build).
 *
 * Deleted libs (now in the platform):
 *   - quota-coordinator.ts      → server-resources/globals/free-chat-gate/email-quota.ts
 *   - verify-token.ts           → server-resources/globals/free-chat-gate/token.ts
 *   - resend-send.ts            → server-resources/globals/email/providers/resend.ts
 *   - verify-email-templates.ts → platform's hosted verification email
 *   - normalize-email.ts        → server-resources/globals/free-chat-gate/normalize-email.ts
 *   - upstream-hmac.ts          → no longer needed (platform-level enforcement
 *                                 closes weakness (c) without the HMAC handoff)
 *   - cf-email-send.ts          → already deleted in v42a
 *
 * Deleted wrangler bindings:
 *   - EMAIL_QUOTA (KV)          → platform Redis
 *   - QUOTA_DO (DO + migration) → platform Redis
 *
 * The previously-required CF_EMAIL_API_TOKEN, CF_ACCOUNT_ID,
 * VERIFY_TOKEN_SECRET, and RESEND_API_KEY all move to the platform's
 * Infisical and are no longer needed in wrangler.
 */

interface Env {
  ASSETS: Fetcher;
  DIVINCI_API_BASE: string;
  DIVINCI_RELEASE_ID: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat-start" && request.method === "POST") {
      return proxyStart(request, env);
    }
    if (url.pathname === "/api/chat-send" && request.method === "POST") {
      return proxyChatSend(request, env);
    }
    if (url.pathname === "/api/verify-email" && request.method === "GET") {
      return proxyVerifyLink(url, env);
    }

    return env.ASSETS.fetch(request);
  },
};

// ── /api/chat-start ─────────────────────────────────────────────────────
// Proxies to the platform's /start. Body shape mirrors the
// FreeChatGateStartArgs the SDK uses (releaseId is server-pinned here
// for the DrFurman release; visitors don't get to pick).

async function proxyStart(request: Request, env: Env): Promise<Response> {
  const reqBody = await request.text();
  let parsed: { email?: unknown; turnstileToken?: unknown };
  try {
    parsed = JSON.parse(reqBody) as { email?: unknown; turnstileToken?: unknown };
  } catch {
    return json(400, { error: "invalid_json" });
  }
  return forwardJsonToUpstream(
    env,
    "/ai-chat/free-chat-gate/start",
    {
      releaseId: env.DIVINCI_RELEASE_ID,
      email: parsed.email,
      turnstileToken: parsed.turnstileToken,
      // Where the magic-link click redirects the visitor back to.
      // The platform validates this against the Release's
      // testingDomains allow-list before honoring it.
      redirectTo: new URL("/verified", request.url).toString(),
    },
    request,
  );
}

// ── /api/chat-send ──────────────────────────────────────────────────────
// Proxies to the platform's /chat-send. The visitor's verified token
// rides in the body — the platform's chat-send handler pulls
// releaseId out of the SIGNED token, not from the body, so we don't
// need to thread anything else.

async function proxyChatSend(
  request: Request,
  env: Env,
): Promise<Response> {
  const reqBody = await request.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(reqBody) as Record<string, unknown>;
  } catch {
    return json(400, { error: "invalid_json" });
  }
  return forwardJsonToUpstream(
    env,
    "/ai-chat/free-chat-gate/chat-send",
    parsed,
    request,
  );
}

// ── /api/verify-email ───────────────────────────────────────────────────
// Magic-link landing. The email contains a link to THIS endpoint with
// the platform-signed token in `?token=...`. We just redirect to the
// platform's /verify endpoint which validates + 302s the visitor to
// the consumer success page.

function proxyVerifyLink(url: URL, env: Env): Response {
  const token = url.searchParams.get("token") ?? "";
  if (!token) {
    return new Response("Missing token.", { status: 400 });
  }
  const target = new URL(
    `${env.DIVINCI_API_BASE.replace(/\/+$/, "")}/ai-chat/free-chat-gate/verify`,
  );
  target.searchParams.set("token", token);
  // Tell the platform where to drop the visitor after verification.
  target.searchParams.set("redirectTo", new URL("/verified", url).toString());
  return Response.redirect(target.toString(), 302);
}

// ── helpers ─────────────────────────────────────────────────────────────

async function forwardJsonToUpstream(
  env: Env,
  upstreamPath: string,
  body: unknown,
  inboundRequest: Request,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(
      `${env.DIVINCI_API_BASE.replace(/\/+$/, "")}${upstreamPath}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // The platform's CORS allowlist accepts the worker origin.
          Origin: new URL(inboundRequest.url).origin,
          // Pass through CF-Connecting-IP so the upstream's per-device
          // backstop counts each visitor distinctly even though we're
          // a single proxy.
          ...(inboundRequest.headers.get("cf-connecting-ip")
            ? { "CF-Connecting-IP": inboundRequest.headers.get("cf-connecting-ip")! }
            : {}),
        },
        body: JSON.stringify(body),
      },
    );
  } catch (err) {
    console.error("[drfurman-proxy] upstream_fetch_failed", {
      path: upstreamPath,
      message: err instanceof Error ? err.message : String(err),
    });
    return json(502, { error: "upstream_unreachable" });
  }

  // Pass the upstream's status + body through verbatim — the platform
  // already returns the right shape for the SDK + embed-client to
  // consume.
  const upstreamText = await upstream.text();
  return new Response(upstreamText, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("Content-Type") ?? "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
