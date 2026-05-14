export function StreamingIndicator() {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-2xl border border-[color-mix(in_srgb,var(--warm-glow)_16%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_6%,transparent)] px-3 py-2" aria-label="Assistant is thinking">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--warm-glow)]"
          style={{ animationDelay: `${index * 120}ms` }}
        />
      ))}
    </div>
  );
}
