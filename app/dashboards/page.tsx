import { MenuButton } from "@/components/MenuButton";
import { requireRole } from "@/lib/auth/dal";

export default async function DashboardsHubPage() {
  const user = await requireRole(["ADMIN", "LEADER", "MEMBER"]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Dashboards</h1>

      <div className="flex flex-col gap-3 max-w-sm">
        {/* Same reports, not rebuilt - this just gives them a second entry point. */}
        {(user.role === "ADMIN" || user.role === "LEADER") && (
          <MenuButton href="/reports" label="Alliance Reports" description="Records, leaderboards and growth for a given week" />
        )}
        <MenuButton
          href="/dashboards/individual"
          label="Individual Dashboard"
          description={user.role === "MEMBER" ? "Your growth across weeks" : "Any member's growth across weeks"}
        />
      </div>
    </div>
  );
}
