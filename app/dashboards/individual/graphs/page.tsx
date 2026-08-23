import { prisma } from "@/lib/db";
import { ZoomWrapper } from "@/components/ZoomWrapper";
import { BarChart } from "@/components/BarChart";
import { formatStatNumber } from "@/lib/format";
import { requireMenuAccess } from "@/lib/menuAccess";
import { getGraphMetrics, getGraphSeries, computeGraphStats } from "@/lib/dashboards/categoryGraph";

const WEEK_COUNT_OPTIONS = [4, 8, 12, 26, 52];

export default async function IndividualGraphsPage({ searchParams }: PageProps<"/dashboards/individual/graphs">) {
  // Unlike the Alliance Reports version, this page is always scoped to whoever is logged
  // in - even an Admin/Leader viewing their own Individual Dashboard only ever sees their
  // own bars here, there's no commander picker at all.
  const user = await requireMenuAccess("individual-graphs");
  const params = await searchParams;

  const metrics = await getGraphMetrics();
  if (metrics.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Graphs</h1>
        <p className="text-neutral-500 text-sm">No graphable categories are set up yet.</p>
      </div>
    );
  }

  const weeksParam = Array.isArray(params.weeks) ? params.weeks[0] : params.weeks;
  const weeksCount = WEEK_COUNT_OPTIONS.includes(Number(weeksParam)) ? Number(weeksParam) : WEEK_COUNT_OPTIONS[1];

  const metricParam = Array.isArray(params.metric) ? params.metric[0] : params.metric;
  const selectedMetric = metrics.find((m) => m.key === metricParam) ?? metrics[0];

  const knownWeeks = await prisma.weeklyStat.findMany({
    where: { memberId: user.id },
    select: { weekNumber: true },
    distinct: ["weekNumber"],
    orderBy: { weekNumber: "desc" },
  });
  const weekNumbers = knownWeeks.map((w) => w.weekNumber);
  const selectedWeeks = weekNumbers.slice(0, weeksCount);

  const rangeParam = Array.isArray(params.range) ? params.range[0] : params.range;
  const range = rangeParam === "selected" ? "selected" : "lifetime";

  const series = await getGraphSeries(selectedMetric.key, selectedMetric.cumulative, selectedWeeks, user.id, "sum");
  const bars = series.map((s) => ({ label: `W${s.week}`, value: s.value }));

  const statsSeries =
    range === "lifetime"
      ? await getGraphSeries(selectedMetric.key, selectedMetric.cumulative, weekNumbers, user.id, "sum")
      : series;
  const stats = computeGraphStats(statsSeries);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Graphs</h1>

      <form className="flex items-center gap-2 text-sm flex-wrap">
        <button type="submit" className="bg-accent text-accent-contrast rounded px-3 py-1">
          Go
        </button>

        <label htmlFor="metric" className="font-medium">
          Field
        </label>
        <select id="metric" name="metric" defaultValue={selectedMetric.key} className="border border-neutral-300 rounded px-2 py-1">
          {metrics.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>

        <label htmlFor="weeks" className="font-medium">
          Weeks
        </label>
        <select id="weeks" name="weeks" defaultValue={weeksCount} className="border border-neutral-300 rounded px-2 py-1">
          {WEEK_COUNT_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        <label htmlFor="range" className="font-medium">
          Avg/Max/Min from
        </label>
        <select id="range" name="range" defaultValue={range} className="border border-neutral-300 rounded px-2 py-1">
          <option value="lifetime">Lifetime</option>
          <option value="selected">Selected range</option>
        </select>
      </form>

      <ZoomWrapper contentId="individual-graph-content">
        <div className="border border-neutral-200 rounded overflow-hidden">
          <div className="bg-sky-300 px-3 py-1 font-semibold text-neutral-900">{selectedMetric.label}</div>
          <div className="p-4">
            {selectedWeeks.length === 0 || bars.every((b) => b.value === 0) ? (
              <p className="text-neutral-500 text-sm">No data yet.</p>
            ) : (
              <BarChart
                bars={bars}
                formatValue={formatStatNumber}
                lines={
                  stats
                    ? [
                        { label: "Max", value: stats.max, colorClass: "border-green-500" },
                        { label: "Avg", value: stats.average, colorClass: "border-neutral-400" },
                        { label: "Min", value: stats.min, colorClass: "border-red-400" },
                      ]
                    : undefined
                }
              />
            )}
          </div>
        </div>
      </ZoomWrapper>
    </div>
  );
}
