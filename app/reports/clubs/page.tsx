import { prisma } from "@/lib/db";
import { ZoomWrapper } from "@/components/ZoomWrapper";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/DataTable";
import { pickNumberFormat, formatWithRule } from "@/lib/format";
import { REPORT_NAME_COL_WIDTH, REPORT_VALUE_COL_WIDTH } from "@/lib/reportLayout";
import { requireMenuAccess } from "@/lib/menuAccess";

type ClubRow = { name: string; value: number; week: number };

// Achievement tiers based on each member's best-ever single-week VS reading (once you've
// hit a tier, you're in it - not tied to current standing). The "vs" category is stored
// divided by 1000 (see prisma/seed.ts's divisor: 1000), so these thresholds are the raw
// VS score / 1000: 200 Club = 200,000,000-299,999,999 raw, 300/400 the next 100m each,
// 500 Club spans 500m-999,999,999, Billionaires Club is >= 1,000,000,000 raw.
// Order matters - checked top-down, first match wins.
const CLUB_TIERS: { key: string; label: string; headerClass: string; min: number; max: number }[] = [
  { key: "billionaires", label: "Billionaires Club", headerClass: "bg-amber-300", min: 1_000_000, max: Infinity },
  { key: "500", label: "500 Club", headerClass: "bg-sky-300", min: 500_000, max: 999_999 },
  { key: "400", label: "400 Club", headerClass: "bg-green-300", min: 400_000, max: 499_999 },
  { key: "300", label: "300 Club", headerClass: "bg-pink-300", min: 300_000, max: 399_999 },
  { key: "200", label: "200 Club", headerClass: "bg-neutral-300", min: 200_000, max: 299_999 },
];

const COLUMNS: DataTableColumn[] = [
  { key: "name", header: "Name", filter: "text", width: REPORT_NAME_COL_WIDTH },
  { key: "week", header: "Week", filter: "number", width: REPORT_VALUE_COL_WIDTH },
  { key: "value", header: "Best VS", filter: "number", width: REPORT_VALUE_COL_WIDTH },
];

async function getBestVsByMember(): Promise<ClubRow[]> {
  const stats = await prisma.weeklyStat.findMany({ where: { categoryKey: "vs" }, include: { member: true } });
  const best = new Map<number, ClubRow>();
  for (const s of stats) {
    const cur = best.get(s.memberId);
    if (!cur || s.value > cur.value) best.set(s.memberId, { name: s.member.name, value: s.value, week: s.weekNumber });
  }
  return Array.from(best.values());
}

function rowsFor(rows: ClubRow[]): DataTableRow[] {
  const rule = pickNumberFormat(rows.map((r) => r.value));
  return rows
    .sort((a, b) => b.value - a.value)
    .map((r, i) => ({
      id: i,
      cells: {
        name: <span className="font-medium">{r.name}</span>,
        week: <span className="text-neutral-500">{r.week}</span>,
        value: formatWithRule(r.value, rule),
      },
      sortValues: { name: r.name, week: r.week, value: r.value },
    }));
}

export default async function ClubsPage() {
  await requireMenuAccess("reports-clubs");

  const bestByMember = await getBestVsByMember();
  const byTier = CLUB_TIERS.map((tier) => ({
    tier,
    rows: bestByMember.filter((r) => r.value >= tier.min && r.value <= tier.max),
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">VS Clubs</h1>
      <p className="text-neutral-500 text-sm">
        Achievement tiers based on each member&apos;s best-ever single-week VS reading - once reached, always a member.
      </p>

      <ZoomWrapper contentId="clubs-content">
        <div className="flex flex-row flex-nowrap items-start gap-4">
          {byTier.map(({ tier, rows }) => (
            <div key={tier.key} className="border border-neutral-200 rounded overflow-hidden shrink-0">
              <div className={`${tier.headerClass} px-3 py-1 font-semibold text-center text-neutral-900`}>{tier.label}</div>
              {rows.length === 0 ? (
                <p className="text-neutral-500 text-sm p-2">No members yet.</p>
              ) : (
                <DataTable columns={COLUMNS} rows={rowsFor(rows)} defaultSort={{ key: "value", direction: "desc" }} dense fitContent />
              )}
            </div>
          ))}
        </div>
      </ZoomWrapper>
    </div>
  );
}
