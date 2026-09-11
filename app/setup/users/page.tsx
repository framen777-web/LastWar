import { MenuButton } from "@/components/MenuButton";
import { requireMenuAccess, getMenuAccessMap, canSeeMenuItem } from "@/lib/menuAccess";

export default async function UsersHubPage() {
  const user = await requireMenuAccess("settings-users");
  const access = await getMenuAccessMap();
  const visible = (key: string) => canSeeMenuItem(access, key, user.role);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Users</h1>
      <div className="flex flex-col gap-3 max-w-sm mx-auto">
        {visible("users-list") && (
          <MenuButton
            href="/setup/users/list"
            label="Users"
            description="Login access, roles, and active status per member"
            icon="👤"
            accentKey="users-list"
            index={0}
          />
        )}
        {visible("users-merge") && (
          <MenuButton
            href="/setup/users/merge"
            label="Merge"
            description="Combine two member rows that turned out to be the same person"
            icon="🔗"
            accentKey="users-merge"
            index={1}
          />
        )}
        {visible("users-aliases") && (
          <MenuButton
            href="/setup/users/aliases"
            label="Aliases"
            description="View, add, and remove the confirmed name variants imports match against"
            icon="🏷️"
            accentKey="users-aliases"
            index={2}
          />
        )}
        {visible("users-menu-access") && (
          <MenuButton
            href="/setup/users/menu-access"
            label="Menu Access"
            description="Which roles can see each menu button"
            icon="🔐"
            accentKey="users-menu-access"
            index={3}
          />
        )}
      </div>
    </div>
  );
}
