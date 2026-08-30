import { prisma } from "@/lib/db";
import { getConductorCategoryWeekValues } from "./stats";
import { getConductorSettings } from "./settings";
import { pointsForCategoryWeek } from "./points";

export type StatementCategoryDetail = {
  categoryKey: string;
  categoryName: string;
  rawValue: number;
  mode: "rate" | "flat";
  unitSize: number | null;
  pointsPerUnit: number | null;
  flatValue: number | null;
  points: number;
};

export type StatementEntry =
  | { type: "earn"; weekNumber: number; points: number; categories: StatementCategoryDetail[]; balanceAfter: number }
  | { type: "reset"; weekNumber: number; roundId: number; roundStartWeek: number; points: number; balanceAfter: number };

export type ConductorStatement = { entries: StatementEntry[]; finalBalance: number };

/**
 * Unpacks the same ledger computeStandings() already trusts (see points.ts) into a
 * week-by-week, category-by-category statement for one member - read-only, no new
 * math. finalBalance should always equal that member's `total` from computeStandings();
 * a mismatch means a real discrepancy, not a bug in this file.
 */
export async function getConductorStatement(memberId: number): Promise<ConductorStatement> {
  const settings = await getConductorSettings();
  const [categories, values, resets] = await Promise.all([
    prisma.category.findMany({ where: { active: true, conductorMode: { not: "off" } } }),
    getConductorCategoryWeekValues(),
    prisma.conductorSelection.findMany({
      where: { memberId, role: "conductor", round: { status: "confirmed" } },
      include: { round: true },
      orderBy: { round: { startWeek: "asc" } },
    }),
  ]);

  let maxWeek = settings.fromWeek;
  for (const key of values.keys()) {
    const [id, week] = key.split(":");
    if (Number(id) === memberId) maxWeek = Math.max(maxWeek, Number(week));
  }
  for (const r of resets) maxWeek = Math.max(maxWeek, r.round.startWeek - 1);

  const resetsBySnapshotWeek = new Map<number, typeof resets>();
  for (const r of resets) {
    const wk = r.round.startWeek - 1;
    if (!resetsBySnapshotWeek.has(wk)) resetsBySnapshotWeek.set(wk, []);
    resetsBySnapshotWeek.get(wk)!.push(r);
  }

  const entries: StatementEntry[] = [];
  let balance = 0;

  for (let week = settings.fromWeek; week <= maxWeek; week++) {
    const categoryDetails: StatementCategoryDetail[] = [];
    let weekPoints = 0;

    for (const category of categories) {
      const cw = values.get(`${memberId}:${week}:${category.key}`);
      if (!cw?.present) continue;
      const points = pointsForCategoryWeek(category, cw);
      categoryDetails.push({
        categoryKey: category.key,
        categoryName: category.name,
        rawValue: cw.value,
        mode: category.conductorMode as "rate" | "flat",
        unitSize: category.conductorUnitSize,
        pointsPerUnit: category.conductorPointsPerUnit,
        flatValue: category.conductorFlatValue,
        points,
      });
      weekPoints += points;
    }

    if (categoryDetails.length > 0) {
      balance += weekPoints;
      entries.push({ type: "earn", weekNumber: week, points: weekPoints, categories: categoryDetails, balanceAfter: balance });
    }

    for (const r of resetsBySnapshotWeek.get(week) ?? []) {
      const resetPoints = r.pointsAtSelection ?? 0;
      balance -= resetPoints;
      entries.push({
        type: "reset",
        weekNumber: week,
        roundId: r.roundId,
        roundStartWeek: r.round.startWeek,
        points: resetPoints,
        balanceAfter: balance,
      });
    }
  }

  return { entries, finalBalance: balance };
}
