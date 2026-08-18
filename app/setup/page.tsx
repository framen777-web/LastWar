import { MenuButton } from "@/components/MenuButton";
import { getMenuAccessMap, canSeeMenuItem, requireMenuAccess } from "@/lib/menuAccess";

export default async function SetupPage() {
  const user = await requireMenuAccess("home-settings");
  const access = await getMenuAccessMap();
  const visible = (key: string) => canSeeMenuItem(access, key, user.role);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <div className="flex flex-col gap-3 max-w-sm mx-auto">
        {visible("settings-general") && (
          <MenuButton
            href="/settings"
            label="General"
            description="Password rules, week 1 start date, and API key"
            icon="🔧"
            accentKey="setup-general"
            index={0}
          />
        )}
        {visible("settings-users") && (
          <MenuButton
            href="/setup/users"
            label="Users"
            description="Login access, roles, merging, and menu access"
            icon="👥"
            accentKey="setup-users"
            index={1}
          />
        )}
        {visible("settings-categories") && (
          <MenuButton
            href="/categories"
            label="Categories"
            description="What gets imported and how it's stored"
            icon="🗂️"
            accentKey="setup-categories"
            index={2}
          />
        )}
        {visible("settings-mvp-weighting") && (
          <MenuButton
            href="/setup/mvp-weights"
            label="MVP Weighting"
            description="Scoring weights used by the MVP and R1 reports"
            icon="⚖️"
            accentKey="setup-mvp-weighting"
            index={3}
          />
        )}
        {visible("settings-conductor") && (
          <MenuButton
            href="/setup/conductor"
            label="Conductor Settings"
            description="Cycle length, from-week, and Passenger rules"
            icon="🎚️"
            accentKey="setup-conductor"
            index={4}
          />
        )}
        {visible("settings-import-history") && (
          <MenuButton
            href="/setup/import-history"
            label="Import History"
            description="Bulk-import weekly stats from a CSV export"
            icon="📥"
            accentKey="setup-import-history"
            index={5}
          />
        )}
        {visible("settings-import-conductor-history") && (
          <MenuButton
            href="/setup/import-conductor-history"
            label="Import Conductor History"
            description="Backfill past Conductor/Passenger selections from a CSV"
            icon="🛤️"
            accentKey="setup-import-conductor-history"
            index={6}
          />
        )}
      </div>
    </div>
  );
}
