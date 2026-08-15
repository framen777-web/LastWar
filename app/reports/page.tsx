import { MenuButton } from "@/components/MenuButton";
import { getMenuAccessMap, canSeeMenuItem, requireMenuAccess } from "@/lib/menuAccess";

export default async function ReportsIndexPage() {
  const user = await requireMenuAccess("home-end-of-week-reports");
  const access = await getMenuAccessMap();
  const visible = (key: string) => canSeeMenuItem(access, key, user.role);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">End of Week Reports</h1>
      <div className="flex flex-col gap-3 max-w-sm">
        {visible("reports-hq") && (
          <MenuButton href="/reports/hq" label="HQ Levels" description="Members who leveled up this week, and the HQ level distribution" />
        )}
        {visible("reports-leaderboard") && (
          <MenuButton
            href="/reports/leaderboard"
            label="Leaderboards"
            description="Top 20 by week, trailing 5/10 weeks, improvement, and all-time"
          />
        )}
        {visible("reports-new-records") && (
          <MenuButton href="/reports/new-records" label="New Records" description="Members who beat their personal best this week" />
        )}
        {visible("reports-clubs") && (
          <MenuButton href="/reports/clubs" label="VS Clubs" description="Achievement tiers by best-ever VS reading" />
        )}
        {visible("reports-squads") && (
          <MenuButton
            href="/reports/squad-power"
            label="Squads"
            description="Top squad type, 3-squad power, and week-over-week growth"
          />
        )}
        {visible("reports-mvp") && (
          <MenuButton href="/reports/mvp" label="MVP Report" description="Weighted MVP leaderboard for a week" />
        )}
        {visible("reports-r1") && (
          <MenuButton href="/reports/r1" label="R1 Report" description="Rank-filtered members, VS/MVP trend, Promote/Watch" />
        )}
      </div>
    </div>
  );
}
