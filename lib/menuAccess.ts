import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { Role } from "@/lib/auth/roles";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/dal";

export type MenuAccessMap = Record<string, Role[]>;

// Fail-closed: a key missing from the table (a button never registered via prisma/seed.ts)
// is invisible to everyone rather than accidentally shown to everyone - a forgotten seed
// entry is then obviously broken (button missing) rather than a silent over-exposure.
// Cached per request - every menu-linked page calls this twice (once via
// requireMenuAccess() for the real guard, once directly to filter its own button list), so
// this avoids two round-trips for the same 29-row table on every page load.
export const getMenuAccessMap = cache(async (): Promise<MenuAccessMap> => {
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
});

export function canSeeMenuItem(access: MenuAccessMap, key: string, role: Role): boolean {
  return access[key]?.includes(role) ?? false;
}

/**
 * The real access control for a menu-linked page - not just button visibility. Redirects
 * to /login with no session, or to / if the current role isn't listed for any of the given
 * key(s) in Menu Access. Pass every key that links to this page (e.g. /dashboard is reached
 * both as "My Stats" and as "Upload review") - access is the union across all of them.
 * A sub-page reached only via links from within a menu-linked page (not its own button)
 * should use its parent's key, so restricting the parent's visibility restricts the whole
 * section consistently.
 */
export async function requireMenuAccess(keyOrKeys: string | string[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const access = await getMenuAccessMap();
  const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
  const allowed = keys.some((k) => canSeeMenuItem(access, k, user.role));
  if (!allowed) redirect("/");

  return user;
}
