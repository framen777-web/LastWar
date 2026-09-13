import { prisma } from "@/lib/db";
import { writeExtraction } from "@/lib/pipeline/run";
import type { RankingListResult, RosterResult, FreeTextResult } from "@/lib/ai/extract";
import type { Category } from "@/lib/generated/prisma/client";
import { mergeRows, mergeFreeTextRows, validateBatch, type MergedRow, type ScreenshotGroup, type BatchValidation } from "./validate";
import { computeSquadIssues, type SquadIssue } from "./squadIssues";
import { computeHqIssues, type HqIssue } from "./hqIssues";

type ManualEntryInput = { team: string | null; memberName: string; rank: number | null; value: number | null; fields: string | null };

export type BatchSummary = {
  categoryKey: string;
  categoryName: string;
  weekNumber: number;
  validation: BatchValidation;
};

export async function listPendingBatches(): Promise<BatchSummary[]> {
  const batches = await prisma.importBatch.findMany({ where: { status: "pending" }, include: { manualEntries: true } });
  const categories = await prisma.category.findMany({ where: { key: { in: batches.map((b) => b.categoryKey) } } });
  const categoryByKey = new Map(categories.map((c) => [c.key, c]));

  const summaries: BatchSummary[] = [];
  for (const batch of batches) {
    const category = categoryByKey.get(batch.categoryKey);
    if (!category || category.verificationMode === "off") continue; // config changed after this batch was created

    const rows = await loadMergedRows(category, batch.weekNumber, batch.manualEntries);
    const validation = await validateBatch(
      category.verificationMode as "rank_single" | "rank_multi_team" | "per_member",
      batch.categoryKey,
      batch.weekNumber,
      rows
    );
    summaries.push({ categoryKey: batch.categoryKey, categoryName: category.name, weekNumber: batch.weekNumber, validation });
  }
  return summaries;
}

export type BatchDetail = BatchSummary & {
  rows: MergedRow[];
  manualEntries: { id: number; team: string | null; memberName: string; rank: number | null; value: number | null; fields: string | null }[];
};

export async function getBatchDetail(categoryKey: string, weekNumber: number): Promise<BatchDetail | null> {
  const category = await prisma.category.findUnique({ where: { key: categoryKey } });
  if (!category || category.verificationMode === "off") return null;

  const batch = await prisma.importBatch.findUnique({ where: { categoryKey_weekNumber: { categoryKey, weekNumber } }, include: { manualEntries: true } });
  if (!batch || batch.status !== "pending") return null;

  const rows = await loadMergedRows(category, weekNumber, batch.manualEntries);
  const validation = await validateBatch(category.verificationMode as "rank_single" | "rank_multi_team" | "per_member", categoryKey, weekNumber, rows);

  return {
    categoryKey,
    categoryName: category.name,
    weekNumber,
    validation,
    rows,
    manualEntries: batch.manualEntries.map((e) => ({ id: e.id, team: e.team, memberName: e.memberName, rank: e.rank, value: e.value, fields: e.fields })),
  };
}

// Turns this category's pending RawExtraction rows into the shape-agnostic ScreenshotGroup[]
// that mergeRows() (validate.ts) expects. This is the only place that has to know a
// ranking_list screenshot's JSON looks like { event_date?, winner?, rows: [...] } while a
// roster (HQ) screenshot's looks like { members: [...] } with no ranks and no winner label at
// all - everything downstream of mergeRows() only ever sees the common shape.
async function loadMergedRows(
  category: Category,
  weekNumber: number,
  manualEntries: ManualEntryInput[]
): Promise<MergedRow[]> {
  const extractions = await prisma.rawExtraction.findMany({
    where: { categoryKey: category.key, weekNumber, status: "pending_verification" },
  });

  if (category.shape === "free_text") {
    const screenshots = extractions.map((ex) => {
      const parsed = JSON.parse(ex.rawJson) as FreeTextResult;
      return {
        rows: (parsed.members ?? []).map((m) => ({
          memberName: m.member_name,
          fields: { air: m.air, tank: m.tank, missile: m.missile, fourth: m.fourth },
        })),
      };
    });
    return mergeFreeTextRows(
      screenshots,
      manualEntries.map((e) => ({ memberName: e.memberName, fields: e.fields ? JSON.parse(e.fields) : null }))
    );
  }

  const screenshots: ScreenshotGroup[] = extractions.map((ex) => {
    if (category.shape === "roster") {
      const parsed = JSON.parse(ex.rawJson) as RosterResult;
      return {
        // roster screenshots never carry a "winner" label - per_member is the only mode
        // roster supports (see "Before you build this" #3), and per_member ignores team.
        rows: (parsed.members ?? []).map((m) => {
          const fields = m as unknown as Record<string, string | number | undefined>;
          return { memberName: m.name, value: Number(fields[category.valueField]), fields };
        }),
      };
    }

    // ranking_list (Kills/VS/Donations/Desert Storm/Canyon Storm/Alliance Exercise/Power)
    const parsed = JSON.parse(ex.rawJson) as RankingListResult;
    return {
      winner: parsed.winner,
      rows: (parsed.rows ?? []).map((r) => ({
        rank: r.rank,
        memberName: r.member_name,
        value: r.value,
        fields: r as unknown as Record<string, string | number | undefined>,
      })),
    };
  });

  return mergeRows(screenshots, manualEntries);
}

