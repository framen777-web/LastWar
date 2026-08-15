import { MenuButton } from "@/components/MenuButton";
import { requireRole } from "@/lib/auth/dal";
import { getMenuAccessMap, canSeeMenuItem } from "@/lib/menuAccess";

export default async function DashboardsHubPage() {
  const user = await requireRole(["ADMIN", "LEADER", "MEMBER"]);
  const access = await getMenuAccessMap();
  const visible = (key: string) => canSeeMenuItem(access, key, user.role);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Reports</h1>

      <div className="flex flex-col gap-3 max-w-sm">
        {visible("dashboards-individual") && (
          <MenuButton
            href="/dashboards/individual"
            label="Individual Dashboard"
            description={user.role === "MEMBER" ? "Your growth across weeks" : "Any member's growth across weeks"}
          />
        )}
        {visible("dashboards-alliance") && (
          <MenuButton href="/dashboards/alliance" label="Alliance Reports" description="Detail report and graphs across a week range" />
        )}
      </div>
    </div>
  );
}
