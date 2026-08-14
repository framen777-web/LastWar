import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

// The Gemini API key is secret-ish (stored in the app DB, not just an env var) - never
// echo its raw value back to the client. Callers instead get a `geminiApiKeySet` boolean.
async function buildSettingsResponse(): Promise<{ settings: Record<string, string>; geminiApiKeySet: boolean }> {
  const settings = await prisma.setting.findMany();
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const geminiApiKeySet = !!map.geminiApiKey || !!process.env.GEMINI_API_KEY;
  delete map.geminiApiKey;
  return { settings: map, geminiApiKeySet };
}

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  return NextResponse.json(await buildSettingsResponse());
}

export async function PATCH(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as Record<string, string>;

  for (const [key, value] of Object.entries(body)) {
    // Blank means "leave unchanged" for the API key - saving other settings should never
    // accidentally clear it.
    if (key === "geminiApiKey" && value === "") continue;
    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  return NextResponse.json(await buildSettingsResponse());
}