export async function addManualEntry(
  categoryKey: string,
  weekNumber: number,
  entry: { team: string | null; memberName: string; rank: number | null; value: number | null; fields?: string | null }
): Promise<void> {
  const batch = await prisma.importBatch.upsert({
    where: { categoryKey_weekNumber: { categoryKey, weekNumber } },
    update: {},
    create: { categoryKey, weekNumber },
  });
  await prisma.importBatchManualEntry.create({ data: { importBatchId: batch.id, ...entry, fields: entry.fields ?? null } });
}

export async function deleteManualEntry(entryId: number): Promise<void> {
  await prisma.importBatchManualEntry.delete({ where: { id: entryId } });
}

/**
 * Commits a whole batch: merges every pending screenshot + manual entry (same merge the
 * summary/detail screens already showed), reconstructs a full extraction payload in
 * whichever shape this category actually is, writes it through the exact same
 * writeExtraction() every other category shape already uses, then marks the batch and its
 * screenshots committed. Refuses a variance commit unless acknowledgeVariance is explicitly
 * true - this is the server-side backstop for the UI's "Commit As-Is" button, not just a
 * client check.
 */
export async function commitBatch(categoryKey: string, weekNumber: number, acknowledgeVariance: boolean): Promise<void> {
  const category = await prisma.category.findUniqueOrThrow({ where: { key: categoryKey } });
  const batch = await prisma.importBatch.findUnique({ where: { categoryKey_weekNumber: { categoryKey, weekNumber } }, include: { manualEntries: true } });
  if (!batch || batch.status !== "pending") throw new Error("No pending batch found for this category/week.");

  const rows = await loadMergedRows(category, weekNumber, batch.manualEntries);
  const validation = await validateBatch(category.verificationMode as "rank_single" | "rank_multi_team" | "per_member", categoryKey, weekNumber, rows);

  if (!validation.isBalanced && !acknowledgeVariance) {
    throw new Error(`This batch has a variance of ${validation.variance} - pass acknowledgeVariance to commit anyway.`);
  }

  const extracted: RankingListResult | RosterResult | FreeTextResult =
    category.shape === "free_text"
      ? {
          members: rows.map((r) => ({
            member_name: r.memberName,
            air: r.fields.air as number | undefined,
            tank: r.fields.tank as number | undefined,
            missile: r.fields.missile as number | undefined,
            fourth: r.fields.fourth as number | undefined,
            needsReview: ["air", "tank", "missile", "fourth"].filter((k) => r.fields[k] !== undefined).length < 3,
          })),
        }
      : category.shape === "roster"
        ? {
            members: rows.map((r) => ({
              name: r.memberName,
              level: (r.fields.level as number | undefined) ?? (category.valueField === "level" ? r.value : undefined),
              status: r.fields.status as string | undefined,
              last_active: r.fields.last_active as string | undefined,
              alliance_rank: r.fields.alliance_rank as string | undefined,
            })),
          }
        : {
            // no event_date - see "Before you build this" #9. winner goes per-row, not at the
            // top level, because one multi-team batch's rows can belong to either team.
            rows: rows.map((r) => ({
              rank: r.rank,
              member_name: r.memberName,
              value: r.value,
              alliance_rank: r.fields.alliance_rank as string | undefined,
              alliance_tag: r.fields.alliance_tag as string | undefined,
              winner: r.team ?? undefined,
            })),
          };

  await writeExtraction(category, extracted, weekNumber);

  await prisma.$transaction([
    prisma.rawExtraction.updateMany({ where: { categoryKey, weekNumber, status: "pending_verification" }, data: { status: "committed" } }),
    prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: "committed", committedAt: new Date(), varianceAcknowledged: !validation.isBalanced && acknowledgeVariance },
    }),
    prisma.importBatchIssueAck.deleteMany({ where: { importBatchId: batch.id } }),
  ]);
}

/**
 * Cancels a pending batch outright - discards every screenshot held for this category+week
 * (marked "rejected", never written) and deletes the batch itself, rather than committing
 * anything. A later screenshot for the same category+week starts a brand new batch from
 * scratch. Doesn't touch the underlying image in Blob storage - same as
 * rejectRawExtraction() elsewhere, only the tracking record is marked rejected.
 */
