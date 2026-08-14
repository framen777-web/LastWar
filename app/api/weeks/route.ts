import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

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
