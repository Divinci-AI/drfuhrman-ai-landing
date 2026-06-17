import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FREE_MESSAGE_QUOTA } from "../../lib/divinci";
import { loadEscrow, saveEscrow } from "../../lib/escrow";
import { Transcript, type TranscriptMessage } from "./Transcript";
import { MessageInput } from "./MessageInput";
import { SignupCTA } from "./SignupCTA";
import { TermsModal } from "./TermsModal";
import { postChatMessage, acceptTerms } from "../../lib/chat-send";
import { isDisposableEmail } from "../../lib/disposable-emails";
import { getLocaleMeta, DEFAULT_LOCALE } from "../../i18n/locales";
import { getUI } from "../../i18n";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (e: string | null) =>
  !!e && EMAIL_RE.test(e.trim()) && !isDisposableEmail(e.trim());

interface ShowcaseChatProps {
  lang?: string;
  /** The static example transcript, shown until the visitor sends. */
  children?: ReactNode;
}

interface TosGate {
  tosId: string;
  version: number;
  title: string;
  content: string;
  retry: { content: string; starter?: boolean };
}

/**
 * In-place chat for the example/showcase section. The static example
 * messages (passed as children) are a demo only — the moment the visitor
 * sends, they're replaced by a FRESH live conversation (empty transcript,
 * its own session), so the example chat is never part of what's sent.
 *
 * Shares the hero's send/quota/ToS contract via lib/chat-send, and reuses
 * MessageInput (email gate in place), Transcript, SignupCTA and TermsModal.
 * The free-message quota is per-email and server-enforced, so a visitor who
 * already spent it in the hero gets the sign-up CTA here too.
 */
