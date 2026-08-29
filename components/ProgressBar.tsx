"use client";

/**
 * A visual "something is happening" indicator for any action that takes a moment - merges,
 * exports, recompute, finalize/reopen, restore. Pass `value` (0-1) when real progress is known
 * (e.g. "file 2 of 5"); omit it for an indeterminate sliding animation, which covers the common
 * case of a single request with no incremental progress to report.
 */
export function ProgressBar({ value, className = "" }: { value?: number; className?: string }) {
  const determinate = typeof value === "number";
  const pct = determinate ? Math.min(100, Math.max(0, value! * 100)) : undefined;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(determinate ? { "aria-valuenow": Math.round(pct!) } : {})}
      className={`h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 ${className}`}
    >
      {determinate ? (
        <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
      ) : (
        <div className="h-full w-1/3 rounded-full bg-accent animate-progress-indeterminate" />
      )}
    </div>
  );
}
