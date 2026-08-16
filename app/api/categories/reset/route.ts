import { NextResponse } from "next/server";
import { resetCategoryWeek } from "@/lib/categories/reset";
import { requireAdminApi } from "@/lib/auth/dal";

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { categoryKey?: string; weekNumber?: number };
  const { categoryKey, weekNumber } = body;
  if (typeof categoryKey !== "string" || typeof weekNumber !== "number" || !Number.isInteger(weekNumber) || weekNumber < 1) {
    return NextResponse.json({ error: "categoryKey and a valid weekNumber are required." }, { status: 400 });
  }

  try {
    const result = await resetCategoryWeek(categoryKey, weekNumber);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to reset." }, { status: 400 });
  }
}
