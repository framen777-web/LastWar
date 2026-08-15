import { MenuButton } from "@/components/MenuButton";
import { requireRole } from "@/lib/auth/dal";

export default async function AllianceReportsHubPage() {
  await requireRole(["ADMIN", "LEADER"]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Alliance Reports</h1>

      <div className="flex flex-col gap-3 max-w-sm">
        <MenuButton href="/dashboards/alliance/detail" label="Detail Report" description="Week range, commander/rank filters, summary or per-week detail" />
        <MenuButton href="/dashboards/alliance/graphs" label="Graphs" description="Coming soon" />
      </div>
    </div>
  );
}
