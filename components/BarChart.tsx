export function BarChart({
  bars,
  formatValue,
}: {
  bars: { label: string; value: number }[];
  formatValue?: (n: number) => string;
}) {
  const fmt = formatValue ?? ((n: number) => Math.round(n).toLocaleString());
  const maxAbs = Math.max(1, ...bars.map((b) => Math.abs(b.value)));

  const allNonNegative = bars.every((b) => b.value >= 0);
  const minVal = Math.min(...bars.map((b) => b.value));
  const maxVal = Math.max(...bars.map((b) => b.value));
  const spread = maxVal - minVal;

  // A zero-based scale only makes sense when there's room to zoom into - series that are
  // all non-negative (the normal case: totals, gains) get their axis zoomed so real
  // week-to-week movement is visible, instead of every bar rendering at ~100% height when
  // the values are all close together on a large baseline. A series that goes negative
  // (rare here, e.g. a corrected-downward gain) keeps the original zero-centered
  // rendering - a zoomed baseline has no clean meaning once bars point both up and down.
  const zoomed = allNonNegative && spread > 0;
  const baseline = zoomed ? Math.max(0, minVal - spread * 0.15) : 0;
  const span = zoomed ? Math.max(1, maxVal - baseline) : maxAbs;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-3 overflow-x-auto pb-2">
        {bars.map((b, i) => {
          const heightPct = zoomed
            ? Math.max(((b.value - baseline) / span) * 100, b.value !== 0 ? 2 : 0)
            : Math.max((Math.abs(b.value) / span) * 100, b.value !== 0 ? 2 : 0);
          return (
            <div key={i} className="flex flex-col items-center shrink-0 w-16">
              <div className="flex flex-col items-center justify-end w-full h-48">
                <span className="text-xs text-neutral-600 mb-1 whitespace-nowrap">{fmt(b.value)}</span>
                <div className={`w-9 rounded-t ${b.value < 0 ? "bg-red-400" : "bg-accent"}`} style={{ height: `${heightPct}%` }} />
              </div>
              <span className="text-xs text-neutral-500 mt-1 text-center">{b.label}</span>
            </div>
          );
        })}
      </div>
      {zoomed && baseline > 0 && (
        <p className="text-neutral-400 text-xs">
          Axis starts at {fmt(baseline)}, not zero — zoomed in so the differences between bars are visible.
        </p>
      )}
    </div>
  );
}
