import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/weeks/[weekNumber]">) {
  const { weekNumber: weekNumberParam } = await ctx.params;
  const weekNumber = Number(weekNumberParam);

  if (!Number.isInteger(weekNumber)) {
    return NextResponse.json({ error: "Invalid week number" }, { status: 400 });
  }

  const [weeklyStats, categoryRecords] = await Promise.all([
    prisma.weeklyStat.deleteMany({ where: { weekNumber } }),
    prisma.categoryRecord.deleteMany({ where: { weekNumber } }),
  ]);

  return NextResponse.json({
    deleted: true,
    weekNumber,
    weeklyStatsDeleted: weeklyStats.count,
    categoryRecordsDeleted: categoryRecords.count,
  });
}
