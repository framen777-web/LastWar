import { prisma } from "@/lib/db";

const DEFAULT_MIN_PASSWORD_LENGTH = 8;

export async function getMinPasswordLength(): Promise<number> {
  const setting = await prisma.setting.findUnique({ where: { key: "minPasswordLength" } });
  const parsed = setting ? Number(setting.value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MIN_PASSWORD_LENGTH;
}

export async function getGeminiApiKey(): Promise<string | undefined> {
  const setting = await prisma.setting.findUnique({ where: { key: "geminiApiKey" } });
  return setting?.value || process.env.GEMINI_API_KEY;
}

export async function getGeneralPassword(): Promise<string | undefined> {
  const setting = await prisma.setting.findUnique({ where: { key: "generalPassword" } });
  return setting?.value || undefined;
}

const DEFAULT_ALLIANCE_TAG = "RUNE";

export async function getAllianceTag(): Promise<string> {
  const setting = await prisma.setting.findUnique({ where: { key: "allianceTag" } });
  const value = setting?.value?.trim();
  return value || DEFAULT_ALLIANCE_TAG;
}
