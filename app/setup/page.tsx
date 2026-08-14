import { MenuButton } from "@/components/MenuButton";
import { requireAdmin } from "@/lib/auth/dal";

export default async function SetupPage() {
  await requireAdmin();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Setup</h1>
      <div className="flex flex-col gap-3 max-w-sm">
        <MenuButton href="/categories" label="Categories" description="What gets imported and how it's stored" />
        <MenuButton href="/settings" label="Settings" description="WhatsApp number and other app preferences" />
        <MenuButton href="/setup/mvp-weights" label="MVP Weighting" description="Scoring weights used by the MVP and R1 reports" />
        <MenuButton href="/setup/conductor" label="Conductor Settings" description="Cycle length, from-week, and Passenger rules" />
        <MenuButton href="/setup/users" label="Users" description="Login access, roles, and active status per member" />
        <MenuButton href="/setup/import-history" label="Import History" description="Bulk-import weekly stats from a CSV export" />
        <MenuButton href="/setup/import-conductor-history" label="Import Conductor History" description="Backfill past Conductor/Passenger selections from a CSV" />
      </div>
    </div>
  );
}
