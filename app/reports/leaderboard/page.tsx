import { prisma } from "@/lib/db";
import { ZoomWrapper, ZoomProvider, ZoomControl } from "@/components/ZoomWrapper";
import { ShareReportButton } from "@/components/ShareReportButton";
import { NumberStepper } from "@/components/NumberStepper";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/DataTable";
import { pickNumberFormat, formatWithRule } from "@/lib/format";
import { requireMenuAccess } from "@/lib/menuAccess";
import { REPORT_NAME_COL_WIDTH, REPORT_VALUE_COL_WIDTH, parseLimitParam, applyLimit } from "@/lib/reportLayout";
import { LimitSelect } from "@/components/LimitSelect";

// Kills is a lifetime-cumulative reading in-game (never resets) - "this week" and
// "last N weeks" have to be computed as the gain between cumulative readings, not the
// raw stored value. VS/DS/Donations reset/are tracked per-event, so the raw value is
// already the right per-week figure.
const LEADERBOARD_CATEGORIES = [
  { key: "kills", label: "Kills", cumulative: true },
  { key: "desert_storm", label: "DS", cumulative: false },
  { key: "vs", label: "VS", cumulative: false },
  { key: "donations", label: "Donations", cumulative: false },
];

const IMPROVEMENT_CAP = 500;

type SeriesRow = { weekNumber: number; memberId: number; memberName: string; value: number };

// For non-cumulative categories, the series is just the raw stored values. For
// cumulative categories (Kills), each reading is converted into the gain since that
// member's previous reading - a member's very first-ever reading has no baseline to
// diff against, so it's dropped rather than shown as a misleading giant "gain".
async function getCategorySeries(categoryKey: string, cumulative: boolean): Promise<SeriesRow[]> {
  const stats = await prisma.weeklyStat.findMany({
    where: { categoryKey },
    include: { member: true },
    orderBy: { weekNumber: "asc" },
  });

  if (!cumulative) {
    return stats.map((s) => ({ weekNumber: s.weekNumber, memberId: s.memberId, memberName: s.member.name, value: s.value }));
  }

  const lastByMember = new Map<number, number>();
  const series: SeriesRow[] = [];
  for (const s of stats) {
    const prev = lastByMember.get(s.memberId);
    if (prev !== undefined) {
      series.push({ weekNumber: s.weekNumber, memberId: s.memberId, memberName: s.member.name, value: s.value - prev });
    }
    lastByMember.set(s.memberId, s.value);
  }
  return series;
}

function recentWeeksFromSeries(series: SeriesRow[], maxWeek: number, limit: number, inclusive: boolean): number[] {
  const weeks = Array.from(
    new Set(series.filter((r) => (inclusive ? r.weekNumber <= maxWeek : r.weekNumber < maxWeek)).map((r) => r.weekNumber))
  );
  weeks.sort((a, b) => b - a);
  return weeks.slice(0, limit);
}

function topThisWeek(series: SeriesRow[], week: number, limit: string) {
  const sorted = series.filter((r) => r.weekNumber === week).sort((a, b) => b.value - a.value);
  return applyLimit(sorted, limit).map((r) => ({ name: r.memberName, value: r.value }));
}

function topSumOverWeeks(series: SeriesRow[], weeks: number[], limit: string) {
  if (weeks.length === 0) return [];
  const weekSet = new Set(weeks);
  const sums = new Map<number, { name: string; total: number }>();
  for (const r of series) {
    if (!weekSet.has(r.weekNumber)) continue;
    const entry = sums.get(r.memberId) ?? { name: r.memberName, total: 0 };
    entry.total += r.value;
    sums.set(r.memberId, entry);
  }
  return applyLimit(
    Array.from(sums.values()).sort((a, b) => b.total - a.total),
    limit
  );
}

function getImprovement(series: SeriesRow[], week: number, limit: string) {
  const thisWeekRows = series.filter((r) => r.weekNumber === week);
  const priorWeeks = new Set(recentWeeksFromSeries(series, week, 5, false));

  const priorSum = new Map<number, number>();
  const priorCount = new Map<number, number>();
  for (const r of series) {
    if (!priorWeeks.has(r.weekNumber)) continue;
    priorSum.set(r.memberId, (priorSum.get(r.memberId) ?? 0) + r.value);
    priorCount.set(r.memberId, (priorCount.get(r.memberId) ?? 0) + 1);
  }

  // No prior reading to compare against (new member, or every prior week missing) means
  // improvement genuinely can't be computed - excluded rather than shown as a fake 500%
  // (the old fallback made every such member look like a 5x improvement).
  const results = thisWeekRows
    .map((r) => {
      const count = priorCount.get(r.memberId) ?? 0;
      const avg = count > 0 ? priorSum.get(r.memberId)! / count : 0;
      if (avg <= 0) return null;
      // Percent IMPROVEMENT over the average, not percent OF the average - doing exactly
      // the average was reading as "100% improvement" instead of the correct 0%, and
      // anything better than 4x the average was hitting the cap at a number that looked
      // arbitrary rather than meaning "capped at +500%".
      return { name: r.memberName, pct: Math.min(IMPROVEMENT_CAP, Math.round((r.value / avg - 1) * 100)) };
    })
    .filter((r): r is { name: string; pct: number } => r !== null);

  return applyLimit(
    results.sort((a, b) => b.pct - a.pct),
    limit
  );
}

