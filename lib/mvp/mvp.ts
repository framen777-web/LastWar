import type { MemberWeekRow } from "./data";

export type Weights = {
  vs: number;
  ds: number;
  hqMover: number;
  donations: number;
  kills: number;
  squad: number;
  canyonStorm: number;
  zombieSiege: number;
  allianceExercise: number;
};

export type DerivedRow = MemberWeekRow & {
  squadPower: number | null;
  squadImproved: number | null;
  weekKills: number | null;
  hqUpgrade: number;
};

export type ScoredRow = DerivedRow & { mvp: number };

/**
 * 1-based ascending competition rank (ties share rank, gaps after ties) - worst
 * value ranks 1, best ranks up to the member count. Missing values rank 1
 * (spec: "blank/missing metric values fail the < comparison and land at rank 1").
 * Sorts once per metric, matching the spec's "sort once, cache" guidance.
 */
export function computeRanks(values: (number | null | undefined)[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  const defined = indexed.filter((x): x is { v: number; i: number } => x.v !== null && x.v !== undefined);
  defined.sort((a, b) => a.v - b.v);

  const ranks = new Array(values.length).fill(1);
  let i = 0;
  while (i < defined.length) {
    let j = i;
    while (j < defined.length && defined[j].v === defined[i].v) j++;
    const rank = i + 1;
    for (let k = i; k < j; k++) ranks[defined[k].i] = rank;
    i = j;
  }
  return ranks;
}

function sumSquad(row: { air: number | null; tank: number | null; missile: number | null }): number | null {
  if (row.air === null && row.tank === null && row.missile === null) return null;
  return (row.air ?? 0) + (row.tank ?? 0) + (row.missile ?? 0);
}

/**
 * Adds squadPower/squadImproved/weekKills/hqUpgrade per spec §1.2. `prev` is
 * the same member's row at exactly `week - 1` (not the nearest prior week
 * with data) - deliberate per spec, preserves the "new joiner" sentinel
 * (weekKills=1, hqUpgrade=100) when there's a gap.
 */
export function addDerivedFields(rows: MemberWeekRow[]): DerivedRow[] {
  const byMemberWeek = new Map<string, MemberWeekRow>();
  for (const r of rows) byMemberWeek.set(`${r.memberId}:${r.weekNumber}`, r);

  return rows.map((row) => {
    const prev = byMemberWeek.get(`${row.memberId}:${row.weekNumber - 1}`) ?? null;

    const squadPower = sumSquad(row);
    const prevSquadPower = prev ? (sumSquad(prev) ?? 0) : 0;
    const squadImproved =
      squadPower === null ? null : prevSquadPower === 0 ? 0 : (squadPower - prevSquadPower) / prevSquadPower;

    const weekKills =
      prev === null || prev.totalKills === null || prev.totalKills === 0
        ? 1
        : row.totalKills === null
          ? null
          : row.totalKills - prev.totalKills;

    const hqUpgrade = row.hq !== null && row.hq > (prev?.hq ?? 0) ? 100 : 0;

    return { ...row, squadPower, squadImproved, weekKills, hqUpgrade };
  });
}

/** MVP for one week's rows (ranks are only meaningful within a single week). */
export function computeMvpForWeek(weekRows: DerivedRow[], weights: Weights): ScoredRow[] {
  const vsRanks = computeRanks(weekRows.map((r) => r.vsScore));
  const dsRanks = computeRanks(weekRows.map((r) => r.dsPoints));
  const donationsRanks = computeRanks(weekRows.map((r) => r.donations));
  const killsRanks = computeRanks(weekRows.map((r) => r.weekKills));
  const squadRanks = computeRanks(weekRows.map((r) => r.squadImproved));
  const csRanks = computeRanks(weekRows.map((r) => r.cs));
  const aeRanks = computeRanks(weekRows.map((r) => r.ae));
  const zsRanks = computeRanks(weekRows.map((r) => r.zs));

  return weekRows.map((row, i) => ({
    ...row,
    mvp:
      vsRanks[i] * weights.vs +
      dsRanks[i] * weights.ds +
      donationsRanks[i] * weights.donations +
      killsRanks[i] * weights.kills +
      squadRanks[i] * weights.squad +
      row.hqUpgrade * weights.hqMover +
      csRanks[i] * weights.canyonStorm +
      // Fixed vs. the source spreadsheet, which cross-wires these two.
      aeRanks[i] * weights.allianceExercise +
      zsRanks[i] * weights.zombieSiege,
  }));
}

/** Derives fields, groups by week, and scores every week independently. */
export function computeAllMvp(rows: MemberWeekRow[], weights: Weights): ScoredRow[] {
  const derived = addDerivedFields(rows);
  const byWeek = new Map<number, DerivedRow[]>();
  for (const r of derived) {
    if (!byWeek.has(r.weekNumber)) byWeek.set(r.weekNumber, []);
    byWeek.get(r.weekNumber)!.push(r);
  }

  const result: ScoredRow[] = [];
  for (const weekRows of byWeek.values()) {
    result.push(...computeMvpForWeek(weekRows, weights));
  }
  return result;
}
