import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";

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
  /**
   * Medical-safety advisory attached server-side when the release's
   * medicalSafety check flagged the reply (severity "severe" means the
   * server already rewrote the offending passage to a physician referral;
   * "review" means the LLM judge confirmed the topic warrants the notice).
   * Rendered as an amber banner under the reply bubble. The text comes
   * from the signed payload verbatim — never alter it client-side.
   */
  safetyAdvisory?: SafetyAdvisory;
}

export interface SafetyAdvisory {
  severity: "review" | "severe";
  text: string;
  categories?: string[];
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
            safetyAdvisory={m.safetyAdvisory}
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

/** How many source chips to keep visible (scrollable) before offering "Show all". */
const SOURCE_TOGGLE_THRESHOLD = 3;
/** How long a citation-clicked source chip stays highlighted (ms). */
const SOURCE_HIGHLIGHT_MS = 2600;

function AssistantTurn({
  content,
  pending,
  sources,
  safetyAdvisory,
  messageIndex,
  onFeedback,
}: {
  content: string;
  pending?: boolean;
  sources?: string[];
  safetyAdvisory?: SafetyAdvisory;
  messageIndex?: number;
  onFeedback?: (messageIndex: number, input: TranscriptFeedbackInput) => Promise<void>;
}) {
  // Which source chip is currently highlighted (0-based index), set when a
  // citation is clicked. Cleared after a short flash.
  const [highlight, setHighlight] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const chipRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Click a `[[n]]` citation → highlight + scroll the n-th source chip into
  // view. Works in both the collapsed (one-row, horizontally scrollable) and
  // expanded (wrapped) layouts.
  const handleCite = useCallback(
    (n: number) => {
      const count = sources?.length ?? 0;
      if (count === 0) return;
      const idx = Math.min(Math.max(n - 1, 0), count - 1);
      setHighlight(idx);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setHighlight(null), SOURCE_HIGHLIGHT_MS);
    },
    [sources],
  );

  // Scroll the highlighted chip into view after render (so it exists even if a
  // layout switch just happened). `nearest` keeps the page/transcript still
  // unless the chip is actually off-screen.
  useEffect(() => {
    if (highlight === null) return;
    chipRefs.current[highlight]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  }, [highlight, expanded]);

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  return (
    <div className="flex flex-col gap-1.5">
      {sources && sources.length > 0 && (
        <SourceChips
          sources={sources}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          highlight={highlight}
          chipRefs={chipRefs}
        />
      )}
      <div className="flex items-start gap-2">
        <DfAvatar />
        <div className="max-w-[88%] space-y-2 rounded-2xl rounded-tl-sm bg-df-green-leaf/15 px-4 py-3 text-sm leading-relaxed text-df-text shadow-sm md:text-base">
          {content ? (
            renderRichText(content, { sources, onCite: handleCite })
          ) : pending ? (
            <ThinkingDots />
          ) : null}
          {pending && content && <BlinkingCursor />}
        </div>
      </div>
      {safetyAdvisory && content && !pending && (
        <div
          role="alert"
          data-testid="safety-advisory"
          className="ml-9 flex max-w-[88%] items-start gap-2 rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-gray-700 md:text-sm"
        >
          <span aria-hidden="true" className="mt-0.5">⚕️</span>
          <span>{safetyAdvisory.text}</span>
        </div>
      )}
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

/**
 * Retrieved-source chips ("context bubbles"). Collapsed by default to a SINGLE
 * row — the chips sit in a horizontally-scrollable strip (no visible
 * scrollbar) so a long source list never balloons the reply to several rows.
 * A "Show all N sources" toggle expands them to a wrapped grid. A chip
 * highlights (and scrolls into view) when its `[[n]]` citation is clicked.
 */
function SourceChips({
  sources,
  expanded,
  onToggle,
  highlight,
  chipRefs,
}: {
  sources: string[];
  expanded: boolean;
  onToggle: () => void;
  highlight: number | null;
  chipRefs: MutableRefObject<Array<HTMLSpanElement | null>>;
}) {
  return (
    <div className="pl-9">
      <div
        className={
          expanded
            ? "flex flex-wrap items-center gap-1.5"
            : "flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        }
      >
        {sources.map((s, i) => (
          <span
            key={`${s}-${i}`}
            ref={(el) => {
              chipRefs.current[i] = el;
            }}
            title={s}
            className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition ${
              highlight === i
                ? "border-df-green-dark bg-df-green-leaf/40 text-df-green-dark ring-2 ring-df-green-dark/50"
                : "border-df-green-dark/15 bg-white/80 text-gray-600"
            }`}
          >
            <span className="text-[0.7rem] font-semibold text-df-green-dark/70" aria-hidden="true">
              {i + 1}
            </span>
            <span aria-hidden="true">{sourceIcon(s)}</span>
            <span className="max-w-[10rem] truncate">{s}</span>
          </span>
        ))}
      </div>
      {sources.length > SOURCE_TOGGLE_THRESHOLD && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-1 text-xs font-medium text-df-green-dark/80 transition hover:text-df-green-dark"
        >
          {expanded ? "Collapse sources" : `Show all ${sources.length} sources`}
        </button>
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

/** Resolve a citation number to its source ("context") title for the tooltip. */
function citeTitle(sources: string[] | undefined, n: number): string {
  if (!sources || sources.length === 0) return "Dr. Fuhrman's corpus";
  return sources[n - 1] ?? sources[sources.length - 1];
}

interface InlineOpts {
  sources?: string[];
  onCite?: (n: number) => void;
}

/** A `[[n]]` citation: a superscript number with a hover/focus source tooltip;
 *  clicking it highlights + scrolls to the matching source chip. */
function Citation({ n, sources, onCite }: { n: number } & InlineOpts) {
  const title = citeTitle(sources, n);
  const activate = () => onCite?.(n);
  return (
    <sup
      role="button"
      tabIndex={0}
      aria-label={`Source ${n}: ${title}`}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
      className="df-cite group relative ml-0.5 cursor-pointer rounded bg-df-green-leaf/30 px-1 py-0.5 text-[0.65em] font-semibold text-df-green-dark transition hover:bg-df-green-leaf/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-df-green-dark"
    >
      {n}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-max max-w-[15rem] -translate-x-1/2 whitespace-normal rounded-md bg-df-text px-2.5 py-1.5 text-left text-xs font-normal not-italic leading-snug text-white shadow-lg group-hover:block group-focus-within:block"
      >
        {title}
      </span>
    </sup>
  );
}

// Lightweight inline formatter — mirrors the static showcase's mini-syntax
// so the live reply renders **bold** / *italic* / [[n]] citations instead of
// raw markup, split into paragraphs on blank lines. Deliberately small (no
// markdown dependency); anything it doesn't recognise renders as plain text.
function renderRichText(text: string, opts?: InlineOpts): ReactNode {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.map((para, i) => <p key={i}>{renderInline(para, opts)}</p>);
}

function renderInline(s: string, opts?: InlineOpts): ReactNode[] {
  const out: ReactNode[] = [];
  // Citations: the live model emits single-bracket `[n]`; the static showcase
  // uses double-bracket `[[n]]`. Support both (double tried first so `[[3]]`
  // isn't read as the inner `[3]`).
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[\[(\d+)\]\]|\[(\d+)\]/g;
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
    } else {
      out.push(
        <Citation
          key={key++}
          n={Number(m[3] ?? m[4])}
          sources={opts?.sources}
          onCite={opts?.onCite}
        />,
      );
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
