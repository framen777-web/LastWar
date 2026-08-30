import { MenuButton } from "@/components/MenuButton";
import { getMenuAccessMap, canSeeMenuItem, requireMenuAccess } from "@/lib/menuAccess";

export default async function IndividualDashboardHubPage() {
  const user = await requireMenuAccess("dashboards-individual");
  const access = await getMenuAccessMap();
  const visible = (key: string) => canSeeMenuItem(access, key, user.role);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Individual Dashboard</h1>

      <div className="flex flex-col gap-3 max-w-sm mx-auto">
        {visible("individual-detail-list") && (
          <MenuButton
            href="/dashboards/individual/detail"
            label="Detail List"
            description="Week-by-week stats table"
            icon="📋"
            accentKey="individual-detail"
            index={0}
          />
        )}
        {visible("individual-graphs") && (
          <MenuButton
            href="/dashboards/individual/graphs"
            label="Graphs"
            description="Bar graphs of your own stats over time"
            icon="📈"
            accentKey="individual-graphs"
            index={1}
          />
        )}
        {visible("individual-conductor-statement") && (
          <MenuButton
            href="/dashboards/individual/statement"
            label="Conductor Statement"
            description="Week-by-week breakdown of your conductor points"
            icon="🧾"
            accentKey="individual-conductor-statement"
            index={2}
          />
        )}
      </div>
    </div>
  );
}
