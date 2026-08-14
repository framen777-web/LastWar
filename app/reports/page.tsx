import { MenuButton } from "@/components/MenuButton";
import { requireRole } from "@/lib/auth/dal";

export default async function ReportsIndexPage() {
  await requireRole(["ADMIN", "LEADER"]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Weekly Reports</h1>
      <div className="flex flex-col gap-3 max-w-sm">
        <MenuButton
          href="/reports/new-records"
          label="New Records"
          description="Members who beat their personal best this week"
        />
        <MenuButton
          href="/reports/leaderboard"
          label="Leaderboards"
          description="Top 20 by week, trailing 5/10 weeks, improvement, and all-time"
        />
        <MenuButton
          href="/reports/hq"
          label="HQ Levels"
          description="Members who leveled up this week, and the HQ level distribution"
        />
        <MenuButton
          href="/reports/squad-power"
          label="Squad Power & Growth"
          description="Top squad type, 3-squad power, and week-over-week growth"
        />
        <MenuButton
          href="/reports/mvp"
          label="MVP Report"
          description="Weighted MVP leaderboard for a week"
        />
        <MenuButton
          href="/reports/r1"
          label="R1 Report"
          description="Rank-filtered members, VS/MVP trend, Promote/Watch"
        />
        <MenuButton
          href="/reports/clubs"
          label="VS Clubs"
          description="Achievement tiers by best-ever VS reading"
        />
      </div>
    </div>
  );
}
