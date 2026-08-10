import { generateJson } from "./gemini";
import { buildExtractionPrompt, getExtractionSchema, type CategoryForPrompt } from "./prompts";

export type RankingRow = {
  rank: number;
  member_name: string;
  value: number;
  alliance_rank?: string;
};

export type RankingListResult = { event_date?: string; rows: RankingRow[] };

export type RosterResult = {
  members: Array<{
    name: string;
    level?: number;
    status?: string;
    last_active?: string;
    alliance_rank?: string;
  }>;
};

export type FreeTextResult = {
  members: Array<{
    member_name: string;
    air?: number;
    tank?: number;
    missile?: number;
    fourth?: number;
  }>;
};

export async function extract(
  category: CategoryForPrompt,
  imageBase64: string,
  mimeType: string
): Promise<RankingListResult | RosterResult | FreeTextResult> {
  const result = await generateJson({
    prompt: buildExtractionPrompt(category),
    imageBase64,
    mimeType,
    schema: getExtractionSchema(category.shape),
  });

  return result as RankingListResult | RosterResult | FreeTextResult;
}
