/**
 * Shared client for the quota-gated chat endpoints (`/api/chat-send`,
 * `/api/terms-accept`). Both the hero ChatIsland and the in-place showcase
 * chat post the same rolling signed-transcript contract; this module owns the
 * network call + response parsing so the two surfaces stay in lockstep.
 *
 * NOTE: these endpoints are served by the worker, not the static Astro build —
 * they return nothing under plain `astro dev`. Verify end-to-end under
 * `wrangler dev` or a deployed preview.
 */

/** A single signed exchange as returned by the upstream anonymous-chat API. */
export interface AnonExchange {
  prompt?: string;
  response?: string;
  context?: Array<{ metadata?: { originalName?: string } }>;
  safetyAdvisory?: {
    severity: "review" | "severe";
    text: string;
    categories?: string[];
  };
}

export interface ChatSendParams {
  email: string;
  newPrompt: string;
  /** Rolling signed conversation (empty on the first turn). */
  transcript: unknown[];
  prevSigniture: string;
  sessionId: string;
  /** English language name for non-English locales; omit for English. */
  language?: string | null;
  /** Starter sends draw on a separate budget. */
  starter?: boolean;
}

export type ChatSendResult =
  | {
      kind: "ok";
      transcript: AnonExchange[];
      signiture: string;
      reply: string;
      sources: string[];
      safetyAdvisory?: AnonExchange["safetyAdvisory"];
    }
  | { kind: "quota" }
  | {
      kind: "tos";
      tosId: string;
      version: number;
      title: string;
      content: string;
    }
  | { kind: "error" };

/** POST a chat message. Never throws — failures resolve to `{ kind: "error" }`. */
export async function postChatMessage(
  params: ChatSendParams,
): Promise<ChatSendResult> {
  try {
    const resp = await fetch("/api/chat-send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: params.email.trim(),
        newPrompt: params.newPrompt,
        transcript: params.transcript,
        prevSigniture: params.prevSigniture ?? "",
        sessionId: params.sessionId,
        ...(params.starter ? { starter: true } : {}),
        ...(params.language ? { language: params.language } : {}),
      }),
    });

    if (resp.status === 402) return { kind: "quota" };

    if (resp.status === 403) {
      const gate = (await resp.json().catch(() => null)) as {
        error?: {
          code?: string;
          details?: {
            tosId?: string;
            version?: number;
            title?: string;
            content?: string;
          };
        };
      } | null;
      const d = gate?.error?.details;
      if (
        gate?.error?.code === "TERMS_NOT_ACCEPTED" &&
        d?.tosId &&
        typeof d.version === "number"
      ) {
        return {
          kind: "tos",
          tosId: d.tosId,
          version: d.version,
          title: d.title || "Terms of Service",
          content: d.content || "",
        };
      }
      return { kind: "error" };
    }

    if (!resp.ok) return { kind: "error" };

    const data = (await resp.json()) as {
      transcript?: AnonExchange[];
      signiture?: string;
    };
    const transcript = Array.isArray(data.transcript) ? data.transcript : [];
    const last = transcript[transcript.length - 1];
    const reply = last?.response ?? "(no response)";
    // One source per retrieved context item, IN ORDER and NOT deduped — the
    // model's inline `[n]` citations are 1-based indices into this list.
    const sources = (last?.context ?? []).map(
      (c) => c.metadata?.originalName || "Dr. Fuhrman's corpus",
    );
    const safetyAdvisory =
      last?.safetyAdvisory && typeof last.safetyAdvisory.text === "string"
        ? last.safetyAdvisory
        : undefined;

    return {
      kind: "ok",
      transcript,
      signiture: typeof data.signiture === "string" ? data.signiture : "",
      reply,
      sources,
      safetyAdvisory,
    };
  } catch {
    return { kind: "error" };
  }
}

export type TermsAcceptResult = "ok" | "conflict" | "error";

/** Record acceptance of a gated Terms-of-Service version. */
export async function acceptTerms(params: {
  tosId: string;
  version: number;
  sessionId: string;
}): Promise<TermsAcceptResult> {
  try {
    const resp = await fetch("/api/terms-accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (resp.ok) return "ok";
    return resp.status === 409 ? "conflict" : "error";
  } catch {
    return "error";
  }
}
