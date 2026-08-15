import { MenuButton } from "@/components/MenuButton";
import { getMenuAccessMap, canSeeMenuItem, requireMenuAccess } from "@/lib/menuAccess";

export default async function SetupPage() {
  const user = await requireMenuAccess("home-settings");
  const access = await getMenuAccessMap();
  const visible = (key: string) => canSeeMenuItem(access, key, user.role);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <div className="flex flex-col gap-3 max-w-sm">
        {visible("settings-general") && (
          <MenuButton href="/settings" label="General" description="WhatsApp number and other app preferences" />
        )}
        {visible("settings-users") && (
          <MenuButton href="/setup/users" label="Users" description="Login access, roles, merging, and menu access" />
        )}
        {visible("settings-categories") && (
          <MenuButton href="/categories" label="Categories" description="What gets imported and how it's stored" />
        )}
        {visible("settings-mvp-weighting") && (
          <MenuButton href="/setup/mvp-weights" label="MVP Weighting" description="Scoring weights used by the MVP and R1 reports" />
        )}
        {visible("settings-conductor") && (
          <MenuButton href="/setup/conductor" label="Conductor Settings" description="Cycle length, from-week, and Passenger rules" />
        )}
        {visible("settings-import-history") && (
          <MenuButton href="/setup/import-history" label="Import History" description="Bulk-import weekly stats from a CSV export" />
        )}
        {visible("settings-import-conductor-history") && (
          <MenuButton
            href="/setup/import-conductor-history"
            label="Import Conductor History"
            description="Backfill past Conductor/Passenger selections from a CSV"
          />
        )}
      </div>
    </div>
  );
}
