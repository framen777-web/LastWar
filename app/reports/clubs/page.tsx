import { prisma } from "@/lib/db";
import { ZoomWrapper } from "@/components/ZoomWrapper";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/DataTable";
import { REPORT_NAME_COL_WIDTH, REPORT_VALUE_COL_WIDTH } from "@/lib/reportLayout";
import { requireMenuAccess } from "@/lib/menuAccess";

type ClubRow = { name: string; count: number };

// Achievement tiers based on every weekly VS reading a member has ever had, not just their
// best one - a member shows up in every tier they've ever landed in, with a count of how
// many weeks they've been there. The "vs" category is stored divided by 1000 (see
// prisma/seed.ts's divisor: 1000), so these thresholds are the raw VS score / 1000:
// 200 Club = 200,000,000-299,999,999 raw, 300/400 the next 100m each, 500 Club spans
// 500m-999,999,999, Billionaires Club is >= 1,000,000,000 raw. Ranges don't overlap, so
// each reading belongs to exactly one tier.
const CLUB_TIERS: { key: string; label: string; headerClass: string; min: number; max: number }[] = [
  { key: "200", label: "200 Club", headerClass: "bg-neutral-300", min: 200_000, max: 299_999 },
  { key: "300", label: "300 Club", headerClass: "bg-pink-300", min: 300_000, max: 399_999 },
  { key: "400", label: "400 Club", headerClass: "bg-green-300", min: 400_000, max: 499_999 },
  { key: "500", label: "500 Club", headerClass: "bg-sky-300", min: 500_000, max: 999_999 },
  { key: "billionaires", label: "Billionaires Club", headerClass: "bg-amber-300", min: 1_000_000, max: Infinity },
];

const COLUMNS: DataTableColumn[] = [
  { key: "name", header: "Name", filter: "text", width: REPORT_NAME_COL_WIDTH },
  { key: "count", header: "Times", filter: "number", width: REPORT_VALUE_COL_WIDTH },
];

async function getVsCountsByTier(): Promise<Map<string, ClubRow[]>> {
  const stats = await prisma.weeklyStat.findMany({ where: { categoryKey: "vs" }, include: { member: true } });

  const countsByTier = new Map<string, Map<number, ClubRow>>(CLUB_TIERS.map((t) => [t.key, new Map()]));
  for (const s of stats) {
    const tier = CLUB_TIERS.find((t) => s.value >= t.min && s.value <= t.max);
    if (!tier) continue;
    const members = countsByTier.get(tier.key)!;
    const cur = members.get(s.memberId);
    if (cur) cur.count += 1;
    else members.set(s.memberId, { name: s.member.name, count: 1 });
  }

  const result = new Map<string, ClubRow[]>();
  for (const [key, members] of countsByTier) {
    result.set(key, Array.from(members.values()).sort((a, b) => b.count - a.count));
  }
  return result;
}

function rowsFor(rows: ClubRow[]): DataTableRow[] {
  return rows.map((r, i) => ({
    id: i,
    cells: {
      name: <span className="font-medium">{r.name}</span>,
      count: r.count,
    },
    sortValues: { name: r.name, count: r.count },
  }));
}

export default async function ClubsPage() {
  await requireMenuAccess("reports-clubs");

  const countsByTier = await getVsCountsByTier();
  const byTier = CLUB_TIERS.map((tier) => ({ tier, rows: countsByTier.get(tier.key) ?? [] }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">VS Clubs</h1>
      <p className="text-neutral-500 text-sm">
        Achievement tiers based on every weekly VS reading a member has ever had - shows how many times each
        member has landed in that tier, not just whether they&apos;ve ever reached it.
      </p>

      <ZoomWrapper contentId="clubs-content">
        <div className="flex flex-row flex-nowrap items-start gap-4">
          {byTier.map(({ tier, rows }) => (
            <div key={tier.key} className="border border-neutral-200 rounded overflow-hidden shrink-0">
              <div className={`${tier.headerClass} px-3 py-1 font-semibold text-center text-neutral-900`}>{tier.label}</div>
              {rows.length === 0 ? (
                <p className="text-neutral-500 text-sm p-2">No members yet.</p>
              ) : (
                <DataTable columns={COLUMNS} rows={rowsFor(rows)} defaultSort={{ key: "count", direction: "desc" }} dense fitContent />
              )}
            </div>
          ))}
        </div>
      </ZoomWrapper>
    </div>
  );
}
