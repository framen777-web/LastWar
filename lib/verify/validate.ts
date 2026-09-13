import { prisma } from "@/lib/db";
import { getRosterMemberIdsForWeeks } from "@/lib/reports/activeMembers";

// The full per-member field bag straight from the screenshot's raw JSON (whatever keys
// that shape happens to have - alliance_rank/alliance_tag for ranking_list, level/status/
// last_active/alliance_rank for roster). Carried through unchanged so commitBatch() (Change
// 5) can reconstruct a full-fidelity write instead of only ever having a bare number - a
// manually-added entry has none of these (a human only ever supplies a name + a value, and
// team for multi-team mode), which is fine: those fields simply don't get set for that one
// member, exactly as if the row had come from a screenshot that didn't show them either.
export type MergedRow = {
  team: string | null;
  memberName: string;
  rank?: number;
  value: number;
  fields: Record<string, string | number | undefined>;
};

// One screenshot's extraction, already normalized to a common shape by loadMergedRows()
// (Change 5) regardless of whether it came from a ranking_list or roster category - that's
// where the shape-specific JSON parsing happens, not here.
export type ScreenshotGroup = {
  winner?: string; // the screenshot-level "winner"/team label - rank_multi_team mode only, see "Before you build this" #2
  rows: { rank?: number; memberName: string; value: number; fields: Record<string, string | number | undefined> }[];
};

export type TeamBreakdown = { team: string; maxRank: number; memberCount: number };

export type BatchValidation =
  | { mode: "rank_single"; maxRank: number; extractedTotal: number; isBalanced: boolean; variance: number }
  | { mode: "rank_multi_team"; teams: TeamBreakdown[]; extractedTotal: number; isBalanced: boolean; variance: number }
  | { mode: "per_member"; expectedTotal: number; extractedTotal: number; isBalanced: boolean; variance: number };

/**
 * Merges every pending screenshot's rows plus any manually-added entries into one
 * per-member list for this batch. Dedup key is the trimmed, lowercased name - this runs
 * BEFORE commit, so nothing has been fuzzy-matched to a real Member yet (that only happens
 * inside writeExtraction() at commit time). A name appearing more than once (a re-uploaded
 * or corrected screenshot, or a manual entry for a name a screenshot also found) resolves
 * to whichever source was processed last - manual entries are always applied last, so they
 * always win over a screenshot's own reading.
 *
 * Grouping is by SCREENSHOT, not by row: a screenshot's "winner" label (if any) applies to
 * every row it contains, because the winner label is printed once at the top of the image,
 * not per member - see "Before you build this" #2. rank_single/per_member categories never
 * set `winner` on their screenshots, so `team` stays null for every row in those modes,
 * which validateBatch()/the UI already ignore outside rank_multi_team.
 */
export function mergeRows(
  screenshots: ScreenshotGroup[],
  manualEntries: { team: string | null; memberName: string; rank: number | null; value: number | null }[]
): MergedRow[] {
  const byName = new Map<string, MergedRow>();

  for (const shot of screenshots) {
    const team = shot.winner?.trim() || null;
    for (const r of shot.rows) {
      const key = r.memberName.trim().toLowerCase();
      byName.set(key, { team, memberName: r.memberName, rank: r.rank, value: r.value, fields: r.fields });
    }
  }
  for (const m of manualEntries) {
    const key = m.memberName.trim().toLowerCase();
    byName.set(key, { team: m.team, memberName: m.memberName, rank: m.rank ?? undefined, value: m.value ?? 0, fields: {} });
  }

  return [...byName.values()];
}