export function ShowcaseChat({
  lang = DEFAULT_LOCALE,
  children,
}: ShowcaseChatProps) {
  const t = getUI(lang).chat;
  const chatLanguage =
    lang && lang !== DEFAULT_LOCALE ? getLocaleMeta(lang).englishName : null;

  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusSignal] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [tosGate, setTosGate] = useState<TosGate | null>(null);
  const [tosBusy, setTosBusy] = useState(false);
  const [tosError, setTosError] = useState<string | null>(null);

  // Rolling signed transcript for THIS conversation — starts empty (fresh).
  const anonRef = useRef<unknown[]>([]);
  const sigRef = useRef<string>("");
  // Own session id (not the hero's) so this is a distinct, fresh transcript.
  const sessionIdRef = useRef<string | null>(null);
  const ensureSessionId = useCallback((): string => {
    if (!sessionIdRef.current) {
      sessionIdRef.current =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `s_${Math.random().toString(36).slice(2)}`;
    }
    return sessionIdRef.current;
  }, []);

  // Prefill the email from escrow (shared with the hero) so a visitor who
  // already entered it doesn't have to retype — but keep a fresh transcript.
  useEffect(() => {
    const esc = loadEscrow();
    if (esc.email) setEmail(esc.email);
  }, []);

  // Release avatar for the live reply bubbles.
  useEffect(() => {
    fetch("/api/release-meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { avatarUrl?: string | null } | null) => {
        if (d && typeof d.avatarUrl === "string") setAvatarUrl(d.avatarUrl);
      })
      .catch(() => {});
  }, []);

  const userMessageCount = messages.filter((m) => m.role === "user").length;
  const quotaExhausted = userMessageCount >= FREE_MESSAGE_QUOTA && !pending;
  const emailRequired = !isValidEmail(email);
  const started = messages.length > 0;
  const latestAdvisory = [...messages]
    .reverse()
    .find(
      (m) => m.role === "assistant" && !m.pending && m.content && m.safetyAdvisory,
    )?.safetyAdvisory;

  const send = useCallback(
    async (raw: string, opts?: { starter?: boolean }) => {
      const content = raw.trim();
      const isStarter = opts?.starter === true;
      if (!content || pending) return;
      if (!isValidEmail(email)) {
        setError(t.errorEmailRequired);
        return;
      }
      if (messages.filter((m) => m.role === "user").length >= FREE_MESSAGE_QUOTA) {
        return;
      }
      setError(null);

      const userMsg: TranscriptMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        isStarter,
      };
      const placeholder: TranscriptMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        pending: true,
      };
      setMessages((prev) => [...prev, userMsg, placeholder]);
      setPending(true);
      saveEscrow({ email: email.trim() });

      const res = await postChatMessage({
        email,
        newPrompt: content,
        transcript: anonRef.current,
        prevSigniture: sigRef.current,
        sessionId: ensureSessionId(),
        language: chatLanguage,
        starter: isStarter,
      });

      if (res.kind === "quota") {
        // Keep the user message so the quota derivation flips to SignupCTA.
        setMessages((prev) => prev.filter((m) => m.id !== placeholder.id));
        setPending(false);
        return;
      }
      if (res.kind === "tos") {
        setMessages((prev) =>
          prev.filter((m) => m.id !== placeholder.id && m.id !== userMsg.id),
        );
        setTosGate({
          tosId: res.tosId,
          version: res.version,
          title: res.title,
          content: res.content,
          retry: { content, starter: isStarter },
        });
        setPending(false);
        return;
      }
      if (res.kind === "error") {
        setMessages((prev) =>
          prev.filter((m) => m.id !== placeholder.id && m.id !== userMsg.id),
        );
        setError(t.errorNetwork);
        setPending(false);
        return;
      }

      anonRef.current = res.transcript;
      sigRef.current = res.signiture;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholder.id
            ? {
                ...m,
                content: res.reply,
                sources: res.sources,
                safetyAdvisory: res.safetyAdvisory,
                pending: false,
              }
            : m,
        ),
      );
      setPending(false);
    },
    [email, pending, messages, chatLanguage, ensureSessionId, t],
  );

  const acceptTos = useCallback(async () => {
    if (!tosGate || tosBusy) return;
    setTosBusy(true);
    setTosError(null);
    const r = await acceptTerms({
      tosId: tosGate.tosId,
      version: tosGate.version,
      sessionId: ensureSessionId(),
    });
    if (r === "ok") {
      const retry = tosGate.retry;
      setTosGate(null);
      send(retry.content, { starter: retry.starter });
    } else {
      setTosError(
        r === "conflict"
          ? "These terms were just updated — please close and try again to see the new version."
          : "Could not record your acceptance. Please try again.",
      );
    }
    setTosBusy(false);
  }, [tosGate, tosBusy, ensureSessionId, send]);

  return (
    <>
      {/* Body — the static example demo until the visitor sends, then their
          own fresh conversation. */}
      {started ? (
        <div className="df-chat-scroll max-h-[26rem] overflow-y-auto px-4 py-5 md:max-h-[32rem] md:px-6">
          <Transcript messages={messages} avatarUrl={avatarUrl} />
        </div>
      ) : (
        children
      )}

      {latestAdvisory && (
        <div className="px-4 pb-3 md:px-6">
          <div
            role="alert"
            data-testid="safety-advisory"
            className="ml-9 flex max-w-[88%] items-start gap-2 rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-gray-700 md:text-sm"
          >
            <span aria-hidden="true" className="mt-0.5">
              ⚕️
            </span>
            <span>{latestAdvisory.text}</span>
          </div>
        </div>
      )}

      {/* Composer — email gate in place; swaps to the sign-up CTA once the
          one free message is spent. */}
      <div className="border-t border-df-green-dark/10 bg-white/70 p-3 backdrop-blur-sm">
        {quotaExhausted ? (
          <SignupCTA lang={lang} />
        ) : (
          <MessageInput
            compact={started}
            lang={lang}
            email={email}
            onEmailChange={setEmail}
            emailRequired={emailRequired}
            draft={draft}
            onDraftChange={setDraft}
            focusSignal={focusSignal}
            onSend={send}
            pending={pending}
            textareaId="df-showcase-question"
            emailId="df-showcase-email"
            shiftRight={false}
          />
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      {tosGate && (
        <TermsModal
          title={tosGate.title}
          content={tosGate.content}
          busy={tosBusy}
          error={tosError}
          onAgree={acceptTos}
          onClose={() => {
            setTosGate(null);
            setTosError(null);
          }}
        />
      )}
    </>
  );
}
