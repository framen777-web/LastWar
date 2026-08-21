import { computeStandings } from "@/lib/conductor/points";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/DataTable";
import { requireMenuAccess } from "@/lib/menuAccess";

const COLUMNS: DataTableColumn[] = [
  { key: "member", header: "Member", filter: "text" },
  { key: "accumulated", header: "Accumulated", filter: "number" },
  { key: "lessSelected", header: "Less Selected", filter: "number" },
  { key: "total", header: "Total", filter: "number" },
];

export default async function ConductorStandingsPage() {
  await requireMenuAccess("conductor-standings");

  const standings = await computeStandings();

  const rows: DataTableRow[] = standings.map((s) => ({
    id: s.memberId,
    cells: {
      member: <span className="font-medium">{s.memberName}</span>,
      accumulated: s.accumulated.toFixed(2),
      lessSelected: <span className="text-neutral-500">{s.lessSelected.toFixed(2)}</span>,
      total: <span className="font-semibold">{s.total.toFixed(2)}</span>,
    },
    sortValues: { member: s.memberName, accumulated: s.accumulated, lessSelected: s.lessSelected, total: s.total },
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Standings</h1>

      {standings.length === 0 ? (
        <p className="text-neutral-500 text-sm">No conductor points configured yet - set some up in Setup → Categories.</p>
      ) : (
        <DataTable columns={COLUMNS} rows={rows} defaultSort={{ key: "total", direction: "desc" }} />
      )}
    </div>
  );
}
