import { prisma } from "@/lib/db";
import { ZoomWrapper, ZoomProvider, ZoomControl } from "@/components/ZoomWrapper";
import { ShareReportButton } from "@/components/ShareReportButton";
import { NumberStepper } from "@/components/NumberStepper";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/DataTable";
import { pickNumberFormat, formatWithRule } from "@/lib/format";
import { requireMenuAccess } from "@/lib/menuAccess";
import { REPORT_NAME_COL_WIDTH, REPORT_VALUE_COL_WIDTH, parseLimitParam, applyLimit } from "@/lib/reportLayout";
import { LimitSelect } from "@/components/LimitSelect";

const LEVEL_UPS_COLUMNS: DataTableColumn[] = [
  { key: "member", header: "Member", filter: "text", width: REPORT_NAME_COL_WIDTH },
  { key: "thisWeek", header: "This Week", filter: "number", width: REPORT_VALUE_COL_WIDTH },
  { key: "lastWeek", header: "Last Week", filter: "number", width: REPORT_VALUE_COL_WIDTH },
];

const DISTRIBUTION_COLUMNS: DataTableColumn[] = [
  { key: "level", header: "HQ", filter: "number", width: REPORT_VALUE_COL_WIDTH },
  { key: "count", header: "Members", filter: "number", width: REPORT_VALUE_COL_WIDTH },
  { key: "pct", header: "%", filter: "number", width: REPORT_VALUE_COL_WIDTH },
];

function levelUpRows(rows: LevelUpRow[]): DataTableRow[] {
  const thisWeekRule = pickNumberFormat(rows.map((r) => r.thisWeek));
  const lastWeekRule = pickNumberFormat(rows.map((r) => r.lastWeek));
  return rows.map((r, i) => ({
    id: i,
    cells: {
      member: <span className="font-medium">{r.name}</span>,
      thisWeek: formatWithRule(r.thisWeek, thisWeekRule),
      lastWeek: (
        <span className="text-neutral-500">{r.lastWeek === null ? "New" : formatWithRule(r.lastWeek, lastWeekRule)}</span>
      ),
    },
    sortValues: { member: r.name, thisWeek: r.thisWeek, ...(r.lastWeek !== null ? { lastWeek: r.lastWeek } : {}) },
  }));
}

function distributionRows(rows: DistributionRow[]): DataTableRow[] {
  return rows.map((r) => ({
    id: r.level,
    cells: {
      level: <span className="font-medium">{r.level}</span>,
      count: r.count,
      pct: <span className="text-neutral-500">{r.pct}%</span>,
    },
    sortValues: { level: r.level, count: r.count, pct: r.pct },
  }));
}

type LevelUpRow = { name: string; thisWeek: number; lastWeek: number | null };
type DistributionRow = { level: number; count: number; pct: number };

async function getLevelUps(week: number, limit: string): Promise<LevelUpRow[]> {
  const stats = await prisma.weeklyStat.findMany({
    where: { categoryKey: "members", weekNumber: { lte: week } },
    include: { member: true },
    orderBy: { weekNumber: "asc" },
  });

  const byMember = new Map<number, { name: string; thisWeek?: number; lastWeek?: number }>();
  for (const s of stats) {
    const entry = byMember.get(s.memberId) ?? { name: s.member.name };
    if (s.weekNumber === week) {
      entry.thisWeek = s.value;
    } else {
      entry.lastWeek = s.value;
    }
    byMember.set(s.memberId, entry);
  }

  const rows: LevelUpRow[] = [];
  for (const entry of byMember.values()) {
    if (entry.thisWeek === undefined) continue;
    if (entry.lastWeek === undefined) {
      rows.push({ name: entry.name, thisWeek: entry.thisWeek, lastWeek: null });
    } else if (entry.thisWeek > entry.lastWeek) {
      rows.push({ name: entry.name, thisWeek: entry.thisWeek, lastWeek: entry.lastWeek });
    }
  }

  rows.sort((a, b) => b.thisWeek - a.thisWeek);
  return applyLimit(rows, limit);
}

async function getHqDistribution(week: number): Promise<DistributionRow[]> {
  const stats = await prisma.weeklyStat.findMany({ where: { categoryKey: "members", weekNumber: week } });
  const counts = new Map<number, number>();
  for (const s of stats) {
    const level = Math.round(s.value);
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  const total = stats.length;
  const rows = Array.from(counts.entries()).map(([level, count]) => ({
    level,
    count,
    pct: total > 0 ? Math.round((count / total) * 100) : 0,
  }));
  rows.sort((a, b) => b.level - a.level);
  return rows;
}

export default async function HqLevelsPage({ searchParams }: PageProps<"/reports/hq">) {
  await requireMenuAccess("reports-hq");
  const params = await searchParams;

  const weeks = await prisma.weeklyStat.findMany({
    where: { categoryKey: "members" },
    select: { weekNumber: true },
    distinct: ["weekNumber"],
    orderBy: { weekNumber: "desc" },
  });
  const weekNumbers = weeks.map((w) => w.weekNumber);
  const defaultWeek = weekNumbers.length > 0 ? weekNumbers[0] : 1;

  const weekParam = Array.isArray(params.week) ? params.week[0] : params.week;
  const selectedWeek = weekParam ? Number(weekParam) : defaultWeek;

  const selectedLimit = parseLimitParam(params.limit, "20");

  const [levelUps, distribution] = await Promise.all([
    getLevelUps(selectedWeek, selectedLimit),
    getHqDistribution(selectedWeek),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">HQ Levels</h1>
      <p className="text-neutral-500 text-sm">
        Members who leveled up this week, and the alliance's HQ level distribution for this week.
      </p>

      <ZoomProvider>
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <form className="flex items-center gap-2 contents">
          <label htmlFor="week" className="font-medium">
            Week
          </label>
          <NumberStepper id="week" name="week" defaultValue={selectedWeek} min={1} listId="hq-known-weeks" />
          <datalist id="hq-known-weeks">
            {weekNumbers.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>

          <LimitSelect defaultValue={selectedLimit} />

          <button type="submit" className="bg-accent text-accent-contrast rounded px-3 py-1">
            Go
          </button>
        </form>

        <ZoomControl />
        <ShareReportButton targetId="hq-content" filename="hq-levels.png" title="HQ Levels" />
      </div>

      <ZoomWrapper contentId="hq-content">
        <div className="flex flex-row flex-nowrap items-start gap-4">
          <div className="border border-neutral-200 rounded overflow-hidden shrink-0">
            <div className="bg-fuchsia-300 px-3 py-1 font-semibold text-center text-neutral-900">
              HQ Level Ups
            </div>
            {levelUps.length === 0 ? (
              <p className="text-neutral-500 text-sm p-2">No level ups this week.</p>
            ) : (
              <DataTable columns={LEVEL_UPS_COLUMNS} rows={levelUpRows(levelUps)} defaultSort={{ key: "thisWeek", direction: "desc" }} dense fitContent />
            )}
          </div>

          <div className="border border-neutral-200 rounded overflow-hidden shrink-0">
            <div className="bg-fuchsia-300 px-3 py-1 font-semibold text-center text-neutral-900">
              HQ Distribution
            </div>
            {distribution.length === 0 ? (
              <p className="text-neutral-500 text-sm p-2">No data for this week.</p>
            ) : (
              <DataTable columns={DISTRIBUTION_COLUMNS} rows={distributionRows(distribution)} defaultSort={{ key: "level", direction: "desc" }} dense fitContent />
            )}
          </div>
        </div>
      </ZoomWrapper>
      </ZoomProvider>
    </div>
  );
}
