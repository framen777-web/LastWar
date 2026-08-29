import { prisma } from "@/lib/db";
import { getConductorCategoryWeekValues } from "@/lib/conductor/stats";

export type PivotCategory = { key: string; name: string; cumulative: boolean };

/**
 * Categories a pivot chart can use - same shape filter as the Graphs page's metric list, minus
 * the squad-derived figures (see lib/dashboards/pivot.ts's module doc / the Pivot spec for why:
 * getConductorCategoryWeekValues(), this file's only data source, doesn't carry squad JSON
 * fields at all).
 */
export async function getPivotCategories(): Promise<PivotCategory[]> {
  const categories = await prisma.category.findMany({
    where: { active: true, shape: { notIn: ["free_text", "roster"] } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return categories.map((c) => ({ key: c.key, name: c.name, cumulative: c.cumulative }));
}

export type PivotSeries = {
  memberId: number;
  memberName: string;
  categoryKey: string;
  categoryName: string;
  /** One point per requested week, in the same order as `weeks`. Missing readings are null, not 0. */
  points: (number | null)[];
};

/**
 * Builds one series per (member x category) pair for a chart. Reuses
 * getConductorCategoryWeekValues() as its only data source - no new aggregation logic, no risk
 * to the points engine or Passenger ranking that already depend on that function.
 */
export async function getPivotSeries(memberIds: number[], categories: PivotCategory[], weeks: number[]): Promise<PivotSeries[]> {
  if (memberIds.length === 0 || categories.length === 0 || weeks.length === 0) return [];

  const allValues = await getConductorCategoryWeekValues();
  const members = await prisma.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, name: true } });
  const memberNameById = new Map(members.map((m) => [m.id, m.name]));

  const series: PivotSeries[] = [];
  for (const memberId of memberIds) {
    for (const category of categories) {
      const points = weeks.map((week) => {
        const entry = allValues.get(`${memberId}:${week}:${category.key}`);
        return entry?.present ? entry.value : null;
      });
      series.push({
        memberId,
        memberName: memberNameById.get(memberId) ?? "Unknown member",
        categoryKey: category.key,
        categoryName: category.name,
        points,
      });
    }
  }
  return series;
}
