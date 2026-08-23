import { prisma } from "@/lib/db";

export type GraphMetric = { key: string; label: string; cumulative: boolean };

const SQUAD_METRICS: GraphMetric[] = [
  { key: "squad_air", label: "Air", cumulative: false },
  { key: "squad_tank", label: "Tank", cumulative: false },
  { key: "squad_missile", label: "Missile", cumulative: false },
  { key: "squad_top3", label: "3 Squad Power", cumulative: false },
];

function isSquadMetric(key: string): boolean {
  return key.startsWith("squad_");
}

/**
 * Every graphable metric: real ranking-list categories (VS, Kills, Donations, Power,
 * Desert Storm, Alliance Exercise, Canyon Storm, and any future one added the same way -
 * driven live from the Category table, not a hardcoded list), plus the four squad
 * troop-type figures derived from the squads category's free-text fields (those aren't
 * simple WeeklyStat rows, so they're appended separately). Excludes "members" (roster
 * headcount, a different kind of metric) and "squads" itself (free_text has no single
 * numeric value on its own).
 */
export async function getGraphMetrics(): Promise<GraphMetric[]> {
  const categories = await prisma.category.findMany({
    where: { active: true, shape: { notIn: ["free_text", "roster"] } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const categoryMetrics: GraphMetric[] = categories.map((c) => ({ key: c.key, label: c.name, cumulative: c.cumulative }));

  const squadsActive = await prisma.category.findFirst({ where: { key: "squads", active: true } });
  return squadsActive ? [...categoryMetrics, ...SQUAD_METRICS] : categoryMetrics;
}

type SquadFields = { air?: number | null; tank?: number | null; missile?: number | null; fourth?: number | null };

// Same "top 3 of 4 troop types" rule the Squad Power report uses for its combined figure.
function squadMetricValue(key: string, fields: SquadFields): number {
  const air = fields.air ?? 0;
  const tank = fields.tank ?? 0;
  const missile = fields.missile ?? 0;
  const fourth = fields.fourth ?? 0;
  if (key === "squad_air") return air;
  if (key === "squad_tank") return tank;
  if (key === "squad_missile") return missile;
  return [air, tank, missile, fourth]
    .sort((a, b) => b - a)
    .slice(0, 3)
    .reduce((s, v) => s + v, 0);
}

export type GraphBar = { week: number; value: number; hasData: boolean };

/**
 * One bar per requested week for a metric, either for a single member or aggregated
 * (sum/average) across every member with a reading that week. Cumulative metrics (Kills)
 * are converted to the gain since each member's own previous reading first, same
 * convention used everywhere else Kills gets graphed in this app - the raw lifetime total
 * isn't a meaningful per-week figure.
 */
export async function getGraphSeries(
  metricKey: string,
  cumulative: boolean,
  weeks: number[],
  memberId: number | "all",
  aggregation: "sum" | "average"
): Promise<GraphBar[]> {
  if (weeks.length === 0) return [];

  function aggregate(week: number, values: number[]): GraphBar {
    if (values.length === 0) return { week, value: 0, hasData: false };
    const total = values.reduce((s, v) => s + v, 0);
    return { week, value: memberId === "all" && aggregation === "average" ? total / values.length : total, hasData: true };
  }

  if (isSquadMetric(metricKey)) {
    const squadsCategory = await prisma.category.findUnique({ where: { key: "squads" } });
    if (!squadsCategory) return weeks.map((week) => ({ week, value: 0, hasData: false }));

    const records = await prisma.categoryRecord.findMany({
      where: { categoryId: squadsCategory.id, weekNumber: { in: weeks }, ...(memberId === "all" ? {} : { memberId }) },
    });

    const byWeek = new Map<number, number[]>();
    for (const r of records) {
      const fields = JSON.parse(r.fields) as SquadFields;
      const value = squadMetricValue(metricKey, fields);
      if (!byWeek.has(r.weekNumber)) byWeek.set(r.weekNumber, []);
      byWeek.get(r.weekNumber)!.push(value);
    }
    return weeks.map((week) => aggregate(week, byWeek.get(week) ?? []));
  }

  // Cumulative metrics need one extra week further back to compute the gain for the
  // earliest requested week too.
  const minWeek = Math.min(...weeks);
  const maxWeek = Math.max(...weeks);
  const stats = await prisma.weeklyStat.findMany({
    where: {
      categoryKey: metricKey,
      weekNumber: { gte: cumulative ? minWeek - 1 : minWeek, lte: maxWeek },
      ...(memberId === "all" ? {} : { memberId }),
    },
    orderBy: { weekNumber: "asc" },
  });

  if (!cumulative) {
    const byWeek = new Map<number, number[]>();
    for (const s of stats) {
      if (!byWeek.has(s.weekNumber)) byWeek.set(s.weekNumber, []);
      byWeek.get(s.weekNumber)!.push(s.value);
    }
    return weeks.map((week) => aggregate(week, byWeek.get(week) ?? []));
  }

  const lastByMember = new Map<number, number>();
  const gainsByWeek = new Map<number, number[]>();
  for (const s of stats) {
    const prev = lastByMember.get(s.memberId);
    if (prev !== undefined) {
      if (!gainsByWeek.has(s.weekNumber)) gainsByWeek.set(s.weekNumber, []);
      gainsByWeek.get(s.weekNumber)!.push(s.value - prev);
    }
    lastByMember.set(s.memberId, s.value);
  }
  return weeks.map((week) => aggregate(week, gainsByWeek.get(week) ?? []));
}

export function computeGraphStats(bars: GraphBar[]): { average: number; max: number; min: number } | null {
  const values = bars.filter((b) => b.hasData).map((b) => b.value);
  if (values.length === 0) return null;
  return {
    average: values.reduce((sum, v) => sum + v, 0) / values.length,
    max: Math.max(...values),
    min: Math.min(...values),
  };
}
