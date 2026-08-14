import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { recomputeWeeklyStat } from "@/lib/pipeline/run";

type RouteCtx = RouteContext<"/api/weeks/[weekNumber]/members/[memberId]/categories/[categoryKey]">;

function parseParams(
  weekNumberParam: string,
  memberIdParam: string
): { weekNumber: number; memberId: number } | null {
  const weekNumber = Number(weekNumberParam);
  const memberId = Number(memberIdParam);
  if (!Number.isInteger(weekNumber) || !Number.isInteger(memberId)) return null;
  return { weekNumber, memberId };
}

// Multitable (dashboard/multi) shows one column per individual import (dedupKey) for a
// multi-mode category - a "row" there is one member's records across every import for the
// selected category+week, distinct from the whole-week/all-categories delete under
// /api/weeks/[weekNumber]/members/[memberId].
export async function DELETE(_request: Request, ctx: RouteCtx) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { weekNumber: weekNumberParam, memberId: memberIdParam, categoryKey } = await ctx.params;
  const parsed = parseParams(weekNumberParam, memberIdParam);
  if (!parsed) return NextResponse.json({ error: "Invalid week number or member id" }, { status: 400 });
  const { weekNumber, memberId } = parsed;

  const category = await prisma.category.findUnique({ where: { key: categoryKey } });
  if (!category) return NextResponse.json({ error: "Category not found." }, { status: 404 });

  const categoryRecords = await prisma.categoryRecord.deleteMany({ where: { categoryId: category.id, memberId, weekNumber } });
  const weeklyStats = await prisma.weeklyStat.deleteMany({ where: { memberId, weekNumber, categoryKey } });

  return NextResponse.json({ deleted: true, weekNumber, memberId, categoryKey, categoryRecordsDeleted: categoryRecords.count, weeklyStatsDeleted: weeklyStats.count });
}

type PatchBody = {
  // dedupKey (import id) -> value in the same post-divisor units shown on screen; null deletes that import's record.
  values?: Record<string, number | null>;
};

export async function PATCH(request: Request, ctx: RouteCtx) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { weekNumber: weekNumberParam, memberId: memberIdParam, categoryKey } = await ctx.params;
  const parsed = parseParams(weekNumberParam, memberIdParam);
  if (!parsed) return NextResponse.json({ error: "Invalid week number or member id" }, { status: 400 });
  const { weekNumber, memberId } = parsed;

  const category = await prisma.category.findUnique({ where: { key: categoryKey } });
  if (!category) return NextResponse.json({ error: "Category not found." }, { status: 404 });

  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return NextResponse.json({ error: "Member not found." }, { status: 404 });

  const body = (await request.json()) as PatchBody;

  for (const [dedupKey, value] of Object.entries(body.values ?? {})) {
    const key = { categoryId_memberId_weekNumber_dedupKey: { categoryId: category.id, memberId, weekNumber, dedupKey } };
    if (value === null) {
      await prisma.categoryRecord.deleteMany({ where: { categoryId: category.id, memberId, weekNumber, dedupKey } });
      continue;
    }
    if (!Number.isFinite(value)) {
      return NextResponse.json({ error: `Value for "${dedupKey}" must be a number or null.` }, { status: 400 });
    }
    // Keep rawValue consistent with `value = rawValue / divisor` so a later divisor
    // correction (recomputeCategoryFromRawValue) re-derives this manual edit correctly too.
    const rawValue = value * category.divisor;
    await prisma.categoryRecord.upsert({
      where: key,
      update: { rawValue, value },
      create: { categoryId: category.id, memberId, weekNumber, dedupKey, rawValue, value },
    });
  }

  await recomputeWeeklyStat(category.id, category.key, memberId, weekNumber);

  return NextResponse.json({ ok: true });
}
