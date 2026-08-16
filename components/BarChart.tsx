export function BarChart({
  bars,
  formatValue,
}: {
  bars: { label: string; value: number }[];
  formatValue?: (n: number) => string;
}) {
  const maxAbs = Math.max(1, ...bars.map((b) => Math.abs(b.value)));
  const fmt = formatValue ?? ((n: number) => Math.round(n).toLocaleString());

  return (
    <div className="flex items-end gap-3 overflow-x-auto pb-2">
      {bars.map((b, i) => {
        const heightPct = Math.max((Math.abs(b.value) / maxAbs) * 100, b.value !== 0 ? 2 : 0);
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
  );
}