export async function cancelBatch(categoryKey: string, weekNumber: number): Promise<void> {
  const batch = await prisma.importBatch.findUnique({ where: { categoryKey_weekNumber: { categoryKey, weekNumber } } });
  if (!batch || batch.status !== "pending") throw new Error("No pending batch found for this category/week.");

  await prisma.$transaction([
    prisma.rawExtraction.updateMany({ where: { categoryKey, weekNumber, status: "pending_verification" }, data: { status: "rejected" } }),
    prisma.importBatchManualEntry.deleteMany({ where: { importBatchId: batch.id } }),
    prisma.importBatchIssueAck.deleteMany({ where: { importBatchId: batch.id } }),
    prisma.importBatch.delete({ where: { id: batch.id } }),
  ]);
}

// Whether committing this category+week should route through the Squads review step
// (VerifyDetailClient) instead of committing directly - free_text + per_member only, since
// the value-quality checks in squadIssues.ts only make sense for that shape/mode combo.
export function hasSquadReviewStep(category: Pick<Category, "shape" | "verificationMode">): boolean {
  return category.shape === "free_text" && category.verificationMode === "per_member";
}

export type SquadReview = { issues: SquadIssue[]; acknowledged: { id: number; memberName: string; issueType: string }[] };

export async function getSquadReview(categoryKey: string, weekNumber: number): Promise<SquadReview | null> {
  const category = await prisma.category.findUnique({ where: { key: categoryKey } });
  if (!category || !hasSquadReviewStep(category)) return null;

  const batch = await prisma.importBatch.findUnique({
    where: { categoryKey_weekNumber: { categoryKey, weekNumber } },
    include: { manualEntries: true, issueAcks: true },
  });
  if (!batch || batch.status !== "pending") return null;

  const rows = await loadMergedRows(category, weekNumber, batch.manualEntries);
  const allIssues = await computeSquadIssues(category.id, weekNumber, rows);

  const ackKey = (i: { memberName: string; issueType: string }) => `${i.memberName.toLowerCase()}:${i.issueType}`;
  const acked = new Set(batch.issueAcks.map((a) => ackKey({ memberName: a.memberName, issueType: a.issueType })));
  const issues = allIssues.filter((i) => !acked.has(ackKey({ memberName: i.memberName, issueType: i.type })));

  return { issues, acknowledged: batch.issueAcks.map((a) => ({ id: a.id, memberName: a.memberName, issueType: a.issueType })) };
}

export async function acknowledgeIssue(categoryKey: string, weekNumber: number, memberName: string, issueType: string): Promise<void> {
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { categoryKey_weekNumber: { categoryKey, weekNumber } } });
  await prisma.importBatchIssueAck.upsert({
    where: { importBatchId_memberName_issueType: { importBatchId: batch.id, memberName, issueType } },
    update: {},
    create: { importBatchId: batch.id, memberName, issueType },
  });
}

export async function unacknowledgeIssue(ackId: number): Promise<void> {
  await prisma.importBatchIssueAck.delete({ where: { id: ackId } });
}

// Whether committing this category+week should route through the HQ review step instead of
// committing directly - roster shape + per_member mode + the HQ category specifically (key
// check keeps this from silently applying to some future unrelated roster category that
// wouldn't have a "level" concept at all).
export function hasHqReviewStep(category: Pick<Category, "key" | "shape" | "verificationMode">): boolean {
  return category.key === "members" && category.shape === "roster" && category.verificationMode === "per_member";
}

export type HqReview = { issues: HqIssue[]; acknowledged: { id: number; memberName: string; issueType: string }[] };

export async function getHqReview(categoryKey: string, weekNumber: number): Promise<HqReview | null> {
  const category = await prisma.category.findUnique({ where: { key: categoryKey } });
  if (!category || !hasHqReviewStep(category)) return null;

  const batch = await prisma.importBatch.findUnique({
    where: { categoryKey_weekNumber: { categoryKey, weekNumber } },
    include: { manualEntries: true, issueAcks: true },
  });
  if (!batch || batch.status !== "pending") return null;

  const rows = await loadMergedRows(category, weekNumber, batch.manualEntries);
  const allIssues = await computeHqIssues(category.id, weekNumber, rows);

  const ackKey = (i: { memberName: string; issueType: string }) => `${i.memberName.toLowerCase()}:${i.issueType}`;
  const acked = new Set(batch.issueAcks.map((a) => ackKey({ memberName: a.memberName, issueType: a.issueType })));
  const issues = allIssues.filter((i) => !acked.has(ackKey({ memberName: i.memberName, issueType: i.type })));

  return { issues, acknowledged: batch.issueAcks.map((a) => ({ id: a.id, memberName: a.memberName, issueType: a.issueType })) };
}
