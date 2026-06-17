interface WelcomeMessageProps {
  text: string | null;
  /** The Release's uploaded avatar; falls back to the static logo when absent. */
  avatarUrl?: string | null;
}

export function WelcomeMessage({ text, avatarUrl }: WelcomeMessageProps) {
  if (!text) return null;
  return (
    <div className="flex items-start gap-3 md:translate-x-[8px]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-df-green-leaf/20 ring-1 ring-df-green-dark/15">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" aria-hidden="true" className="h-full w-full object-cover" />
        ) : (
          <img src="/drfuhrman-logo.svg" alt="" aria-hidden="true" className="h-5 w-5" width={20} height={20} />
        )}
      </span>
      <div className="welcome-bubble max-w-[30rem] rounded-2xl rounded-tl-sm bg-df-bubble-user/75 px-4 py-3 text-sm leading-relaxed text-df-text shadow-sm transition-colors duration-200">
        {text}
      </div>
    </div>
  );
}
