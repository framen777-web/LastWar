import { NextResponse } from "next/server";
import { DEFAULT_WEIGHTS, getWeights, saveWeights } from "@/lib/mvp/weights";
import type { Weights } from "@/lib/mvp/mvp";
import { requireAdminApi } from "@/lib/auth/dal";

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const weights = await getWeights();
  return NextResponse.json({ weights });
}

export async function PATCH(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as Partial<Weights>;

  const merged: Weights = { ...DEFAULT_WEIGHTS, ...(await getWeights()), ...body };

  for (const [key, value] of Object.entries(merged)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return NextResponse.json({ error: `Weight "${key}" must be a number >= 0.` }, { status: 400 });
    }
  }

  await saveWeights(merged);
  return NextResponse.json({ weights: merged });
}
