import { prisma } from "@/lib/db";

export type CategoryWeekValue = { value: number; present: boolean };

/**
 * Per-member-per-week-per-category values for every active category, keyed
 * `${memberId}:${weekNumber}:${categoryKey}`. Used by both the points engine (which
 * cares about `value` for rate mode and `present` for flat mode) and Passenger ranking
 * (which just needs `value` for whatever category a weekday rule points at) - so this
 * covers every active category regardless of its conductorMode, not just the ones
 * currently configured for points.
 *
 * Cumulative categories (e.g. Kills - a lifetime running total, never a per-week figure)
 * are diffed against the same member's immediately-preceding week's raw reading; a
 * member's first-ever reading has no baseline, so it scores 0 rather than the full raw
 * value. Free-text categories (e.g. Squads) have no single numeric value - only
 * presence is meaningful for them, so `value` is always 0 there.
 */
export async function getConductorCategoryWeekValues(): Promise<Map<string, CategoryWeekValue>> {
  const categories = await prisma.category.findMany({ where: { active: true } });
  const values = new Map<string, CategoryWeekValue>();

  const rankableCategories = categories.filter((c) => c.shape !== "free_text");
  const freeTextCategories = categories.filter((c) => c.shape === "free_text");

  if (rankableCategories.length > 0) {
    const stats = await prisma.weeklyStat.findMany({
      where: { categoryKey: { in: rankableCategories.map((c) => c.key) } },
      orderBy: { weekNumber: "asc" },
    });
    const cumulativeByKey = new Map(rankableCategories.map((c) => [c.key, c.cumulative]));
    const lastRawByMemberCategory = new Map<string, number>();

    for (const s of stats) {
      const isCumulative = cumulativeByKey.get(s.categoryKey) ?? false;
      let weekValue = s.value;
      if (isCumulative) {
        const mcKey = `${s.memberId}:${s.categoryKey}`;
        const prevRaw = lastRawByMemberCategory.get(mcKey);
        weekValue = prevRaw === undefined ? 0 : Math.max(0, s.value - prevRaw);
        lastRawByMemberCategory.set(mcKey, s.value);
      }
      values.set(`${s.memberId}:${s.weekNumber}:${s.categoryKey}`, { value: weekValue, present: true });
    }
  }

  if (freeTextCategories.length > 0) {
    const categoryKeyById = new Map(freeTextCategories.map((c) => [c.id, c.key]));
    const records = await prisma.categoryRecord.findMany({
      where: { categoryId: { in: freeTextCategories.map((c) => c.id) }, dedupKey: "" },
    });
    for (const r of records) {
      const key = categoryKeyById.get(r.categoryId);
      if (!key) continue;
      values.set(`${r.memberId}:${r.weekNumber}:${key}`, { value: 0, present: true });
    }
  }

  return values;
}

/** Active categories usable as a Passenger ranking field - free-text categories have no single numeric value. */
export async function getRankableCategories(): Promise<{ key: string; name: string; cumulative: boolean }[]> {
  const categories = await prisma.category.findMany({
    where: { active: true, shape: { not: "free_text" } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return categories.map((c) => ({ key: c.key, name: c.name, cumulative: c.cumulative }));
}
