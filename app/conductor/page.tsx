import { MenuButton } from "@/components/MenuButton";
import { requireMenuAccess, getMenuAccessMap, canSeeMenuItem } from "@/lib/menuAccess";

export default async function ConductorPage() {
  const user = await requireMenuAccess("home-conductor");
  const access = await getMenuAccessMap();
  const visible = (key: string) => canSeeMenuItem(access, key, user.role);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Conductor</h1>

      <div className="flex flex-col gap-3 max-w-sm mx-auto">
        {visible("conductor-select") && (
          <MenuButton
            href="/conductor/select"
            label="Select Conductors & Passengers"
            description="Generate and confirm the next rotation"
            icon="🎫"
            accentKey="conductor-select"
            index={0}
          />
        )}
        {visible("conductor-history") && (
          <MenuButton
            href="/conductor/history"
            label="History"
            description="Past confirmed rotations"
            icon="📜"
            accentKey="conductor-history"
            index={1}
          />
        )}
        {visible("conductor-standings") && (
          <MenuButton
            href="/conductor/standings"
            label="Standings"
            description="Accumulated points per member"
            icon="🏆"
            accentKey="conductor-standings"
            index={2}
          />
        )}
      </div>
    </div>
  );
}
