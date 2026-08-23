import { prisma } from "@/lib/db";
import { ZoomWrapper } from "@/components/ZoomWrapper";
import { BarChart } from "@/components/BarChart";
import { formatStatNumber } from "@/lib/format";
import { requireMenuAccess } from "@/lib/menuAccess";
import { getGraphMetrics, getGraphSeries, computeGraphStats } from "@/lib/dashboards/categoryGraph";

const WEEK_COUNT_OPTIONS = [4, 8, 12, 26, 52];

export default async function AllianceGraphsPage({ searchParams }: PageProps<"/dashboards/alliance/graphs">) {
  await requireMenuAccess("alliance-graphs");
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

  const commanderParam = Array.isArray(params.commander) ? params.commander[0] : params.commander;
  const selectedCommander = commanderParam && commanderParam !== "all" ? Number(commanderParam) : "all";

  const aggregationParam = Array.isArray(params.aggregation) ? params.aggregation[0] : params.aggregation;
  const aggregation = aggregationParam === "average" ? "average" : "sum";

  const rangeParam = Array.isArray(params.range) ? params.range[0] : params.range;
  const range = rangeParam === "selected" ? "selected" : "lifetime";

  const members = await prisma.member.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  const knownWeeks = await prisma.weeklyStat.findMany({
    select: { weekNumber: true },
    distinct: ["weekNumber"],
    orderBy: { weekNumber: "desc" },
  });
  const weekNumbers = knownWeeks.map((w) => w.weekNumber);
  // Newest week first, matching the bar chart's own left-to-right order.
  const selectedWeeks = weekNumbers.slice(0, weeksCount);

  const series = await getGraphSeries(selectedMetric.key, selectedMetric.cumulative, selectedWeeks, selectedCommander, aggregation);
  const bars = series.map((s) => ({ label: `W${s.week}`, value: s.value }));

  // Lifetime reuses the full, unsliced week list already fetched above (every week the
  // alliance has any data for) instead of a separate query - Selected just reuses the
  // series already computed for the bars themselves.
  const statsSeries =
    range === "lifetime"
      ? await getGraphSeries(selectedMetric.key, selectedMetric.cumulative, weekNumbers, selectedCommander, aggregation)
      : series;
  const stats = computeGraphStats(statsSeries);

  const commanderName = selectedCommander === "all" ? null : (members.find((m) => m.id === selectedCommander)?.name ?? null);
  const chartTitle =
    selectedCommander === "all"
      ? `${selectedMetric.label} - All commanders (${aggregation === "sum" ? "total" : "average"})`
      : `${selectedMetric.label} - ${commanderName ?? "Unknown member"}`;

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

        <label htmlFor="commander" className="font-medium">
          Commander
        </label>
        <select
          id="commander"
          name="commander"
          defaultValue={selectedCommander === "all" ? "all" : selectedCommander}
          className="border border-neutral-300 rounded px-2 py-1"
        >
          <option value="all">All commanders</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        <label htmlFor="aggregation" className="font-medium">
          When &quot;All&quot;
        </label>
        <select id="aggregation" name="aggregation" defaultValue={aggregation} className="border border-neutral-300 rounded px-2 py-1">
          <option value="sum">Sum</option>
          <option value="average">Average</option>
        </select>

        <label htmlFor="range" className="font-medium">
          Avg/Max/Min from
        </label>
        <select id="range" name="range" defaultValue={range} className="border border-neutral-300 rounded px-2 py-1">
          <option value="lifetime">Lifetime</option>
          <option value="selected">Selected range</option>
        </select>
      </form>

      <ZoomWrapper contentId="alliance-graph-content">
        <div className="border border-neutral-200 rounded overflow-hidden">
          <div className="bg-sky-300 px-3 py-1 font-semibold text-neutral-900">{chartTitle}</div>
          <div className="p-4">
            {bars.every((b) => b.value === 0) ? (
              <p className="text-neutral-500 text-sm">No data for this selection.</p>
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
