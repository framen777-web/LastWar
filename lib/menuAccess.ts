import { prisma } from "@/lib/db";
import type { Role } from "@/lib/auth/roles";

export type MenuAccessMap = Record<string, Role[]>;

// Fail-closed: a key missing from the table (a button never registered via prisma/seed.ts)
// is invisible to everyone rather than accidentally shown to everyone - a forgotten seed
// entry is then obviously broken (button missing) rather than a silent over-exposure.
export async function getMenuAccessMap(): Promise<MenuAccessMap> {
  const items = await prisma.menuItem.findMany();
  const map: MenuAccessMap = {};
  for (const item of items) {
    try {
      const parsed = JSON.parse(item.roles);
      if (Array.isArray(parsed)) map[item.key] = parsed as Role[];
    } catch {
      // Malformed roles JSON - treat as invisible to everyone, not a crash.
    }
  }
  return map;
}

export function canSeeMenuItem(access: MenuAccessMap, key: string, role: Role): boolean {
  return access[key]?.includes(role) ?? false;
}
