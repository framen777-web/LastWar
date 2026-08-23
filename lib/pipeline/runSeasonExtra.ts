import { prisma } from "@/lib/db";
import { generateJson } from "@/lib/ai/gemini";
import { buildClassifyPrompt, buildClassifySchema, CONFIDENCE_THRESHOLD, type CategoryForPrompt } from "@/lib/ai/prompts";
import { extract, type RankingListResult } from "@/lib/ai/extract";
import { matchMember } from "./matchMember";
import { hasAllianceTag } from "./matchMemberCore";

export type SeasonExtraPipelineStatus = "committed" | "needs_review" | "error";
export type SeasonExtraPipelineResult = {
  filename: string;
  itemKey: string;
  confidence: number;
  status: SeasonExtraPipelineStatus;
  writtenCount?: number;
  skippedCount?: number; // rows with no alliance-tag prefix - see writeSeasonExtraRows below
  message?: string;
};

/** Same shape as lib/ai/classify.ts's classify(), but sourcing candidates from this season's
 *  SeasonExtraItem rows instead of the Category table - buildClassifyPrompt/buildClassifySchema
 *  are already generic over CategoryForPrompt, so no changes needed there. */
async function classifySeasonExtra(seasonId: number, imageBase64: string, mimeType: string): Promise<{ itemKey: string; confidence: number }> {
  const items = await prisma.seasonExtraItem.findMany({ where: { seasonId } });
  const candidates: CategoryForPrompt[] = items.map((i) => ({ key: i.key, name: i.name, description: null, shape: "ranking_list" }));
  if (candidates.length === 0) return { itemKey: "unknown", confidence: 0 };

  const raw = await generateJson({
    prompt: buildClassifyPrompt(candidates),
    imageBase64,
    mimeType,
    schema: buildClassifySchema(candidates),
  });
  const { category_key, confidence } = raw as { category_key?: unknown; confidence?: unknown };
  return {
    itemKey: typeof category_key === "string" ? category_key : "unknown",
    confidence: typeof confidence === "number" ? confidence : 0,
  };
}

export async function runSeasonExtraPipelineForImage(params: {
  filename: string;
  buffer: Buffer;
  mimeType: string;
  seasonId: number;
  /** When set, skips classification entirely and extracts directly against this item - used
   *  when the admin picks a specific item instead of leaving it on auto-detect. */
  forcedItemKey?: string;
}): Promise<SeasonExtraPipelineResult> {
  const imageBase64 = params.buffer.toString("base64");

  let itemKey = params.forcedItemKey ?? "unknown";
  let confidence = params.forcedItemKey ? 1 : 0;

  if (!params.forcedItemKey) {
    try {
      const result = await classifySeasonExtra(params.seasonId, imageBase64, params.mimeType);
      itemKey = result.itemKey;
      confidence = result.confidence;
    } catch (err) {
      await logResult(params, "unknown", 0, "needs_review");
      return { filename: params.filename, itemKey: "unknown", confidence: 0, status: "error", message: describeError(err) };
    }

    if (itemKey === "unknown" || confidence < CONFIDENCE_THRESHOLD) {
      await logResult(params, itemKey, confidence, "needs_review");
      return { filename: params.filename, itemKey, confidence, status: "needs_review" };
    }
  }

  const item = await prisma.seasonExtraItem.findFirst({ where: { seasonId: params.seasonId, key: itemKey } });
  if (!item) {
    await logResult(params, itemKey, confidence, "needs_review");
    return { filename: params.filename, itemKey, confidence, status: "needs_review" };
  }

  try {
    const pseudoCategory: CategoryForPrompt = { key: item.key, name: item.name, description: null, shape: "ranking_list" };
    const extracted = (await extract(pseudoCategory, imageBase64, params.mimeType)) as RankingListResult;

    const { written, skipped } = await writeSeasonExtraRows(item.id, extracted);
    await logResult(params, itemKey, confidence, "committed", JSON.stringify(extracted));

    return { filename: params.filename, itemKey, confidence, status: "committed", writtenCount: written, skippedCount: skipped };
  } catch (err) {
    await logResult(params, itemKey, confidence, "needs_review");
    return { filename: params.filename, itemKey, confidence, status: "error", message: describeError(err) };
  }
}

/** One row per screenshot's extracted member/value pairs, upserted into SeasonExtraValue by
 *  [itemId, memberId] - always overwrites in place (a season item is a single final total, no
 *  weekly dimension to dedupe against). alliance_rank is part of the shared ranking_list schema
 *  but deliberately unused here - it's a weekly concept (see recordAllianceRank in
 *  lib/pipeline/run.ts) that doesn't apply to a one-time season total. A leaderboard that's
 *  paginated across several screenshots (e.g. ranks 1-50, then 51-100) works naturally here with
 *  no extra handling: each screenshot only touches the members it actually lists, so uploading
 *  the second page doesn't disturb the first page's members. Re-uploading a corrected screenshot
 *  for a member already written just overwrites their value, which is the desired fix path.
 *
 *  A season-summary screenshot covers everyone who contributed at ANY point in the season,
 *  including members who've since left - unlike a weekly screenshot (taken while everyone shown
 *  is still current), so it's the one place this actually comes up. The game only tags members
 *  CURRENTLY in RUNE with the "[RUNE] " prefix; a departed member's row shows either their bare
 *  name (no tag at all) or a different alliance's tag if they joined elsewhere - hasAllianceTag()
 *  checks for "RUNE" specifically (see matchMemberCore.ts), not just "some bracket," so both
 *  cases are caught. Rows that fail that check are skipped entirely here - not matched, not
 *  auto-created, not written - both because departed members don't collect season rewards anyway
 *  (see the isActive filter in computeSeasonPoints/computeSeasonPositional) and because matching
 *  an untagged name against the roster is more likely to misfire (coincidental fuzzy match, or a
 *  spurious new Member row) than to help. This check is scoped to season extras only - the
 *  regular weekly pipeline (lib/pipeline/run.ts) doesn't need it, since a live weekly screenshot
 *  naturally only shows people who were still tagged members at that moment. */
async function writeSeasonExtraRows(itemId: number, extracted: RankingListResult): Promise<{ written: number; skipped: number }> {
  let written = 0;
  let skipped = 0;
  for (const row of extracted.rows) {
    if (!hasAllianceTag(row.member_name)) {
      skipped++;
      continue;
    }
    const memberId = await matchMember(row.member_name);
    await prisma.seasonExtraValue.upsert({
      where: { itemId_memberId: { itemId, memberId } },
      update: { rawValue: row.value },
      create: { itemId, memberId, rawValue: row.value },
    });
    written++;
  }
  return { written, skipped };
}

async function logResult(
  params: { filename: string; seasonId: number },
  itemKey: string,
  confidence: number,
  status: "committed" | "needs_review",
  rawJson = "{}"
): Promise<void> {
  await prisma.rawSeasonExtraction.create({
    data: { imageFilename: params.filename, seasonId: params.seasonId, itemKey, rawJson, confidence, status },
  });
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
