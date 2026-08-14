import { prisma } from "@/lib/db";
import { classify } from "@/lib/ai/classify";
import { extract, type FreeTextResult, type RankingListResult, type RosterResult } from "@/lib/ai/extract";
import { CONFIDENCE_THRESHOLD } from "@/lib/ai/prompts";
import type { Category } from "@/lib/generated/prisma/client";
import { matchMember } from "./matchMember";

export type PipelineStatus = "committed" | "needs_review" | "pending_confirmation" | "error";

export type PipelineResult = {
  filename: string;
  categoryKey: string;
  confidence: number;
  status: PipelineStatus;
  message?: string;
};

type ExtractedFields = Record<string, string | number | undefined>;

export async function runPipelineForImage(params: {
  filename: string;
  buffer: Buffer;
  mimeType: string;
  weekNumber: number;
}): Promise<PipelineResult> {
  const imageBase64 = params.buffer.toString("base64");

  let categoryKey = "unknown";
  let confidence = 0;
  try {
    const classifyResult = await classify(imageBase64, params.mimeType);
    categoryKey = classifyResult.categoryKey;
    confidence = classifyResult.confidence;
  } catch (err) {
    await createNeedsReview(params.filename, "unknown", params.weekNumber, 0);
    return { filename: params.filename, categoryKey: "unknown", confidence: 0, status: "error", message: describeError(err) };
  }

  if (categoryKey === "unknown" || confidence < CONFIDENCE_THRESHOLD) {
    await createNeedsReview(params.filename, categoryKey, params.weekNumber, confidence);
    return { filename: params.filename, categoryKey, confidence, status: "needs_review" };
  }

  const category = await prisma.category.findUnique({ where: { key: categoryKey } });
  if (!category || !category.active) {
    await createNeedsReview(params.filename, categoryKey, params.weekNumber, confidence);
    return { filename: params.filename, categoryKey, confidence, status: "needs_review" };
  }

  try {
    const extracted = await extract(category, imageBase64, params.mimeType);

    // free_text (Tier B) extractions are inherently lower-confidence self-reported data -
    // they're always held for a person to confirm before anything gets written, never
    // auto-committed. See confirmRawExtraction() below for the write-on-confirm path.
    if (category.shape === "free_text") {
      await prisma.rawExtraction.create({
        data: {
          imageFilename: params.filename,
          categoryKey,
          weekNumber: params.weekNumber,
          rawJson: JSON.stringify(extracted),
          confidence,
          status: "pending_confirmation",
        },
      });
      return { filename: params.filename, categoryKey, confidence, status: "pending_confirmation" };
    }

    await prisma.rawExtraction.create({
      data: {
        imageFilename: params.filename,
        categoryKey,
        weekNumber: params.weekNumber,
        rawJson: JSON.stringify(extracted),
        confidence,
        status: "committed",
      },
    });

    await writeExtraction(category, extracted, params.weekNumber);

    return { filename: params.filename, categoryKey, confidence, status: "committed" };
  } catch (err) {
    await createNeedsReview(params.filename, categoryKey, params.weekNumber, confidence);
    return { filename: params.filename, categoryKey, confidence, status: "error", message: describeError(err) };
  }
}

async function createNeedsReview(filename: string, categoryKey: string, weekNumber: number, confidence: number): Promise<void> {
  await prisma.rawExtraction.create({
    data: { imageFilename: filename, categoryKey, weekNumber, rawJson: "{}", confidence, status: "needs_review" },
  });
}

