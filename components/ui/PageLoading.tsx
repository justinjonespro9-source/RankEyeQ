export function PageLoading({
  label = "Loading RankEyeQ…",
}: {
  label?: string;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16" role="status" aria-live="polite">
      <p className="text-sm font-medium text-muted">{label}</p>
      <div className="mt-6 space-y-3">
        <div className="h-8 w-2/3 max-w-md animate-pulse rounded-md bg-border/80" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded-md bg-border/60" />
        <div className="h-24 w-full animate-pulse rounded-lg bg-border/50" />
        <div className="h-24 w-full animate-pulse rounded-lg bg-border/40" />
      </div>
    </div>
  );
}
