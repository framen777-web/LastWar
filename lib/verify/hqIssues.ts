import { prisma } from "@/lib/db";
import { findMemberId, type MatchableMember } from "@/lib/pipeline/matchMemberCore";
import type { MergedRow } from "./validate";

export type HqIssue =
  | { type: "hq_decreased"; memberName: string; value: number; priorValue: number }
  | { type: "hq_jumped"; memberName: string; value: number; priorValue: number; cap: number };

const HQ_MAX_INCREASE_SETTING_KEY = "hqMaxWeeklyIncrease";
const DEFAULT_HQ_MAX_INCREASE = 3;

async function getHqMaxWeeklyIncrease(): Promise<number> {
  const setting = await prisma.setting.findUnique({ where: { key: HQ_MAX_INCREASE_SETTING_KEY } });
  const n = setting ? Number(setting.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_HQ_MAX_INCREASE;
}

/**
 * Computes HQ-level data-quality flags for a pending HQ (roster) batch's merged rows -
 * mirrors computeSquadIssues() (squadIssues.ts) but for a single numeric field (level)
 * instead of four troop-type fields. Purely additive to the existing count-based balance
 * check (validateBatch) - never affects isBalanced/variance, only ever surfaces on the HQ
 * review page. Already-acknowledged (memberName, issueType) pairs are excluded by the
 * caller (see getHqReview in lib/verify/service.ts).
 */
export async function computeHqIssues(categoryId: number, weekNumber: number, rows: MergedRow[]): Promise<HqIssue[]> {
  const issues: HqIssue[] = [];
  const cap = await getHqMaxWeeklyIncrease();

  const priorRecords = await prisma.categoryRecord.findMany({
    where: { categoryId, weekNumber: weekNumber - 1 },
    include: { member: true },
  });
  const members = priorRecords.map((r) => r.member) as MatchableMember[];
  const priorValueByMemberName = new Map(priorRecords.map((r) => [r.member.name.trim().toLowerCase(), r.value]));

  for (const row of rows) {
    const value = row.value;
    if (!Number.isFinite(value)) continue; // level didn't extract cleanly - a separate, pre-existing gap, not this check's job

    // Resolve real member identity read-only (no auto-create) so history lookups are against
    // the right person even if this week's OCR'd name spelling drifted slightly.
    const matchedId = findMemberId(row.memberName, members);
    const matchedMember = members.find((m) => m.id === matchedId);
    const priorValue = matchedMember ? priorValueByMemberName.get(matchedMember.name.trim().toLowerCase()) : undefined;
    if (priorValue === undefined) continue; // no prior week to compare against - new member or first submission, nothing to flag

    if (value < priorValue) {
      issues.push({ type: "hq_decreased", memberName: row.memberName, value, priorValue });
    } else if (value > priorValue + cap) {
      issues.push({ type: "hq_jumped", memberName: row.memberName, value, priorValue, cap });
    }
  }

  return issues;
}
