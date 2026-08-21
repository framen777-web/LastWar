import { prisma } from "@/lib/db";
import { ZoomWrapper, ZoomProvider, ZoomControl } from "@/components/ZoomWrapper";
import { ShareReportButton } from "@/components/ShareReportButton";
import { NumberStepper } from "@/components/NumberStepper";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/DataTable";
import { pickNumberFormat, formatWithRule } from "@/lib/format";
import { requireMenuAccess } from "@/lib/menuAccess";
import { REPORT_NAME_COL_WIDTH, REPORT_VALUE_COL_WIDTH, parseLimitParam, applyLimit } from "@/lib/reportLayout";
import { LimitSelect } from "@/components/LimitSelect";

const SQUAD_POWER_COLUMNS: DataTableColumn[] = [
  { key: "name", header: "Commander", filter: "text", width: REPORT_NAME_COL_WIDTH },
  { key: "thisSum", header: "3 Squad power", filter: "number", width: REPORT_VALUE_COL_WIDTH },
  { key: "thisTop", header: "Top Squad", filter: "number", width: REPORT_VALUE_COL_WIDTH },
  { key: "priorSum", header: "3 Squad power (last)", filter: "number", width: REPORT_VALUE_COL_WIDTH },
  { key: "priorTop", header: "Top Squad (last)", filter: "number", width: REPORT_VALUE_COL_WIDTH },
  { key: "growth", header: "Growth", filter: "number", width: REPORT_VALUE_COL_WIDTH },
  { key: "squadType", header: "Squad Type", filter: "text", width: REPORT_VALUE_COL_WIDTH },
];

function squadPowerRows(rows: Row[]): DataTableRow[] {
  const thisSumRule = pickNumberFormat(rows.map((r) => r.thisStats.threeSum));
  const thisTopRule = pickNumberFormat(rows.map((r) => r.thisStats.topValue));
  const priorSumRule = pickNumberFormat(rows.map((r) => r.priorStats.threeSum));
  const priorTopRule = pickNumberFormat(rows.map((r) => r.priorStats.topValue));
  return rows.map((r, i) => {
    const cells: Record<string, React.ReactNode> = {
      name: <span className="font-medium">{r.name}</span>,
      thisSum: formatWithRule(r.thisStats.threeSum, thisSumRule),
      thisTop: formatWithRule(r.thisStats.topValue, thisTopRule),
      priorSum: <span className="text-neutral-500">{formatWithRule(r.priorStats.threeSum, priorSumRule)}</span>,
      priorTop: <span className="text-neutral-500">{formatWithRule(r.priorStats.topValue, priorTopRule)}</span>,
      growth: (
        <span className={r.growth !== null && r.growth < 0 ? "text-red-600" : "text-green-700"}>
          {r.growth === null ? "—" : `${r.growth.toFixed(2)}%`}
        </span>
      ),
      squadType: r.squadType ?? "—",
    };
    const sortValues: Record<string, number | string> = {
      name: r.name,
      thisSum: r.thisStats.threeSum,
      thisTop: r.thisStats.topValue,
      priorSum: r.priorStats.threeSum,
      priorTop: r.priorStats.topValue,
      squadType: r.squadType ?? "",
    };
    if (r.growth !== null) sortValues.growth = r.growth;
    return { id: i, cells, sortValues };
  });
}

type SquadFields = { air?: number | null; tank?: number | null; missile?: number | null; fourth?: number | null };
type SquadStats = { topValue: number; topType: string | null; threeSum: number };