async function writeExtraction(
  category: Category,
  extracted: RankingListResult | RosterResult | FreeTextResult,
  weekNumber: number
): Promise<void> {
  if (category.shape === "free_text") {
    const { members } = extracted as FreeTextResult;
    for (const m of members) {
      const memberId = await matchMember(m.member_name);

      // Squad Power/Growth reads this from a per-week CategoryRecord snapshot (not a
      // running Member.squadAir/etc field) so it can diff week over week rather than only
      // ever seeing the latest reading regardless of which week is selected.
      const fields = { air: m.air, tank: m.tank, missile: m.missile, fourth: m.fourth };
      await prisma.categoryRecord.upsert({
        where: { categoryId_memberId_weekNumber_dedupKey: { categoryId: category.id, memberId, weekNumber, dedupKey: "" } },
        update: { rawValue: 0, value: 0, fields: JSON.stringify(fields) },
        create: {
          categoryId: category.id,
          memberId,
          weekNumber,
          dedupKey: "",
          rawValue: 0,
          value: 0,
          fields: JSON.stringify(fields),
        },
      });
    }
    return;
  }

  if (category.shape === "roster") {
    const { members } = extracted as RosterResult;
    for (const m of members) {
      const memberId = await matchMember(m.name);
      await prisma.member.update({
        where: { id: memberId },
        data: {
          status: m.status ?? undefined,
          lastActive: m.last_active ?? undefined,
        },
      });
      if (m.alliance_rank) await recordAllianceRank(memberId, weekNumber, m.alliance_rank);
      await writeCategoryRow(
        category,
        memberId,
        weekNumber,
        { name: m.name, level: m.level, status: m.status, last_active: m.last_active, alliance_rank: m.alliance_rank },
        undefined
      );
    }
    return;
  }

  if (category.shape === "ranking_list") {
    const { rows, event_date } = extracted as RankingListResult;
    for (const row of rows) {
      const memberId = await matchMember(row.member_name);
      if (row.alliance_rank) await recordAllianceRank(memberId, weekNumber, row.alliance_rank);
      await writeCategoryRow(
        category,
        memberId,
        weekNumber,
        { rank: row.rank, member_name: row.member_name, value: row.value, alliance_rank: row.alliance_rank, event_date },
        row.rank
      );
    }
    return;
  }

  throw new Error(`No write handler for shape "${category.shape}"`);
}

// Writes one CategoryRecord for a single extracted row/member and recomputes the
// WeeklyStat aggregate. Single-mode categories always use dedupKey "" (re-upload
// overwrites in place, same as this app's original overwrite semantics). Multi-mode
// categories resolve dedupKey from the category's configured dedupField (e.g. an
// in-image event date) so re-processed fragments of the same import update in place
// while a genuinely new value adds a new summed row.
async function writeCategoryRow(
  category: Category,
  memberId: number,
  weekNumber: number,
  fields: ExtractedFields,
  rank: number | undefined
): Promise<void> {
  const rawValue = Number(fields[category.valueField]);
  if (!Number.isFinite(rawValue)) return;

  const value = rawValue / category.divisor;
  const dedupKey =
    category.importMode === "multi"
      ? String(fields[category.dedupField ?? ""] ?? "").trim() || "unknown"
      : "";

  const storedFieldKeys: string[] = JSON.parse(category.storedFields);
  const storedSubset: ExtractedFields = {};
  for (const key of storedFieldKeys) {
    if (fields[key] !== undefined) storedSubset[key] = fields[key];
  }

  await prisma.categoryRecord.upsert({
    where: { categoryId_memberId_weekNumber_dedupKey: { categoryId: category.id, memberId, weekNumber, dedupKey } },
    update: { rawValue, value, rank: rank ?? null, fields: JSON.stringify(storedSubset) },
    create: {
      categoryId: category.id,
      memberId,
      weekNumber,
      dedupKey,
      rawValue,
      value,
      rank: rank ?? null,
      fields: JSON.stringify(storedSubset),
    },
  });

  await recomputeWeeklyStat(category.id, category.key, memberId, weekNumber);
}

export async function recomputeWeeklyStat(
  categoryId: number,
  categoryKey: string,
  memberId: number,
  weekNumber: number
): Promise<void> {
  const records = await prisma.categoryRecord.findMany({ where: { categoryId, memberId, weekNumber } });
  const value = records.reduce((sum, r) => sum + r.value, 0);
  const rank = records.length === 1 ? records[0].rank : null;
  await upsertWeeklyStat(memberId, weekNumber, categoryKey, value, rank ?? undefined);
}

