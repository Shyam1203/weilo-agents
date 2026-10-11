import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Logo } from "./ui/Logo";

/** Loading, or an error with a retry, centered on the page. */
export function FullScreenStatus({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
      <Logo size={36} />
      {error ? (
        <div className="flex max-w-sm animate-fade-in flex-col items-center gap-3">
          <p className="text-[14px] text-bad">{error}</p>
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-[13px] text-ink-3">
          <Icon name="spinner" size={14} /> Loading…
        </p>
      )}
    </div>
  );
}
