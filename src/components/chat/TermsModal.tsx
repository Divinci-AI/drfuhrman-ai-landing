/**
 * Terms-of-Service / medical-disclaimer acceptance modal. Shown when the
 * release gates chat behind a published ToS version. Renders the document's
 * markdown with a deliberately tiny formatter (headings + bold + paragraphs —
 * same no-dependency approach as the transcript renderer).
 *
 * Shared by the hero ChatIsland and the in-place showcase chat.
 */
export function TermsModal({
  title,
  content,
  busy,
  error,
  onAgree,
  onClose,
}: {
  title: string;
  content: string;
  busy: boolean;
  error: string | null;
  onAgree: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-df-green-dark/15 bg-white shadow-2xl">
        <div className="border-b border-df-green-dark/10 bg-df-green-leaf/10 px-5 py-3">
          <h2 className="text-base font-semibold text-df-green-dark">{title}</h2>
        </div>
        <div className="df-chat-scroll flex-1 space-y-2 overflow-y-auto px-5 py-4 text-sm leading-relaxed text-df-text">
          {renderTosContent(content)}
        </div>
        <div className="border-t border-df-green-dark/10 bg-white/90 px-5 py-3">
          {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={onAgree}
              disabled={busy}
              className="rounded-lg bg-df-green-dark px-4 py-1.5 text-sm font-medium text-white transition hover:bg-df-green-mid disabled:opacity-60"
            >
              {busy ? "Saving…" : "I Agree"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Markdown-lite for the ToS body: #/##/### headings, **bold**, paragraphs. */
function renderTosContent(text: string) {
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.map((block, i) => {
    const heading = block.match(/^(#{1,3})\s+(.*)$/);
    const renderBold = (s: string) =>
      s.split(/\*\*([^*]+)\*\*/g).map((part, j) =>
        j % 2 === 1 ? (
          <strong key={j} className="font-semibold">
            {part}
          </strong>
        ) : (
          part
        ),
      );
    if (heading) {
      return (
        <p key={i} className="pt-1 font-semibold text-df-green-dark">
          {renderBold(heading[2])}
        </p>
      );
    }
    return <p key={i}>{renderBold(block)}</p>;
  });
}
