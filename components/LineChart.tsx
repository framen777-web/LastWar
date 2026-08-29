type LineSeries = { label: string; points: (number | null)[]; colorClass: string };

const SERIES_COLORS = [
  "stroke-sky-500",
  "stroke-amber-500",
  "stroke-emerald-500",
  "stroke-rose-500",
  "stroke-violet-500",
  "stroke-orange-500",
  "stroke-teal-500",
  "stroke-pink-500",
];

/** Minimal multi-series SVG line chart - BarChart is single-series only, so several members/
 *  categories over time (the Custom Pivot's whole point) needs its own component. */
export function LineChart({
  xLabels,
  series,
  // Accepted for API parity with BarChart even though v1 doesn't render numeric labels on the
  // line itself - keeps the door open for hover tooltips later without a signature change.
  formatValue: _formatValue,
}: {
  xLabels: string[];
  series: { label: string; points: (number | null)[] }[];
  formatValue: (n: number) => string;
}) {
  const width = 720;
  const height = 280;
  const padding = { top: 16, right: 16, bottom: 28, left: 56 };

  const allValues = series.flatMap((s) => s.points).filter((v): v is number => v !== null);
  const maxV = allValues.length ? Math.max(...allValues, 0) : 1;
  const minV = allValues.length ? Math.min(...allValues, 0) : 0;
  const range = maxV - minV || 1;

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const xFor = (i: number) => padding.left + (xLabels.length <= 1 ? 0 : (i / (xLabels.length - 1)) * plotWidth);
  const yFor = (v: number) => padding.top + plotHeight - ((v - minV) / range) * plotHeight;

  const colored: LineSeries[] = series.map((s, i) => ({ ...s, colorClass: SERIES_COLORS[i % SERIES_COLORS.length] }));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[480px]">
        <line x1={padding.left} y1={yFor(0)} x2={width - padding.right} y2={yFor(0)} className="stroke-neutral-300" strokeWidth={1} />
        {colored.map((s) => {
          const segments: string[] = [];
          let current = "";
          s.points.forEach((v, i) => {
            if (v === null) {
              if (current) segments.push(current);
              current = "";
              return;
            }
            current += `${current ? "L" : "M"}${xFor(i)},${yFor(v)} `;
          });
          if (current) segments.push(current);
          return segments.map((d, idx) => (
            <path key={`${s.label}-${idx}`} d={d} fill="none" className={s.colorClass} strokeWidth={2} />
          ));
        })}
        {xLabels.map((label, i) => (
          <text key={label} x={xFor(i)} y={height - 8} textAnchor="middle" className="fill-neutral-500 text-[10px]">
            {label}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
        {colored.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className={`inline-block w-3 h-0.5 ${s.colorClass.replace("stroke-", "bg-")}`} />
            <span className="text-neutral-600">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
