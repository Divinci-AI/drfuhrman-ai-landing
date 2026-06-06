import { useEffect, useRef, useState, type ReactNode } from "react";

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  /**
   * True for a user message that came from a conversation-starter pill.
   * Starter sends draw on a separate budget and don't count toward the
   * single free manual message, so the quota math excludes them.
   */
  isStarter?: boolean;
  /**
   * Deduped retrieved-source filenames (from the response's `context`
   * metadata.originalName) — rendered as chips above the assistant reply,
   * mirroring the static TranscriptShowcase.
   */
  sources?: string[];
}

export interface TranscriptFeedbackInput {
  sentiment?: -1 | 1;
  feedback?: string;
}

interface TranscriptProps {
  messages: TranscriptMessage[];
  /** Submit thumbs/feedback for the assistant reply at the given exchange index. */
  onFeedback?: (messageIndex: number, input: TranscriptFeedbackInput) => Promise<void>;
}

export function Transcript({ messages, onFeedback }: TranscriptProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // Map each completed assistant reply to its index in the signed anonymous
  // transcript (one entry per exchange) for feedback submission.
  const exchangeIndexById = new Map<string, number>();
  let seq = 0;
  for (const m of messages) {
    if (m.role === "assistant" && !m.pending && m.content) {
      exchangeIndexById.set(m.id, seq++);
    }
  }

  return (
    <div
      className="df-chat-scroll flex max-h-[26rem] flex-col gap-5 overflow-y-auto px-1 md:max-h-[32rem]"
      role="log"
      aria-live="polite"
    >
      {messages.map((m) =>
        m.role === "user" ? (
          <UserBubble key={m.id} content={m.content} />
        ) : (
          <AssistantTurn
            key={m.id}
            content={m.content}
            pending={m.pending}
            sources={m.sources}
            messageIndex={exchangeIndexById.get(m.id)}
            onFeedback={onFeedback}
          />
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}

function DfAvatar() {
  return (
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-df-green-leaf/20 ring-1 ring-df-green-dark/15">
      <img
        src="/drfuhrman-logo.svg"
        alt=""
        aria-hidden="true"
        className="h-4 w-4"
        width={16}
        height={16}
      />
    </span>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[88%] rounded-2xl rounded-br-sm bg-df-green-dark px-4 py-2.5 text-left text-sm font-medium text-white md:text-base">
        {content}
      </p>
    </div>
  );
}

function AssistantTurn({
  content,
  pending,
  sources,
  messageIndex,
  onFeedback,
}: {
  content: string;
  pending?: boolean;
  sources?: string[];
  messageIndex?: number;
  onFeedback?: (messageIndex: number, input: TranscriptFeedbackInput) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {sources && sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-9">
          {sources.map((s) => (
            <span
              key={s}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-df-green-dark/15 bg-white/80 px-2 py-1 text-xs text-gray-600"
            >
              <span aria-hidden="true">{sourceIcon(s)}</span>
              <span className="truncate">{s}</span>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-start gap-2">
        <DfAvatar />
        <div className="max-w-[88%] space-y-2 rounded-2xl rounded-tl-sm bg-df-green-leaf/15 px-4 py-3 text-sm leading-relaxed text-df-text shadow-sm md:text-base">
          {content ? (
            renderRichText(content)
          ) : pending ? (
            <ThinkingDots />
          ) : null}
          {pending && content && <BlinkingCursor />}
        </div>
      </div>
      {content && !pending && onFeedback && messageIndex !== undefined && (
        <MessageRating messageIndex={messageIndex} onFeedback={onFeedback} />
      )}
    </div>
  );
}

function MessageRating({
  messageIndex,
  onFeedback,
}: {
  messageIndex: number;
  onFeedback: (messageIndex: number, input: TranscriptFeedbackInput) => Promise<void>;
}) {
  const [vote, setVote] = useState<-1 | 1 | 0>(0);
  const [showBox, setShowBox] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return <p className="pl-9 text-xs text-gray-500">Thanks for your feedback 🙏</p>;
  }

  const thumb = (on: boolean) =>
    `rounded-md border px-1.5 py-0.5 text-sm transition ${
      on
        ? "border-df-green-dark bg-df-green-dark text-white"
        : "border-df-green-dark/20 bg-white/70 text-gray-600 hover:border-df-green-dark/40"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-9">
      <button
        type="button"
        aria-label="Helpful"
        className={thumb(vote === 1)}
        onClick={() => {
          // Positive votes are a server-side no-op for anonymous chat
          // (negative-only); this is a local acknowledgement.
          setVote(1);
          setShowBox(false);
        }}
      >
        👍
      </button>
      <button
        type="button"
        aria-label="Not helpful"
        className={thumb(vote === -1)}
        onClick={() => {
          setVote(-1);
          setShowBox(true);
        }}
      >
        👎
      </button>
      {showBox && (
        <form
          className="mt-1 flex w-full flex-col gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (submitting) return;
            setSubmitting(true);
            try {
              await onFeedback(messageIndex, {
                sentiment: -1,
                feedback: text.trim() || undefined,
              });
              setDone(true);
            } catch {
              setSubmitting(false);
            }
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="What was wrong? (optional)"
            className="w-full rounded-lg border border-df-green-dark/15 bg-white px-3 py-2 text-sm text-df-text focus:border-df-green-dark/40 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-df-green-dark px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Send feedback"}
            </button>
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700"
              onClick={() => setShowBox(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function sourceIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "txt") return "📑";
  if (ext === "html" || ext === "htm") return "🌐";
  return "📄";
}

// Lightweight inline formatter — mirrors the static showcase's mini-syntax
// so the live reply renders **bold** / *italic* instead of raw asterisks,
// split into paragraphs on blank lines. Deliberately small (no markdown
// dependency); anything it doesn't recognise renders as plain text.
function renderRichText(text: string): ReactNode {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.map((para, i) => <p key={i}>{renderInline(para)}</p>);
}

function renderInline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(
        <strong key={key++} className="font-semibold">
          {m[1]}
        </strong>,
      );
    } else if (m[2] !== undefined) {
      out.push(<em key={key++}>{m[2]}</em>);
    }
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function ThinkingDots() {
  return (
    <span className="inline-flex gap-1" aria-label="Thinking">
      <span className="h-2 w-2 animate-pulse rounded-full bg-df-green-dark/40 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-pulse rounded-full bg-df-green-dark/40 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-pulse rounded-full bg-df-green-dark/40" />
    </span>
  );
}

function BlinkingCursor() {
  return (
    <span
      className="ml-0.5 inline-block h-4 w-px animate-pulse bg-df-text/60 align-middle"
      aria-hidden="true"
    />
  );
}
