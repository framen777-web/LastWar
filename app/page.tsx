import { MenuButton } from "@/components/MenuButton";
import { requireRole } from "@/lib/auth/dal";

export default async function Home() {
  const user = await requireRole(["ADMIN", "LEADER", "MEMBER"]);

  if (user.role === "MEMBER") {
    return (
      <div className="flex flex-col gap-3 max-w-sm mx-auto">
        <MenuButton href="/dashboard" label="My Stats" description="Your stats for a given week" />
        <MenuButton href="/dashboards" label="Reports" description="Your growth over time" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 max-w-sm mx-auto">
      <MenuButton href="/new-information" label="Uploads" description="Import screenshots and view stats" />
      <MenuButton href="/reports" label="End of week reports" description="Records, leaderboards and growth for a given week" />
      <MenuButton href="/conductor" label="Conductor" description="Standings, rotation selection, and history" />
      <MenuButton href="/dashboards" label="Reports" description="Alliance reports and per-member growth" />
      {user.role === "ADMIN" && <MenuButton href="/setup" label="Settings" description="Categories and configuration" />}
    </div>
  );
}
