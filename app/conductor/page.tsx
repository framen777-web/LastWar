import { computeStandings } from "@/lib/conductor/points";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/DataTable";
import { MenuButton } from "@/components/MenuButton";
import { requireRole } from "@/lib/auth/dal";

const COLUMNS: DataTableColumn[] = [
  { key: "member", header: "Member", filter: "text" },
  { key: "accumulated", header: "Accumulated", filter: "number" },
  { key: "lessSelected", header: "Less Selected", filter: "number" },
  { key: "total", header: "Total", filter: "number" },
];

export default async function ConductorPage() {
  await requireRole(["ADMIN", "LEADER"]);

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
      <h1 className="text-xl font-semibold">Conductor</h1>

      <div className="flex flex-col gap-3 max-w-sm">
        <MenuButton href="/conductor/select" label="Select Conductors & Passengers" description="Generate and confirm the next rotation" />
        <MenuButton href="/conductor/history" label="History" description="Past confirmed rotations" />
      </div>

      <h2 className="text-lg font-semibold">Standings</h2>
      {standings.length === 0 ? (
        <p className="text-neutral-500 text-sm">No conductor points configured yet - set some up in Setup → Categories.</p>
      ) : (
        <DataTable columns={COLUMNS} rows={rows} defaultSort={{ key: "total", direction: "desc" }} />
      )}
    </div>
  );
}
