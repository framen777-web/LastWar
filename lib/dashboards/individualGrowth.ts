import { prisma } from "@/lib/db";

export type GrowthCategory = { key: string; name: string; cumulative: boolean };
export type GrowthRow = {
  week: number;
  /** categoryKey -> this week's stored value. */
  values: Record<string, number | undefined>;
  /**
   * categoryKey -> gain since the member's own previous reading (cumulative categories
   * only). "new" means this is the earliest week this member has ANY reading for that
   * specific category - there's no prior baseline to diff against, so the raw value (a
   * lifetime running total, e.g. Kills) must never be shown as if it were earned in this
   * one week. undefined means no reading at all this week.
   */
  gains: Record<string, number | "new" | undefined>;
};

export type MemberGrowthData = {
  member: { id: number; name: string; allianceRank: string | null } | null;
  categories: GrowthCategory[];
  /** Ascending by week. */
  rows: GrowthRow[];
};

// Shared by the Individual Dashboard page and its Excel export route, so the two can't
// drift out of sync on how a cumulative category's weekly gain is computed.
export async function getMemberGrowthData(memberId: number): Promise<MemberGrowthData> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, name: true, allianceRank: true },
  });

  const allCategories = await prisma.category.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  // Squads (free_text) has no WeeklyStat value - same filter /dashboard uses.
  const categories: GrowthCategory[] = allCategories
    .filter((c) => c.shape !== "free_text")
    .map((c) => ({ key: c.key, name: c.name, cumulative: c.cumulative }));

  if (!member) return { member: null, categories, rows: [] };

  const stats = await prisma.weeklyStat.findMany({
    where: { memberId: member.id, categoryKey: { in: categories.map((c) => c.key) } },
    orderBy: { weekNumber: "asc" },
  });

  const weekNumbers = Array.from(new Set(stats.map((s) => s.weekNumber))).sort((a, b) => a - b);
  const valueByWeekCategory = new Map<string, number>();
  for (const s of stats) valueByWeekCategory.set(`${s.weekNumber}:${s.categoryKey}`, s.value);

  const rows: GrowthRow[] = weekNumbers.map((week, idx) => {
    const values: Record<string, number | undefined> = {};
    const gains: Record<string, number | "new" | undefined> = {};
    for (const c of categories) {
      const value = valueByWeekCategory.get(`${week}:${c.key}`);
      values[c.key] = value;
      if (c.cumulative && value !== undefined) {
        // Walk back to the nearest earlier week that actually has a reading for THIS
        // category - not just the member's immediately-preceding week overall, since a
        // member can skip a week for one category while still having other categories
        // recorded that week.
        let prev: number | undefined;
        for (let j = idx - 1; j >= 0; j--) {
          const candidate = valueByWeekCategory.get(`${weekNumbers[j]}:${c.key}`);
          if (candidate !== undefined) {
            prev = candidate;
            break;
          }
        }
        gains[c.key] = prev === undefined ? "new" : value - prev;
      }
    }
    return { week, values, gains };
  });

  return { member, categories, rows };
}