function computeSquadStats(fields: SquadFields | null): SquadStats {
  if (!fields) return { topValue: 0, topType: null, threeSum: 0 };
  const entries: [string, number][] = [
    ["Air", fields.air ?? 0],
    ["Tank", fields.tank ?? 0],
    ["Missile", fields.missile ?? 0],
    ["Fourth", fields.fourth ?? 0],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  const topValue = entries[0][1];
  const topType = topValue > 0 ? entries[0][0] : null;
  const threeSum = entries[0][1] + entries[1][1] + entries[2][1];
  return { topValue, topType, threeSum };
}

type Row = {
  name: string;
  thisStats: SquadStats;
  priorStats: SquadStats;
  growth: number | null;
  squadType: string | null;
};

async function getSquadPowerReport(week: number, limit: string): Promise<{ rows: Row[]; priorWeek: number | null }> {
  const category = await prisma.category.findUnique({ where: { key: "squads" } });
  if (!category) return { rows: [], priorWeek: null };

  const priorWeekRow = await prisma.categoryRecord.findFirst({
    where: { categoryId: category.id, weekNumber: { lt: week } },
    orderBy: { weekNumber: "desc" },
    select: { weekNumber: true },
  });
  const priorWeek = priorWeekRow?.weekNumber ?? null;

  const thisWeekRecords = await prisma.categoryRecord.findMany({
    where: { categoryId: category.id, weekNumber: week },
    include: { member: true },
  });
  const priorWeekRecords =
    priorWeek !== null
      ? await prisma.categoryRecord.findMany({
          where: { categoryId: category.id, weekNumber: priorWeek },
          include: { member: true },
        })
      : [];

  const thisByMember = new Map(thisWeekRecords.map((r) => [r.memberId, r]));
  const priorByMember = new Map(priorWeekRecords.map((r) => [r.memberId, r]));
  // Only members who reported this week (the indicator week) - someone with data only in
  // the prior week has since left and shouldn't still show up here.
  const allMemberIds = new Set(thisByMember.keys());

  const rows: Row[] = [];
  for (const memberId of allMemberIds) {
    const thisRecord = thisByMember.get(memberId);
    const priorRecord = priorByMember.get(memberId);
    const name = thisRecord?.member.name ?? priorRecord?.member.name ?? "?";

    const thisStats = computeSquadStats(thisRecord ? JSON.parse(thisRecord.fields) : null);
    const priorStats = computeSquadStats(priorRecord ? JSON.parse(priorRecord.fields) : null);

    let growth: number | null = null;
    if (priorRecord && priorStats.threeSum > 0) {
      growth = ((thisStats.threeSum - priorStats.threeSum) / priorStats.threeSum) * 100;
    }

    rows.push({ name, thisStats, priorStats, growth, squadType: thisStats.topType ?? priorStats.topType });
  }

  rows.sort((a, b) => b.priorStats.threeSum - a.priorStats.threeSum);

  return { rows: applyLimit(rows, limit), priorWeek };
}

export default async function SquadPowerPage({ searchParams }: PageProps<"/reports/squad-power">) {
  await requireMenuAccess("reports-squads");
  const params = await searchParams;

  const weeks = await prisma.categoryRecord.findMany({
    where: { category: { key: "squads" } },
    select: { weekNumber: true },
    distinct: ["weekNumber"],
    orderBy: { weekNumber: "desc" },
  });
  const weekNumbers = weeks.map((w) => w.weekNumber);
  const defaultWeek = weekNumbers.length > 0 ? weekNumbers[0] : 1;

  const weekParam = Array.isArray(params.week) ? params.week[0] : params.week;
  const selectedWeek = weekParam ? Number(weekParam) : defaultWeek;

  const selectedLimit = parseLimitParam(params.limit, "all");

  const { rows, priorWeek } = await getSquadPowerReport(selectedWeek, selectedLimit);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Squad Power &amp; Growth</h1>
      <p className="text-neutral-500 text-sm">
        Top Squad = a member&apos;s highest self-reported troop type. 3 Squad power = the sum of their top 3 of
        4 troop types. Growth compares 3 Squad power to {priorWeek ?? "the previous"} week.
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
          <NumberStepper id="week" name="week" defaultValue={selectedWeek} min={1} listId="squad-power-known-weeks" />
          <datalist id="squad-power-known-weeks">
            {weekNumbers.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>

          <LimitSelect defaultValue={selectedLimit} />
        </form>

        <ZoomControl />
        <ShareReportButton targetId="squad-power-content" filename="squad-power.png" title="Squad Power & Growth" />
      </div>

      <ZoomWrapper contentId="squad-power-content">
        {rows.length === 0 ? (
          <p className="text-neutral-500 text-sm">No squad data for week {selectedWeek} yet.</p>
        ) : (
          <DataTable columns={SQUAD_POWER_COLUMNS} rows={squadPowerRows(rows)} defaultSort={{ key: "thisSum", direction: "desc" }} dense fitContent />
        )}
      </ZoomWrapper>
      </ZoomProvider>
    </div>
  );
}
