import { MenuButton } from "@/components/MenuButton";
import { requireRole } from "@/lib/auth/dal";
import { getMenuAccessMap, canSeeMenuItem } from "@/lib/menuAccess";

export default async function Home() {
  const user = await requireRole(["ADMIN", "LEADER", "MEMBER"]);
  const access = await getMenuAccessMap();
  const visible = (key: string) => canSeeMenuItem(access, key, user.role);

  return (
    <div className="flex flex-col gap-3 max-w-sm mx-auto">
      {visible("home-my-stats") && (
        <MenuButton
          href="/dashboard"
          label="Detail List"
          description="Your stats for a given week"
          icon="📋"
          accentKey="detail-list"
          index={0}
        />
      )}
      {visible("home-uploads") && (
        <MenuButton
          href="/new-information"
          label="Uploads"
          description="Import screenshots and view stats"
          icon="📤"
          accentKey="uploads"
          index={1}
        />
      )}
      {visible("home-end-of-week-reports") && (
        <MenuButton
          href="/reports"
          label="End of week reports"
          description="Records, leaderboards and growth for a given week"
          icon="📊"
          accentKey="eow-reports"
          index={2}
        />
      )}
      {visible("home-conductor") && (
        <MenuButton
          href="/conductor"
          label="Conductor"
          description="Standings, rotation selection, and history"
          icon="🚂"
          accentKey="conductor"
          index={3}
        />
      )}
      {visible("home-dashboards") && (
        <MenuButton
          href="/dashboards"
          label="Reports"
          description={user.role === "MEMBER" ? "Your growth over time" : "Alliance reports and per-member growth"}
          icon="📈"
          accentKey="reports"
          index={4}
        />
      )}
      {visible("home-settings") && (
        <MenuButton href="/setup" label="Settings" description="Categories and configuration" icon="⚙️" accentKey="settings" index={5} />
      )}
    </div>
  );
}
