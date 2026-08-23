export type BarChartLine = { label: string; value: number; colorClass: string };

export function BarChart({
  bars,
  formatValue,
  lines,
}: {
  bars: { label: string; value: number }[];
  formatValue?: (n: number) => string;
  lines?: BarChartLine[];
}) {
  const fmt = formatValue ?? ((n: number) => Math.round(n).toLocaleString());

  // The scale (zoom baseline + span) now has to fit the reference lines too, not just the
  // bars - a Lifetime Max/Min from outside the currently-displayed weeks must still land
  // inside the chart instead of getting clipped above/below it.
  const allValues = [...bars.map((b) => b.value), ...(lines ?? []).map((l) => l.value)];
  const maxAbs = Math.max(1, ...allValues.map((v) => Math.abs(v)));
  const allNonNegative = allValues.every((v) => v >= 0);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const spread = maxVal - minVal;

  // Same zoom rule as before: only zoom when everything (bars + lines) is non-negative and
  // there's actually room to zoom into. A value going negative keeps the original
  // zero-centered rendering.
  const zoomed = allNonNegative && spread > 0;
  const baseline = zoomed ? Math.max(0, minVal - spread * 0.15) : 0;
  const span = zoomed ? Math.max(1, maxVal - baseline) : maxAbs;

  // Pure position on the scale, no artificial floor - used for line placement, where
  // accuracy matters more than guaranteeing a sliver of visibility.
  function pctOf(value: number): number {
    return zoomed ? ((value - baseline) / span) * 100 : (Math.abs(value) / span) * 100;
  }

  // Bars additionally get a small floor so a genuinely nonzero-but-tiny value still shows
  // as a visible sliver instead of nothing.
  function barHeightPct(value: number): number {
    return Math.max(pctOf(value), value !== 0 ? 2 : 0);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <div className="flex items-end gap-3 overflow-x-auto pb-2">
          {bars.map((b, i) => (
            <div key={i} className="flex flex-col items-center shrink-0 w-16">
              <div className="flex flex-col items-center justify-end w-full h-48">
                <span className="text-xs text-neutral-600 mb-1 whitespace-nowrap">{fmt(b.value)}</span>
                <div className={`w-9 rounded-t ${b.value < 0 ? "bg-red-400" : "bg-accent"}`} style={{ height: `${barHeightPct(b.value)}%` }} />
              </div>
              <span className="text-xs text-neutral-500 mt-1 text-center">{b.label}</span>
            </div>
          ))}
        </div>

        {/* Overlay matches the bars' own h-48 box exactly (same top edge, same height), so
            a line positioned at bottom:X% lands at the identical height a bar of that
            value would reach. Sits above the bars visually but doesn't intercept clicks/
            scroll (pointer-events-none), and isn't part of the horizontally-scrolling
            bars row, so it always spans whatever's currently in view. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-48">
          {(lines ?? []).map((line) => (
            <div
              key={line.label}
              className="absolute inset-x-0 flex items-center gap-1"
              style={{ bottom: `${Math.min(100, Math.max(0, pctOf(line.value)))}%` }}
            >
              <div className={`flex-1 border-t border-dashed ${line.colorClass}`} />
              <span className="text-[10px] font-medium bg-surface-raised px-1 rounded whitespace-nowrap">
                {line.label} {fmt(line.value)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {zoomed && baseline > 0 && (
        <p className="text-neutral-400 text-xs">
          Axis starts at {fmt(baseline)}, not zero — zoomed in so the differences between bars and lines are visible.
        </p>
      )}
    </div>
  );
}
