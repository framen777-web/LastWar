import { MenuButton } from "@/components/MenuButton";
import { getMenuAccessMap, canSeeMenuItem, requireMenuAccess } from "@/lib/menuAccess";

export default async function ReportsIndexPage() {
  const user = await requireMenuAccess("home-end-of-week-reports");
  const access = await getMenuAccessMap();
  const visible = (key: string) => canSeeMenuItem(access, key, user.role);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">End of Week Reports</h1>
      <div className="flex flex-col gap-3 max-w-sm mx-auto">
        {visible("reports-hq") && (
          <MenuButton
            href="/reports/hq"
            label="HQ Levels"
            description="Members who leveled up this week, and the HQ level distribution"
            icon="🏢"
            accentKey="reports-hq"
            index={0}
          />
        )}
        {visible("reports-leaderboard") && (
          <MenuButton
            href="/reports/leaderboard"
            label="Leaderboards"
            description="Top 20 by week, trailing 5/10 weeks, improvement, and all-time"
            icon="🏆"
            accentKey="reports-leaderboard"
            index={1}
          />
        )}
        {visible("reports-new-records") && (
          <MenuButton
            href="/reports/new-records"
            label="New Records"
            description="Members who beat their personal best this week"
            icon="⭐"
            accentKey="reports-new-records"
            index={2}
          />
        )}
        {visible("reports-clubs") && (
          <MenuButton
            href="/reports/clubs"
            label="VS Clubs"
            description="Achievement tiers by how many times each member has reached them"
            icon="🛡️"
            accentKey="reports-clubs"
            index={3}
          />
        )}
        {visible("reports-squads") && (
          <MenuButton
            href="/reports/squad-power"
            label="Squads"
            description="Top squad type, 3-squad power, and week-over-week growth"
            icon="🎯"
            accentKey="reports-squads"
            index={4}
          />
        )}
        {visible("reports-mvp") && (
          <MenuButton
            href="/reports/mvp"
            label="MVP Report"
            description="Weighted MVP leaderboard for a week"
            icon="🌟"
            accentKey="reports-mvp"
            index={5}
          />
        )}
        {visible("reports-r1") && (
          <MenuButton
            href="/reports/r1"
            label="R1 Report"
            description="Rank-filtered members, VS/MVP trend, Promote/Watch"
            icon="🎖️"
            accentKey="reports-r1"
            index={6}
          />
        )}
        {visible("reports-season") && (
          <MenuButton
            href="/reports/season"
            label="Season Report"
            description="Season Points ranking and reward box distribution"
            icon="🎁"
            accentKey="reports-season"
            index={7}
          />
        )}
      </div>
    </div>
  );
}