// All-time panel: non-cumulative categories surface the top individual week-records
// across everyone - the same member can appear more than once if they've had several
// top-ranking weeks, this is a leaderboard of weeks, not of members. The cumulative
// category (Kills) instead surfaces each member's latest/highest raw reading, since
// that reading already *is* their lifetime total (see getLatestCumulative below).
async function getAllTimeBestWeek(categoryKey: string, limit: string) {
  const stats = await prisma.weeklyStat.findMany({ where: { categoryKey }, include: { member: true } });
  const rows = stats.map((s) => ({ name: s.member.name, value: s.value, week: s.weekNumber }));
  return applyLimit(
    rows.sort((a, b) => b.value - a.value),
    limit
  );
}

async function getLatestCumulative(categoryKey: string, limit: string) {
  const stats = await prisma.weeklyStat.findMany({ where: { categoryKey }, include: { member: true } });
  const latest = new Map<number, { name: string; value: number; week: number }>();
  for (const s of stats) {
    const cur = latest.get(s.memberId);
    if (!cur || s.weekNumber > cur.week) latest.set(s.memberId, { name: s.member.name, value: s.value, week: s.weekNumber });
  }
  return applyLimit(
    Array.from(latest.values()).sort((a, b) => b.value - a.value),
    limit
  );
}

