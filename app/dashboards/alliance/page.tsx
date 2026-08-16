import { MenuButton } from "@/components/MenuButton";
import { getMenuAccessMap, canSeeMenuItem, requireMenuAccess } from "@/lib/menuAccess";

export default async function AllianceReportsHubPage() {
  const user = await requireMenuAccess("dashboards-alliance");
  const access = await getMenuAccessMap();
  const visible = (key: string) => canSeeMenuItem(access, key, user.role);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Alliance Reports</h1>

      <div className="flex flex-col gap-3 max-w-sm">
        {visible("alliance-detail-report") && (
          <MenuButton
            href="/dashboards/alliance/detail"
            label="Detail Report"
            description="Week range, commander/rank filters, summary or per-week detail"
          />
        )}
        {visible("alliance-graphs") && <MenuButton href="/dashboards/alliance/graphs" label="Graphs" description="Coming soon" />}
        {visible("alliance-member-movement") && (
          <MenuButton
            href="/dashboards/alliance/member-movement"
            label="Member Movement"
            description="Who joined and left between last week and the selected week"
          />
        )}
      </div>
    </div>
  );
}
