import { MenuButton } from "@/components/MenuButton";
import { getMenuAccessMap, canSeeMenuItem, requireMenuAccess } from "@/lib/menuAccess";

export default async function IndividualDashboardHubPage() {
  const user = await requireMenuAccess("dashboards-individual");
  const access = await getMenuAccessMap();
  const visible = (key: string) => canSeeMenuItem(access, key, user.role);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Individual Dashboard</h1>

      <div className="flex flex-col gap-3 max-w-sm">
        {visible("individual-detail-list") && (
          <MenuButton href="/dashboards/individual/detail" label="Detail List" description="Week-by-week stats table" />
        )}
        {visible("individual-graphs") && (
          <MenuButton href="/dashboards/individual/graphs" label="Graphs" description="Bar graphs of your own stats over time" />
        )}
      </div>
    </div>
  );
}
