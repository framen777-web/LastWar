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

  const raw = await generateJson({
    prompt: buildClassifyPrompt(categories),
    imageBase64,
    mimeType,
    schema: buildClassifySchema(categories),
  });

  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Gemini returned a non-object classification response: ${JSON.stringify(raw)}`);
  }
  const { category_key, confidence } = raw as { category_key?: unknown; confidence?: unknown };

  return {
    categoryKey: typeof category_key === "string" ? category_key : "unknown",
    confidence: typeof confidence === "number" ? confidence : 0,
  };
}
