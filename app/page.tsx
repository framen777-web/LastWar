import { MenuButton } from "@/components/MenuButton";
import { requireRole } from "@/lib/auth/dal";

export default async function Home() {
  const user = await requireRole(["ADMIN", "LEADER", "MEMBER"]);

  if (user.role === "MEMBER") {
    return (
      <div className="flex flex-col gap-3 max-w-sm mx-auto">
        <MenuButton href="/dashboard" label="My Stats" description="Your stats for a given week" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 max-w-sm mx-auto">
      <MenuButton href="/new-information" label="New Information" description="Import screenshots and view stats" />
      <MenuButton href="/reports" label="Weekly Reports" description="Records, leaderboards and growth for a given week" />
      <MenuButton href="/conductor" label="Conductor" description="Standings, rotation selection, and history" />
      {user.role === "ADMIN" && <MenuButton href="/setup" label="Setup" description="Categories and configuration" />}
    </div>
  );
}
