/**
 * Loading placeholders. `Skeleton` is a single shimmer block sized by
 * `className`; `SkeletonRows` mimics a list card (dashboards); `PageSkeleton`
 * is a generic full-page stand-in for the "still fetching" early returns.
 * The fill uses --mp-border so it reads on both --mp-bg and --mp-surface.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-mp-border ${className}`} />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="divide-y divide-mp-border rounded-lg border border-mp-border bg-mp-surface"
      aria-busy="true"
      aria-live="polite"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between px-4 py-3">
          <div className="space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
      <span className="sr-only">読み込み中</span>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="min-h-screen bg-mp-bg p-6" aria-busy="true">
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
      <span className="sr-only">読み込み中</span>
    </div>
  );
}
