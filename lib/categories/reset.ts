import { prisma } from "@/lib/db";

/**
 * Clears one category's data for one week only - every member's WeeklyStat and
 * CategoryRecord rows for that category+week are removed, so it can be re-imported
 * cleanly. Nothing else is touched: other categories, other weeks, RawExtraction history
 * (so the original screenshots/extractions are still visible), and Conductor rounds are
 * all left alone - a round's picks are a frozen snapshot at generation time, not a live
 * read of this data, so a bad import doesn't retroactively need "commanders" redone.
 */
export async function resetCategoryWeek(categoryKey: string, weekNumber: number): Promise<{ weeklyStatsDeleted: number; categoryRecordsDeleted: number }> {
  const category = await prisma.category.findUnique({ where: { key: categoryKey } });
  if (!category) throw new Error(`Unknown category "${categoryKey}".`);

  const [weeklyStats, categoryRecords] = await Promise.all([
    prisma.weeklyStat.deleteMany({ where: { categoryKey, weekNumber } }),
    prisma.categoryRecord.deleteMany({ where: { categoryId: category.id, weekNumber } }),
  ]);

  return { weeklyStatsDeleted: weeklyStats.count, categoryRecordsDeleted: categoryRecords.count };
}
