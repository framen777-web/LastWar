import { prisma } from "@/lib/db";
import { generateJson } from "./gemini";
import { buildClassifyPrompt, buildClassifySchema, type CategoryForPrompt } from "./prompts";

export type ClassifyResult = {
  categoryKey: string;
  confidence: number;
};

export async function classify(imageBase64: string, mimeType: string): Promise<ClassifyResult> {
  const categories: CategoryForPrompt[] = await prisma.category.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });

  if (categories.length === 0) {
    return { categoryKey: "unknown", confidence: 0 };
  }

  const raw = (await generateJson({
    prompt: buildClassifyPrompt(categories),
    imageBase64,
    mimeType,
    schema: buildClassifySchema(categories),
  })) as { category_key?: string; confidence?: number };

  return {
    categoryKey: raw.category_key ?? "unknown",
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
  };
}