export default async function LeaderboardPage({ searchParams }: PageProps<"/reports/leaderboard">) {
  await requireMenuAccess("reports-leaderboard");
  const params = await searchParams;

  const categoryParam = Array.isArray(params.category) ? params.category[0] : params.category;
  const selectedCategory = LEADERBOARD_CATEGORIES.find((c) => c.key === categoryParam) ?? LEADERBOARD_CATEGORIES[0];

  const weeks = await prisma.weeklyStat.findMany({
    where: { categoryKey: selectedCategory.key },
    select: { weekNumber: true },
    distinct: ["weekNumber"],
    orderBy: { weekNumber: "desc" },
  });
  const weekNumbers = weeks.map((w) => w.weekNumber);
  const defaultWeek = weekNumbers.length > 0 ? weekNumbers[0] : 1;

  const weekParam = Array.isArray(params.week) ? params.week[0] : params.week;
  const selectedWeek = weekParam ? Number(weekParam) : defaultWeek;

  const selectedLimit = parseLimitParam(params.limit, "20");
  const limitLabel = selectedLimit === "all" ? "All" : `Top ${selectedLimit}`;

  const series = await getCategorySeries(selectedCategory.key, selectedCategory.cumulative);

  // Only members active in the selected (indicator) week - a departed member's earlier
  // contribution shouldn't still show up in a "last N weeks" total.
  const activeThisWeek = new Set(series.filter((r) => r.weekNumber === selectedWeek).map((r) => r.memberId));
  const activeSeries = series.filter((r) => activeThisWeek.has(r.memberId));

  const last5Weeks = recentWeeksFromSeries(series, selectedWeek, 5, true);
  const last10Weeks = recentWeeksFromSeries(series, selectedWeek, 10, true);

  const thisWeek = topThisWeek(series, selectedWeek, selectedLimit);
  const last5 = topSumOverWeeks(activeSeries, last5Weeks, selectedLimit);
  const last10 = topSumOverWeeks(activeSeries, last10Weeks, selectedLimit);
  const improvement = getImprovement(series, selectedWeek, selectedLimit);
  const allTime = selectedCategory.cumulative
    ? await getLatestCumulative(selectedCategory.key, selectedLimit)
    : await getAllTimeBestWeek(selectedCategory.key, selectedLimit);

  const allTimeLabel = selectedCategory.cumulative ? `Total ${selectedCategory.label}` : `All time ${limitLabel}`;
  const allTimeValueLabel = selectedCategory.cumulative ? `All ${selectedCategory.label}` : "Total Score";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Leaderboards</h1>
      {selectedCategory.cumulative && (
        <p className="text-neutral-500 text-xs bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Kills is a lifetime total in-game, so "this week" / "last N weeks" here show the gain since the
          previous reading, not the raw ranking-screen number.
        </p>
      )}

      <ZoomProvider>
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <form className="flex items-center gap-2 contents">
          <button type="submit" className="bg-accent text-accent-contrast rounded px-3 py-1">
            Go
          </button>

          <label htmlFor="category" className="font-medium">
            Category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={selectedCategory.key}
            className="border border-neutral-300 rounded px-2 py-1"
          >
            {LEADERBOARD_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>

          <label htmlFor="week" className="font-medium">
            Week
          </label>
          <NumberStepper id="week" name="week" defaultValue={selectedWeek} min={1} listId="leaderboard-known-weeks" />
          <datalist id="leaderboard-known-weeks">
            {weekNumbers.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>

          <LimitSelect defaultValue={selectedLimit} />
        </form>

        <ZoomControl />
        <ShareReportButton
          targetId="leaderboard-content"
          filename={`leaderboard-${selectedCategory.key}.png`}
          title={`${selectedCategory.label} Leaderboard`}
        />
      </div>

      <ZoomWrapper contentId="leaderboard-content">
      <div className="flex flex-row flex-nowrap items-start gap-4">
        <Panel title={`${limitLabel} ${selectedCategory.label} from this week`} headerClass="bg-pink-300">
          {thisWeek.length === 0 ? <Empty /> : <SimpleTable rows={thisWeek} valueLabel={selectedCategory.label} />}
        </Panel>

        <Panel title={`${limitLabel} ${selectedCategory.label} from last 5 weeks`} headerClass="bg-sky-300">
          {last5.length === 0 ? (
            <Empty />
          ) : (
            <SimpleTable rows={last5.map((r) => ({ name: r.name, value: r.total }))} valueLabel="Total" />
          )}
        </Panel>

        <Panel title={`${limitLabel} ${selectedCategory.label} from last 10 weeks`} headerClass="bg-amber-300">
          {last10.length === 0 ? (
            <Empty />
          ) : (
            <SimpleTable rows={last10.map((r) => ({ name: r.name, value: r.total }))} valueLabel="Total" />
          )}
        </Panel>

        <Panel title="Improvement over 5-week average" headerClass="bg-green-300">
          {improvement.length === 0 ? (
            <Empty />
          ) : (
            <DataTable
              columns={[
                { key: "name", header: "Name", filter: "text", width: REPORT_NAME_COL_WIDTH },
                { key: "pct", header: "Improvement", filter: "number", width: REPORT_VALUE_COL_WIDTH },
              ]}
              rows={improvement.map((r, i) => ({
                id: i,
                cells: { name: <span className="font-medium">{r.name}</span>, pct: `${r.pct}%` },
                sortValues: { name: r.name, pct: r.pct },
              }))}
              defaultSort={{ key: "pct", direction: "desc" }}
              dense
              fitContent
            />
          )}
        </Panel>

        <Panel title={allTimeLabel} headerClass="bg-red-300">
          {allTime.length === 0 ? (
            <Empty />
          ) : selectedCategory.cumulative ? (
            <SimpleTable rows={allTime.map((r) => ({ name: r.name, value: r.value }))} valueLabel={allTimeValueLabel} />
          ) : (
            <DataTable
              columns={[
                { key: "name", header: "Name", filter: "text", width: REPORT_NAME_COL_WIDTH },
                { key: "week", header: "Week", filter: "number", width: REPORT_VALUE_COL_WIDTH },
                { key: "value", header: allTimeValueLabel, filter: "number", width: REPORT_VALUE_COL_WIDTH },
              ]}
              rows={(() => {
                const rule = pickNumberFormat(allTime.map((r) => r.value));
                return allTime.map((r) => ({
                  id: `${r.name}:${r.week}`,
                  cells: {
                    name: <span className="font-medium">{r.name}</span>,
                    week: <span className="text-neutral-500">{r.week}</span>,
                    value: formatWithRule(r.value, rule),
                  },
                  sortValues: { name: r.name, week: r.week, value: r.value },
                }));
              })()}
              defaultSort={{ key: "value", direction: "desc" }}
              dense
              fitContent
            />
          )}
        </Panel>
      </div>
      </ZoomWrapper>
      </ZoomProvider>
    </div>
  );
}

function Panel({
  title,
  headerClass,
  children,
}: {
  title: string;
  headerClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-neutral-200 rounded overflow-hidden shrink-0">
      <div className={`report-panel-header ${headerClass} px-3 py-1 font-semibold text-center text-neutral-900`}>{title}</div>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-neutral-500 text-sm p-2">No data.</p>;
}

function SimpleTable({ rows, valueLabel }: { rows: { name: string; value: number }[]; valueLabel: string }) {
  const columns: DataTableColumn[] = [
    { key: "name", header: "Name", filter: "text", width: REPORT_NAME_COL_WIDTH },
    { key: "value", header: valueLabel, filter: "number", width: REPORT_VALUE_COL_WIDTH },
  ];
  const rule = pickNumberFormat(rows.map((r) => r.value));
  const tableRows: DataTableRow[] = rows.map((r, i) => ({
    id: i,
    cells: { name: <span className="font-medium">{r.name}</span>, value: formatWithRule(r.value, rule) },
    sortValues: { name: r.name, value: r.value },
  }));
  return (
    <DataTable
      columns={columns}
      rows={tableRows}
      defaultSort={{ key: "value", direction: "desc" }}
      footer={{ label: "Total", sumKeys: ["value"] }}
      dense
      fitContent
    />
  );
}
