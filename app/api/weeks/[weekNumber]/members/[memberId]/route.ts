import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { recordAllianceRank } from "@/lib/pipeline/run";

function parseParams(weekNumberParam: string, memberIdParam: string): { weekNumber: number; memberId: number } | null {
  const weekNumber = Number(weekNumberParam);
  const memberId = Number(memberIdParam);
  if (!Number.isInteger(weekNumber) || !Number.isInteger(memberId)) return null;
  return { weekNumber, memberId };
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/weeks/[weekNumber]/members/[memberId]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { weekNumber: weekNumberParam, memberId: memberIdParam } = await ctx.params;
  const parsed = parseParams(weekNumberParam, memberIdParam);
  if (!parsed) return NextResponse.json({ error: "Invalid week number or member id" }, { status: 400 });
  const { weekNumber, memberId } = parsed;

  const [weeklyStats, categoryRecords] = await Promise.all([
    prisma.weeklyStat.deleteMany({ where: { weekNumber, memberId } }),
    prisma.categoryRecord.deleteMany({ where: { weekNumber, memberId } }),
  ]);

  return NextResponse.json({
    deleted: true,
    weekNumber,
    memberId,
    weeklyStatsDeleted: weeklyStats.count,
    categoryRecordsDeleted: categoryRecords.count,
  });
}

type PatchBody = {
  // 1-5, or null to clear this week's rank reading.
  allianceRank?: number | null;
  // categoryKey -> value; value null deletes that category's WeeklyStat row for this member/week.
  categoryValues?: Record<string, number | null>;
  // null clears all four fields for this member/week.
  squads?: { air?: number | null; tank?: number | null; missile?: number | null; fourth?: number | null } | null;
};

export async function PATCH(request: Request, ctx: RouteContext<"/api/weeks/[weekNumber]/members/[memberId]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { weekNumber: weekNumberParam, memberId: memberIdParam } = await ctx.params;
  const parsed = parseParams(weekNumberParam, memberIdParam);
  if (!parsed) return NextResponse.json({ error: "Invalid week number or member id" }, { status: 400 });
  const { weekNumber, memberId } = parsed;

  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return NextResponse.json({ error: "Member not found." }, { status: 404 });

  const body = (await request.json()) as PatchBody;

  if (body.allianceRank !== undefined) {
    if (body.allianceRank === null) {
      await prisma.weeklyStat.deleteMany({ where: { memberId, weekNumber, categoryKey: "alliance_rank" } });
    } else if (Number.isInteger(body.allianceRank) && body.allianceRank >= 1 && body.allianceRank <= 5) {
      await recordAllianceRank(memberId, weekNumber, `R${body.allianceRank}`);
    } else {
      return NextResponse.json({ error: "allianceRank must be an integer 1-5 or null." }, { status: 400 });
    }
  }

  if (body.categoryValues) {
    for (const [categoryKey, value] of Object.entries(body.categoryValues)) {
      if (value === null) {
        await prisma.weeklyStat.deleteMany({ where: { memberId, weekNumber, categoryKey } });
        continue;
      }
      if (!Number.isFinite(value)) {
        return NextResponse.json({ error: `Value for "${categoryKey}" must be a number or null.` }, { status: 400 });
      }
      await prisma.weeklyStat.upsert({
        where: { memberId_weekNumber_categoryKey: { memberId, weekNumber, categoryKey } },
        update: { value },
        create: { memberId, weekNumber, categoryKey, value },
      });
    }
  }

  if (body.squads !== undefined) {
    const squadsCategory = await prisma.category.findUnique({ where: { key: "squads" } });
    if (squadsCategory) {
      const key = { categoryId_memberId_weekNumber_dedupKey: { categoryId: squadsCategory.id, memberId, weekNumber, dedupKey: "" } };
      if (body.squads === null) {
        await prisma.categoryRecord.deleteMany({ where: { categoryId: squadsCategory.id, memberId, weekNumber, dedupKey: "" } });
      } else {
        const fields = {
          air: body.squads.air ?? null,
          tank: body.squads.tank ?? null,
          missile: body.squads.missile ?? null,
          fourth: body.squads.fourth ?? null,
        };
        await prisma.categoryRecord.upsert({
          where: key,
          update: { fields: JSON.stringify(fields) },
          create: { categoryId: squadsCategory.id, memberId, weekNumber, dedupKey: "", rawValue: 0, value: 0, fields: JSON.stringify(fields) },
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