// Re-divides every existing CategoryRecord for a category from its preserved rawValue
// and recomputes the affected WeeklyStat rows - used when a category's divisor changes
// so a divisor correction doesn't require re-uploading anything.
export async function recomputeCategoryFromRawValue(categoryId: number): Promise<number> {
  const category = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });
  const records = await prisma.categoryRecord.findMany({ where: { categoryId } });

  const affected = new Set<string>();
  for (const r of records) {
    const value = r.rawValue / category.divisor;
    await prisma.categoryRecord.update({ where: { id: r.id }, data: { value } });
    affected.add(`${r.memberId}:${r.weekNumber}`);
  }

  for (const key of affected) {
    const [memberId, weekNumber] = key.split(":").map(Number);
    await recomputeWeeklyStat(category.id, category.key, memberId, weekNumber);
  }

  return records.length;
}

async function upsertWeeklyStat(
  memberId: number,
  weekNumber: number,
  categoryKey: string,
  value: number,
  rank: number | undefined
): Promise<void> {
  await prisma.weeklyStat.upsert({
    where: { memberId_weekNumber_categoryKey: { memberId, weekNumber, categoryKey } },
    update: { value, rank: rank ?? null },
    create: { memberId, weekNumber, categoryKey, value, rank: rank ?? null },
  });
}

export const ALLIANCE_RANK_CATEGORY_KEY = "alliance_rank";

// Alliance rank has no dedicated Category row (it's a sub-field of roster/ranking_list
// screenshots, not its own extractable screenshot type) but still gets tracked per week
// like any other stat, via this categoryKey with no backing Category - the same pattern
// this app already uses for Canyon Storm/Zombie Siege (see lib/mvp/data.ts).
// Member.allianceRank stays as a "current" convenience field, but is only overwritten
// when this week is now the latest known week of rank history for the member - so a
// historical backfill (or an out-of-order screenshot) can never regress a newer rank.
export async function recordAllianceRank(memberId: number, weekNumber: number, allianceRank: string): Promise<void> {
  const rankNumber = Number(allianceRank.replace(/[^0-9]/g, ""));
  if (!Number.isFinite(rankNumber) || rankNumber <= 0) return;

  await upsertWeeklyStat(memberId, weekNumber, ALLIANCE_RANK_CATEGORY_KEY, rankNumber, undefined);

  const latest = await prisma.weeklyStat.findFirst({
    where: { memberId, categoryKey: ALLIANCE_RANK_CATEGORY_KEY },
    orderBy: { weekNumber: "desc" },
  });
  if (latest && latest.weekNumber === weekNumber) {
    await prisma.member.update({ where: { id: memberId }, data: { allianceRank: `R${rankNumber}` } });
  }
}

// Applies a pending_confirmation (Tier B) RawExtraction once a person has reviewed it -
// this is the only path that ever writes free_text data.
export async function confirmRawExtraction(id: number): Promise<void> {
  const row = await prisma.rawExtraction.findUniqueOrThrow({ where: { id } });
  if (row.status !== "pending_confirmation") {
    throw new Error(`RawExtraction ${id} is not pending confirmation (status: ${row.status})`);
  }

  const category = await prisma.category.findUniqueOrThrow({ where: { key: row.categoryKey } });
  const extracted = JSON.parse(row.rawJson) as RankingListResult | RosterResult | FreeTextResult;

  await writeExtraction(category, extracted, row.weekNumber);
  await prisma.rawExtraction.update({ where: { id }, data: { status: "committed" } });
}

export async function rejectRawExtraction(id: number): Promise<void> {
  const row = await prisma.rawExtraction.findUniqueOrThrow({ where: { id } });
  if (row.status !== "pending_confirmation") {
    throw new Error(`RawExtraction ${id} is not pending confirmation (status: ${row.status})`);
  }
  await prisma.rawExtraction.update({ where: { id }, data: { status: "rejected" } });
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
