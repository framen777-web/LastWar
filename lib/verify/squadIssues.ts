import { prisma } from "@/lib/db";
import { findMemberId, type MatchableMember } from "@/lib/pipeline/matchMemberCore";
import type { MergedRow } from "./validate";

export type SquadIssue =
  | { type: "few_squads"; memberName: string; count: number }
  | { type: "below_min"; memberName: string; field: string; value: number; min: number }
  | { type: "large_drop"; memberName: string; field: string; value: number; priorValue: number }
  | { type: "missing_submission"; memberName: string };

const FIELDS = ["air", "tank", "missile", "fourth"] as const;
const DROP_TOLERANCE = 0.9; // flag if this week's value < 90% of the member's own last submission for that field

/**
 * Computes data-quality flags for a pending Squads batch's merged rows. Purely additive to
 * the existing count-based balance check (validateBatch) - never affects isBalanced/variance,
 * only ever surfaces on the dedicated review page. Already-acknowledged (memberName,
 * issueType) pairs are excluded by the caller (see getSquadReview in lib/verify/service.ts).
 */
export async function computeSquadIssues(categoryId: number, weekNumber: number, rows: MergedRow[]): Promise<SquadIssue[]> {
  const issues: SquadIssue[] = [];

  const priorRecords = await prisma.categoryRecord.findMany({
    where: { categoryId, weekNumber: weekNumber - 1 },
    include: { member: true },
  });

  // Single alliance-wide floor: the lowest individual squad value (any of the 4 fields, any
  // member) actually recorded last week. No floor at all if there's no prior week yet.
  let allianceMin: number | null = null;
  for (const rec of priorRecords) {
    const fields = JSON.parse(rec.fields) as Record<string, number | undefined>;
    for (const f of FIELDS) {
      const v = fields[f];
      if (typeof v === "number" && Number.isFinite(v)) {
        if (allianceMin === null || v < allianceMin) allianceMin = v;
      }
    }
  }

  const priorByMemberName = new Map<string, Record<string, number | undefined>>();
  const members = priorRecords.map((r) => r.member) as MatchableMember[];
  for (const rec of priorRecords) {
    priorByMemberName.set(rec.member.name.trim().toLowerCase(), JSON.parse(rec.fields));
  }

  for (const row of rows) {
    const resolvedCount = FIELDS.filter((f) => row.fields[f] !== undefined).length;
    if (resolvedCount < 3) {
      issues.push({ type: "few_squads", memberName: row.memberName, count: resolvedCount });
    }

    // Resolve real member identity read-only (no auto-create) so history lookups are
    // against the right person even if this week's OCR'd name spelling drifted slightly.
    const matchedId = findMemberId(row.memberName, members);
    const matchedMember = members.find((m) => m.id === matchedId);
    const priorFields = matchedMember ? priorByMemberName.get(matchedMember.name.trim().toLowerCase()) : undefined;

    for (const f of FIELDS) {
      const value = row.fields[f] as number | undefined;
      if (value === undefined) continue;

      if (!Number.isFinite(value) || value <= 0 || (allianceMin !== null && value < allianceMin)) {
        if (allianceMin !== null) {
          issues.push({ type: "below_min", memberName: row.memberName, field: f, value, min: allianceMin });
        }
        continue; // don't also fire large_drop for a value that's already flagged as below the floor
      }

      const priorValue = priorFields?.[f];
      if (typeof priorValue === "number" && priorValue > 0 && value < priorValue * DROP_TOLERANCE) {
        issues.push({ type: "large_drop", memberName: row.memberName, field: f, value, priorValue });
      }
    }
  }

  // Missing submission: had a Squads record last week, has no merged row at all this week.
  const rowNames = new Set(rows.map((r) => r.memberName.trim().toLowerCase()));
  for (const rec of priorRecords) {
    if (!rowNames.has(rec.member.name.trim().toLowerCase())) {
      issues.push({ type: "missing_submission", memberName: rec.member.name });
    }
  }

  return issues;
}
