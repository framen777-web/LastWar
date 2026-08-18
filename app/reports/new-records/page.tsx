import { prisma } from "@/lib/db";
import { ZoomWrapper, ZoomProvider, ZoomControl } from "@/components/ZoomWrapper";
import { ShareReportButton } from "@/components/ShareReportButton";
import { NumberStepper } from "@/components/NumberStepper";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/DataTable";
import { pickNumberFormat, formatWithRule } from "@/lib/format";
import { requireMenuAccess } from "@/lib/menuAccess";
import { REPORT_NAME_COL_WIDTH, REPORT_VALUE_COL_WIDTH, parseLimitParam, applyLimit } from "@/lib/reportLayout";
import { LimitSelect } from "@/components/LimitSelect";

const RECORD_COLUMNS: DataTableColumn[] = [
  { key: "name", header: "Member", filter: "text", width: REPORT_NAME_COL_WIDTH },
  { key: "newValue", header: "New", filter: "number", width: REPORT_VALUE_COL_WIDTH },
  { key: "oldValue", header: "Old", filter: "number", width: REPORT_VALUE_COL_WIDTH },
  { key: "increasePct", header: "Increase", filter: "number", width: REPORT_VALUE_COL_WIDTH },
];

function recordRows(records: RecordRow[]): DataTableRow[] {
  const newRule = pickNumberFormat(records.map((r) => r.newValue));
  const oldRule = pickNumberFormat(records.map((r) => r.oldValue));
  return records.map((r, i) => ({
    id: i,
    cells: {
      name: <span className="font-medium">{r.name}</span>,
      newValue: formatWithRule(r.newValue, newRule),
      oldValue: <span className="text-neutral-500">{formatWithRule(r.oldValue, oldRule)}</span>,
      increasePct: <span className="text-green-700">{r.increasePct}%</span>,
    },
    sortValues: { name: r.name, newValue: r.newValue, oldValue: r.oldValue, increasePct: r.increasePct },
  }));
}

const NEW_RECORDS_CATEGORIES = [
  { key: "vs", label: "New VS Records", headerClass: "bg-green-300" },
  { key: "desert_storm", label: "New DS Records", headerClass: "bg-pink-300" },
  { key: "donations", label: "New Donation Records", headerClass: "bg-amber-300" },
  { key: "kills", label: "New Kill Records", headerClass: "bg-sky-300" },
];

type RecordRow = { name: string; newValue: number; oldValue: number; increasePct: number };

async function getNewRecords(categoryKey: string, cumulative: boolean, week: number, limit: string): Promise<RecordRow[]> {
  const stats = await prisma.weeklyStat.findMany({
    where: { categoryKey, weekNumber: { lte: week } },
    include: { member: true },
    orderBy: { weekNumber: "asc" },
  });

  // Kills is a lifetime-cumulative reading in-game (never resets), so the raw stored
  // value only ever goes up - every member would "beat their record" every single week.
  // Convert to the gain since each member's previous reading first, same conversion the
  // Kills Leaderboard uses, so "personal best" means best *week*, not just "most kills
  // ever accumulated by that point."
  type Point = { weekNumber: number; memberId: number; name: string; value: number };
  let points: Point[];
  if (cumulative) {
    const lastByMember = new Map<number, number>();
    points = [];
    for (const s of stats) {
      const prev = lastByMember.get(s.memberId);
      if (prev !== undefined) points.push({ weekNumber: s.weekNumber, memberId: s.memberId, name: s.member.name, value: s.value - prev });
      lastByMember.set(s.memberId, s.value);
    }
  } else {
    points = stats.map((s) => ({ weekNumber: s.weekNumber, memberId: s.memberId, name: s.member.name, value: s.value }));
  }

  const byMember = new Map<number, { name: string; thisWeek?: number; bestBefore?: number }>();
  for (const p of points) {
    const entry = byMember.get(p.memberId) ?? { name: p.name };
    if (p.weekNumber === week) {
      entry.thisWeek = p.value;
    } else {
      entry.bestBefore = Math.max(entry.bestBefore ?? -Infinity, p.value);
    }
    byMember.set(p.memberId, entry);
  }

  const records: RecordRow[] = [];
  for (const entry of byMember.values()) {
    if (
      entry.thisWeek !== undefined &&
      entry.bestBefore !== undefined &&
      entry.bestBefore > 0 &&
      entry.thisWeek > entry.bestBefore
    ) {
      records.push({
        name: entry.name,
        newValue: entry.thisWeek,
        oldValue: entry.bestBefore,
        increasePct: Math.round(((entry.thisWeek - entry.bestBefore) / entry.bestBefore) * 100),
      });
    }
  }

  records.sort((a, b) => b.newValue - a.newValue);
  return applyLimit(records, limit);
}

