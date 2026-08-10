import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const weeks = await prisma.weeklyStat.findMany({
    select: { weekNumber: true },
    distinct: ["weekNumber"],
    orderBy: { weekNumber: "desc" },
  });

  const weekNumbers = weeks.map((w) => w.weekNumber);

  return NextResponse.json({
    weeks: weekNumbers,
    defaultWeek: weekNumbers.length > 0 ? weekNumbers[0] : 1,
  });
}
