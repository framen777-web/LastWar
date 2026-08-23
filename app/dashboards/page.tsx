import { MenuButton } from "@/components/MenuButton";
import { getMenuAccessMap, canSeeMenuItem, requireMenuAccess } from "@/lib/menuAccess";

export default async function DashboardsHubPage() {
  const user = await requireMenuAccess("home-dashboards");
  const access = await getMenuAccessMap();
  const visible = (key: string) => canSeeMenuItem(access, key, user.role);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Reports</h1>

      <div className="flex flex-col gap-3 max-w-sm mx-auto">
        {visible("dashboards-individual") && (
          <MenuButton
            href="/dashboards/individual"
            label="Individual Dashboard"
            description={user.role === "MEMBER" ? "Your growth across weeks" : "Any member's growth across weeks"}
            icon="👤"
            accentKey="dashboards-individual"
            index={0}
          />
        )}
        {visible("dashboards-alliance") && (
          <MenuButton
            href="/dashboards/alliance"
            label="Alliance Reports"
            description="Detail report and graphs across a week range"
            icon="🏰"
            accentKey="dashboards-alliance"
            index={1}
          />
        )}
        {visible("home-end-of-week-reports") && (
          <MenuButton
            href="/reports"
            label="End of Week Reports"
            description="Records, leaderboards and growth for a given week"
            icon="📊"
            accentKey="eow-reports"
            index={2}
          />
        )}
        {visible("dashboards-season") && (
          <MenuButton
            href="/dashboards/season"
            label="Season Reports"
            description="Season standings and reward box distribution"
            icon="🎁"
            accentKey="dashboards-season"
            index={3}
          />
        )}
      </div>
    </div>
  );
}
