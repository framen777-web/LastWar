import { ZoomWrapper, ZoomProvider, ZoomControl } from "@/components/ZoomWrapper";
import { ShareReportButton } from "@/components/ShareReportButton";
import { prisma } from "@/lib/db";
import { requireMenuAccess } from "@/lib/menuAccess";
import { getMemberMovementReport } from "@/lib/dashboards/memberMovement";
import { NumberStepper } from "@/components/NumberStepper";

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-neutral-200 rounded p-4 flex flex-col gap-1 min-w-[8rem]">
      <span className="text-neutral-500 text-xs">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
    </div>
  );
}

function NameList({ title, rows, emptyText }: { title: string; rows: { memberId: number; name: string }[]; emptyText: string }) {
  return (
    <div className="border border-neutral-200 rounded flex flex-col gap-2 p-4 flex-1 min-w-[14rem]">
      <h2 className="font-semibold text-sm">
        {title} ({rows.length})
      </h2>
      {rows.length === 0 ? (
        <p className="text-neutral-500 text-sm">{emptyText}</p>
      ) : (
        <ul className="text-sm flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.memberId}>{r.name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function MemberMovementPage({ searchParams }: PageProps<"/dashboards/alliance/member-movement">) {
  await requireMenuAccess("alliance-member-movement");
  const params = await searchParams;

  const weeks = await prisma.weeklyStat.findMany({ select: { weekNumber: true }, distinct: ["weekNumber"], orderBy: { weekNumber: "desc" } });
  const weekNumbers = weeks.map((w) => w.weekNumber);
  const defaultWeek = weekNumbers.length > 0 ? weekNumbers[0] : 1;

  const weekParam = Array.isArray(params.week) ? params.week[0] : params.week;
  const selectedWeek = weekParam ? Number(weekParam) : defaultWeek;

  const report = await getMemberMovementReport(selectedWeek);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Member Movement</h1>
      <p className="text-neutral-500 text-sm">
        Compares who reported anything (weekly stats or squads) in week {report.priorWeek} against week {report.week} to
        show who joined and who left in between.
      </p>

      <ZoomProvider>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <form className="flex items-center gap-2 text-sm contents">
            <button type="submit" className="bg-accent text-accent-contrast rounded px-3 py-1">
              Go
            </button>
            <label htmlFor="week" className="font-medium">
              Week
            </label>
            <NumberStepper id="week" name="week" defaultValue={selectedWeek} min={1} listId="member-movement-known-weeks" />
            <datalist id="member-movement-known-weeks">
              {weekNumbers.map((w) => (
                <option key={w} value={w} />
              ))}
            </datalist>
          </form>
          <ZoomControl />
          <ShareReportButton targetId="member-movement-content" filename="member-movement.png" title="Member Movement" />
        </div>

        <ZoomWrapper contentId="member-movement-content">
          <div className="flex flex-col gap-4">
            <div className="flex gap-4 flex-wrap">
              <StatCard label={`Opening (week ${report.priorWeek})`} value={report.openingCount} />
              <StatCard label="Left" value={report.left.length} />
              <StatCard label="Joined" value={report.joined.length} />
              <StatCard label={`Closing (week ${report.week})`} value={report.closingCount} />
            </div>
            <div className="flex gap-4 flex-wrap">
              <NameList title="Left" rows={report.left} emptyText="No one left between these weeks." />
              <NameList title="Joined" rows={report.joined} emptyText="No one new joined between these weeks." />
            </div>
          </div>
        </ZoomWrapper>
      </ZoomProvider>
    </div>
  );
}
