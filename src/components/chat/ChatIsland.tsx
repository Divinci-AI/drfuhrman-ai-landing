import { useCallback, useEffect, useRef, useState } from "react";
import { FREE_MESSAGE_QUOTA, getDivinci } from "../../lib/divinci";
import { loadEscrow, saveEscrow } from "../../lib/escrow";
import { WelcomeMessage } from "./WelcomeMessage";
import { ConversationStarters } from "./ConversationStarters";
import { Transcript, type TranscriptMessage } from "./Transcript";
import { MessageInput } from "./MessageInput";
import { StickyChatBar } from "./StickyChatBar";
import { SignupCTA } from "./SignupCTA";

import { isDisposableEmail } from "../../lib/disposable-emails";
import { getLocaleMeta, DEFAULT_LOCALE } from "../../i18n/locales";
import { getUI } from "../../i18n";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A disposable email is NOT valid for the gate — keeps the email gate
// open and shows the inline error from MessageInput's disposable watcher.
const isValidEmail = (e: string | null) =>
  !!e && EMAIL_RE.test(e.trim()) && !isDisposableEmail(e.trim());

interface ChatIslandProps {
  /** Active page locale (BCP-47). Drives the chat's response language. */
  lang?: string;
}

export function ChatIsland({ lang = DEFAULT_LOCALE }: ChatIslandProps) {
  // Localized chat strings for the current page locale — so the chat's
  // greeting, starters, gate form, and errors switch with the page.
  const t = getUI(lang).chat;
  const divinciRef = useRef(getDivinci());
  // The language we ask the assistant to respond in. English is the
  // default and needs no instruction (the model already answers in the
  // user's language); for any other page locale we pass the English
  // language name, which the server turns into a "respond in X"
  // system instruction so the chat matches the page.
  const chatLanguage =
    lang && lang !== DEFAULT_LOCALE ? getLocaleMeta(lang).englishName : null;

  // Escrow (email / transcriptId) is read from localStorage AFTER mount, not
  // during render. Reading it inline would make the first client render differ
  // from the server-rendered HTML and trip a hydration mismatch (React #418).
  const [email, setEmail] = useState("");
  // Chat opener (welcome + starters) renders from the localized `chat`
  // dict above (t.welcomeMessage / t.starters) so it switches with the
  // page locale. STOPGAP: once the Divinci Release-config endpoint
  // (/api/v1/whitelabel-releases/{id}) is reachable, the opener should
  // come from localized release content server-side — see the note in
  // src/lib/divinci.ts (FALLBACK_RELEASE) and src/i18n/ui/en.ts (chat).
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  // Server-managed welcome (translated) for this locale, fetched at mount.
  // Null until/unless it arrives, so we fall back to the localized dict
  // welcome (t.welcomeMessage) — resilient if the release has no welcome
  // configured or the upstream is unavailable.
  const [serverWelcome, setServerWelcome] = useState<string | null>(null);
  const [transcriptId, setTranscriptId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatStarted, setChatStarted] = useState(false);
  const [draft, setDraft] = useState("");
  const [focusSignal, setFocusSignal] = useState(0);

  const handleSendRef = useRef<(text: string) => void>(() => {});

  // Hydrate email + transcriptId from escrow once, on the client only (see
  // the note on the email state above).
  useEffect(() => {
    const esc = loadEscrow();
    if (esc.email) setEmail(esc.email);
    if (esc.transcriptId) setTranscriptId(esc.transcriptId);
  }, []);

  // Fetch the server-side welcome for this locale (worker proxies it to the
  // platform's release welcome, translated). Safe text()+JSON.parse per
  // the repo convention; any failure leaves serverWelcome null → dict
  // fallback. chatLanguage is the English name for non-English locales.
  useEffect(() => {
    let cancelled = false;
    const qs = chatLanguage ? `?language=${encodeURIComponent(chatLanguage)}` : "";
    fetch(`/api/welcome${qs}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((txt) => {
        if (cancelled) return;
        const data = JSON.parse(txt) as { messages?: Array<{ message?: string }> };
        const first = data.messages?.[0]?.message?.trim();
        if (first) setServerWelcome(first);
      })
      .catch(() => {
        /* keep the localized dict welcome */
      });
    return () => {
      cancelled = true;
    };
  }, [chatLanguage]);

  useEffect(() => {
    if (!chatStarted) return;
    const bg = document.getElementById("hero-bg");
    if (bg) bg.classList.add("opacity-10");
  }, [chatStarted]);

  const handleSend = useCallback(
    async (rawContent: string) => {
      const content = rawContent.trim();
      if (!content) return;
      if (!isValidEmail(email)) {
        setError(t.errorEmailRequired);
        return;
      }
      // Quota gate — anonymous visitors get FREE_MESSAGE_QUOTA messages.
      const userMessagesSoFar = messages.filter((m) => m.role === "user").length;
      if (userMessagesSoFar >= FREE_MESSAGE_QUOTA) return;
      if (pending) return;
      setError(null);

      const userMsg: TranscriptMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
      };
      const assistantPlaceholder: TranscriptMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        pending: true,
      };
      setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
      setPending(true);
      setChatStarted(true);
      saveEscrow({ email: email.trim() });
      // v1: real email-capture endpoint is a Phase 8 follow-up. PII rule
      // from CLAUDE.md — log metadata only, never the raw email.
      const trimmedEmail = email.trim();
      const atIdx = trimmedEmail.lastIndexOf("@");
      console.info("[DrFurman.ai] email captured (v1 stub)", {
        hasEmail: true,
        emailDomain: atIdx > 0 ? trimmedEmail.slice(atIdx + 1) : "unknown",
      });

      try {
        // /api/chat-send is the quota-gated proxy to Divinci's stateless
        // anonymous-chat endpoint. Returns { transcript, signiture } or
        // 402 if this email already used its free message.
        const resp = await fetch("/api/chat-send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            newPrompt: content,
            // When the page is in a non-English locale, ask the
            // assistant to answer in that language. Omitted for English.
            ...(chatLanguage ? { language: chatLanguage } : {}),
          }),
        });

        if (resp.status === 402) {
          // Quota exhausted — clear placeholder, mark transcript so the
          // existing quotaExhausted derivation flips to SignupCTA.
          setMessages((prev) =>
            prev.filter((m) => m.id !== assistantPlaceholder.id),
          );
          setError(null);
          setTranscriptId("__quota__");
          saveEscrow({ transcriptId: "__quota__" });
          return;
        }

        if (!resp.ok) {
          throw new Error(`chat-send failed: ${resp.status}`);
        }

        const data = (await resp.json()) as {
          transcript?: Array<{ prompt?: string; response?: string }>;
        };
        const lastMsg = data.transcript?.[data.transcript.length - 1];
        const reply = lastMsg?.response ?? "(no response)";

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantPlaceholder.id
              ? { ...m, content: reply, pending: false }
              : m,
          ),
        );
      } catch (err) {
        console.error("[ChatIsland] send failed", err);
        // The server never recorded a successful chat (the worker quota
        // was never burned). Remove BOTH the user message and the
        // assistant placeholder so the SignupCTA doesn't fire prematurely
        // and the user can retry. The error toast is enough feedback.
        setMessages((prev) =>
          prev.filter(
            (m) => m.id !== assistantPlaceholder.id && m.id !== userMsg.id,
          ),
        );
        setError(t.errorNetwork);
      } finally {
        setPending(false);
      }
    },
    [email, pending, transcriptId, messages],
  );

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  // Example-card clicks dispatch drfuhrman:populateInput — pre-fill the
  // draft and focus the textarea instead of auto-sending. The user then
  // hits Enter to send (which gives them a chance to edit first).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ text?: string }>).detail;
      if (!detail?.text) return;
      setDraft(detail.text);
      setFocusSignal((n) => n + 1);
    };
    window.addEventListener("drfuhrman:populateInput", handler);
    return () =>
      window.removeEventListener("drfuhrman:populateInput", handler);
  }, []);

  const showStarters = messages.length === 0;
  const emailRequired = !isValidEmail(email);
  const userMessageCount = messages.filter((m) => m.role === "user").length;
  const quotaExhausted = userMessageCount >= FREE_MESSAGE_QUOTA && !pending;

  return (
    <>
    <div className="flex flex-col gap-5">
      {showStarters && (
        <>
          <WelcomeMessage text={serverWelcome ?? t.welcomeMessage} />
          <ConversationStarters
            label={t.tryAsking}
            starters={t.starters}
            disabled={pending}
            onSelect={(text) => {
              // Populate the input + focus the textarea — same UX as
              // the lower example cards. User reviews + presses Enter
              // to send. Avoids the previous "starter click silently
              // fails when email gate is open" trap.
              setDraft(text);
              setFocusSignal((n) => n + 1);
            }}
          />
        </>
      )}
      {messages.length > 0 && <Transcript messages={messages} />}
      {quotaExhausted ? (
        <SignupCTA lang={lang} />
      ) : (
        <MessageInput
          lang={lang}
          email={email}
          onEmailChange={setEmail}
          emailRequired={emailRequired}
          draft={draft}
          onDraftChange={setDraft}
          focusSignal={focusSignal}
          onSend={handleSend}
          pending={pending}
        />
      )}
      {/* Disclaimer with intentional line breaks so it wraps gracefully on
          narrow screens instead of orphaning a single word. text-balance
          evens out any line that still wraps. */}
      <p className="text-balance text-center text-xs leading-relaxed text-gray-500">
        {t.disclaimer[0]} {t.disclaimer[1]}
        <br />
        {t.disclaimer[2]}
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
    {/* Sticky composer — shares this island's state (email/draft/quota) and
        send handler, so a question typed at the bottom of the page flows
        through the same gated /api/chat-send path as the hero panel. It
        reveals itself once the hero scrolls out of view. */}
    <StickyChatBar
      lang={lang}
      emailRequired={emailRequired}
      draft={draft}
      onDraftChange={setDraft}
      onSend={handleSend}
      pending={pending}
      quotaExhausted={quotaExhausted}
    />
    </>
  );
}
