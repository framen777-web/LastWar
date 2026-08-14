import { prisma } from "@/lib/db";

export type GrowthCategory = { key: string; name: string; cumulative: boolean };
export type GrowthRow = {
  week: number;
  /** categoryKey -> this week's stored value. */
  values: Record<string, number | undefined>;
  /** categoryKey -> gain since the member's own previous reading - cumulative categories only. */
  gains: Record<string, number | undefined>;
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
    const gains: Record<string, number | undefined> = {};
    for (const c of categories) {
      const value = valueByWeekCategory.get(`${week}:${c.key}`);
      values[c.key] = value;
      if (c.cumulative && idx > 0) {
        const prev = valueByWeekCategory.get(`${weekNumbers[idx - 1]}:${c.key}`);
        if (value !== undefined && prev !== undefined) gains[c.key] = value - prev;
      }
    }
    return { week, values, gains };
  });

  return { member, categories, rows };
}
