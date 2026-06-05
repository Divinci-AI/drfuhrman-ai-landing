import { useEffect, useRef } from "react";

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
}

interface TranscriptProps {
  messages: TranscriptMessage[];
}

export function Transcript({ messages }: TranscriptProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div
      className="flex max-h-[480px] flex-col gap-4 overflow-y-auto pr-1"
      role="log"
      aria-live="polite"
    >
      {messages.map((m) =>
        m.role === "user" ? (
          <UserBubble key={m.id} content={m.content} />
        ) : (
          <AssistantBubble
            key={m.id}
            content={m.content}
            pending={m.pending}
          />
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-df-bubble-user px-4 py-3 text-sm leading-relaxed text-df-text">
        {content}
      </div>
    </div>
  );
}

function AssistantBubble({
  content,
  pending,
}: {
  content: string;
  pending?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-df-green-dark text-sm font-bold text-white">
        DF
      </div>
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-sm leading-relaxed text-df-text shadow-sm ring-1 ring-black/5">
        {content || (pending ? <ThinkingDots /> : "")}
        {pending && content && <BlinkingCursor />}
      </div>
    </div>
  );
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