// Field-level merge for free_text (Squads) categories - unlike mergeRows() (a full-row
// replace, correct for a category where one screenshot = one complete number per member),
// a Squads member's air/tank/missile/fourth can arrive across separate screenshots/messages
// read at different times. Each field independently keeps whichever source last reported
// THAT field - an older screenshot's fields aren't wiped just because a newer one only
// mentioned some of them. Manual entries (ImportBatchManualEntry.fields) are applied last
// per field, same "manual always wins" rule as mergeRows().
export function mergeFreeTextRows(
  screenshots: { rows: { memberName: string; fields: Record<string, number | undefined> }[] }[],
  manualEntries: { memberName: string; fields: Record<string, number | undefined> | null }[]
): MergedRow[] {
  const byName = new Map<string, { memberName: string; fields: Record<string, number | undefined> }>();

  for (const shot of screenshots) {
    for (const r of shot.rows) {
      const key = r.memberName.trim().toLowerCase();
      const existing = byName.get(key)?.fields ?? {};
      const merged = { ...existing };
      for (const [k, v] of Object.entries(r.fields)) {
        if (v !== undefined) merged[k] = v; // only overwrite slots this read actually reported
      }
      byName.set(key, { memberName: r.memberName, fields: merged });
    }
  }

  for (const m of manualEntries) {
    if (!m.fields) continue;
    const key = m.memberName.trim().toLowerCase();
    const existing = byName.get(key)?.fields ?? {};
    const merged = { ...existing };
    for (const [k, v] of Object.entries(m.fields)) {
      if (v !== undefined) merged[k] = v;
    }
    byName.set(key, { memberName: m.memberName, fields: merged });
  }

  return [...byName.values()].map((r) => ({
    team: null,
    memberName: r.memberName,
    // Deliberately the count of resolved slots (0-4), not a troop number - it exists only
    // so validateBatch()'s per_member counting (extracted rows with a defined value) keeps
    // working unchanged for the main Verify screen's "Balanced"/"Variance" count, exactly as
    // it does for every other per_member category. Value-quality lives in squadIssues.ts.
    value: ["air", "tank", "missile", "fourth"].filter((k) => r.fields[k] !== undefined).length,
    fields: r.fields,
  }));
}

export async function validateBatch(
  mode: "rank_single" | "rank_multi_team" | "per_member",
  categoryKey: string,
  weekNumber: number,
  rows: MergedRow[]
): Promise<BatchValidation> {
  if (mode === "rank_single") {
    const ranks = rows.map((r) => r.rank ?? 0);
    const maxRank = ranks.length > 0 ? Math.max(...ranks) : 0;
    const extractedTotal = rows.length;
    return { mode, maxRank, extractedTotal, isBalanced: maxRank === extractedTotal, variance: Math.abs(maxRank - extractedTotal) };
  }

  if (mode === "rank_multi_team") {
    const byTeam = new Map<string, MergedRow[]>();
    for (const r of rows) {
      const team = r.team ?? "Unlabeled";
      if (!byTeam.has(team)) byTeam.set(team, []);
      byTeam.get(team)!.push(r);
    }
    const teams: TeamBreakdown[] = [...byTeam.entries()].map(([team, teamRows]) => ({
      team,
      maxRank: Math.max(...teamRows.map((r) => r.rank ?? 0)),
      memberCount: teamRows.length,
    }));
    const expectedTotal = teams.reduce((sum, t) => sum + t.maxRank, 0);
    const extractedTotal = rows.length;
    return { mode, teams, extractedTotal, isBalanced: expectedTotal === extractedTotal, variance: Math.abs(expectedTotal - extractedTotal) };
  }

  // per_member: expected = current roster size, unless it's more than 10% below what
  // actually had a value last week for this category - in which case last week's actual
  // count is used instead, on the theory that a sudden apparent roster shrink is more
  // likely stale/incomplete roster data than 10%+ of the alliance genuinely vanishing in
  // one week. See "Before you build this" #3 for the exact rule this implements.
  const [rosterIds, priorWeekStats] = await Promise.all([
    getRosterMemberIdsForWeeks(weekNumber),
    prisma.weeklyStat.findMany({ where: { categoryKey, weekNumber: weekNumber - 1 }, select: { memberId: true }, distinct: ["memberId"] }),
  ]);
  const currentRosterCount = rosterIds.size;
  const priorWeekCount = priorWeekStats.length;
  const expectedTotal = priorWeekCount > 0 && currentRosterCount < priorWeekCount * 0.9 ? priorWeekCount : currentRosterCount;

  const extractedTotal = rows.filter((r) => r.value !== undefined && r.value !== null).length;
  return {
    mode,
    expectedTotal,
    extractedTotal,
    isBalanced: extractedTotal >= expectedTotal,
    variance: Math.max(0, expectedTotal - extractedTotal),
  };
}
