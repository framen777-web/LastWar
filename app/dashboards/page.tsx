import { MenuButton } from "@/components/MenuButton";
import { requireRole } from "@/lib/auth/dal";

export default async function DashboardsHubPage() {
  const user = await requireRole(["ADMIN", "LEADER", "MEMBER"]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Reports</h1>

      <div className="flex flex-col gap-3 max-w-sm">
        <MenuButton
          href="/dashboards/individual"
          label="Individual Dashboard"
          description={user.role === "MEMBER" ? "Your growth across weeks" : "Any member's growth across weeks"}
        />
        {(user.role === "ADMIN" || user.role === "LEADER") && (
          <MenuButton href="/dashboards/alliance" label="Alliance Reports" description="Detail report and graphs across a week range" />
        )}
      </div>
    </div>
  );
}