export default async function NewRecordsPage({ searchParams }: PageProps<"/reports/new-records">) {
  await requireMenuAccess("reports-new-records");
  const params = await searchParams;

  const weeks = await prisma.weeklyStat.findMany({
    select: { weekNumber: true },
    distinct: ["weekNumber"],
    orderBy: { weekNumber: "desc" },
  });
  const weekNumbers = weeks.map((w) => w.weekNumber);
  const defaultWeek = weekNumbers.length > 0 ? weekNumbers[0] : 1;

  const weekParam = Array.isArray(params.week) ? params.week[0] : params.week;
  const selectedWeek = weekParam ? Number(weekParam) : defaultWeek;

  const selectedLimit = parseLimitParam(params.limit, "20");

  const categoryRows = await prisma.category.findMany({
    where: { key: { in: NEW_RECORDS_CATEGORIES.map((c) => c.key) } },
    select: { key: true, cumulative: true },
  });
  const cumulativeByKey = new Map(categoryRows.map((c) => [c.key, c.cumulative]));

  const newRecordsByCategory = await Promise.all(
    NEW_RECORDS_CATEGORIES.map((c) => getNewRecords(c.key, cumulativeByKey.get(c.key) ?? false, selectedWeek, selectedLimit))
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">New Records</h1>
      <p className="text-neutral-500 text-sm">
        Members who beat their own personal best this week, for each category.
      </p>

      <ZoomProvider>
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <form className="flex items-center gap-2 contents">
          <button type="submit" className="bg-accent text-accent-contrast rounded px-3 py-1">
            Go
          </button>

          <label htmlFor="week" className="font-medium">
            Week
          </label>
          <NumberStepper id="week" name="week" defaultValue={selectedWeek} min={1} listId="reports-known-weeks" />
          <datalist id="reports-known-weeks">
            {weekNumbers.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>

          <LimitSelect defaultValue={selectedLimit} />
        </form>

        <ZoomControl />
        <ShareReportButton targetId="new-records-content" filename="new-records.png" title="New Records" />
      </div>

      <ZoomWrapper contentId="new-records-content">
        <div className="flex flex-row flex-nowrap items-start gap-4">
          {NEW_RECORDS_CATEGORIES.map((c, i) => {
            const records = newRecordsByCategory[i];
            return (
              <div key={c.key} className="border border-neutral-200 rounded overflow-hidden shrink-0">
                <div className={`${c.headerClass} px-3 py-1 font-semibold text-center text-neutral-900`}>{c.label}</div>
                {records.length === 0 ? (
                  <p className="text-neutral-500 text-sm p-2">No new records this week.</p>
                ) : (
                  <DataTable
                    columns={RECORD_COLUMNS}
                    rows={recordRows(records)}
                    defaultSort={{ key: "newValue", direction: "desc" }}
                    dense
                    fitContent
                  />
                )}
              </div>
            );
          })}
        </div>
      </ZoomWrapper>
      </ZoomProvider>
    </div>
  );
}
