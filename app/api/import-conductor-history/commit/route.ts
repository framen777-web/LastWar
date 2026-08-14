import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { parseCsv } from "@/lib/importCsv/parseCsv";
import { applyMapping } from "@/lib/importConductorHistory/applyMapping";
import { resolveOrRenameMember } from "@/lib/pipeline/renameMember";
import type { ConductorHistoryMapping } from "@/lib/importConductorHistory/types";

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as {
    csvText?: string;
    mapping?: ConductorHistoryMapping;
    overwriteExisting?: boolean;
    resolutions?: Record<string, number | null>;
  };
  if (!body.csvText || !body.mapping) {
    return NextResponse.json({ error: "csvText and mapping are required." }, { status: 400 });
  }
  const overwriteExisting = !!body.overwriteExisting;
  const resolutions = body.resolutions ?? {};

  const { headers, rows } = parseCsv(body.csvText);
  const mappedRows = applyMapping(headers, rows, body.mapping);

  let selectionsWritten = 0;
  let selectionsSkipped = 0;
  let roundsCreated = 0;
  const newMembersCreated = new Set<string>();
  const weeksTouched = new Set<number>();
  const roundIdByWeek = new Map<number, number>();

  async function getRoundId(weekNumber: number): Promise<number> {
    const cached = roundIdByWeek.get(weekNumber);
    if (cached !== undefined) return cached;

    const existing = await prisma.conductorRound.findFirst({ where: { weeksInCycle: 1, startWeek: weekNumber, source: "imported" } });
    if (existing) {
      roundIdByWeek.set(weekNumber, existing.id);
      return existing.id;
    }

    const created = await prisma.conductorRound.create({
      data: { weeksInCycle: 1, startWeek: weekNumber, status: "confirmed", source: "imported", confirmedAt: new Date() },
    });
    roundsCreated++;
    roundIdByWeek.set(weekNumber, created.id);
    return created.id;
  }

  async function upsertSelection(
    roundId: number,
    slotIndex: number,
    role: "conductor" | "passenger",
    weekNumber: number,
    memberName: string,
    pointsAtSelection: number | null
  ) {
    const memberCountBefore = await prisma.member.count();
    const memberId = await resolveOrRenameMember(memberName, resolutions);
    if ((await prisma.member.count()) > memberCountBefore) newMembersCreated.add(memberName);

    const key = { roundId_slotIndex_role: { roundId, slotIndex, role } };
    if (!overwriteExisting) {
      const existing = await prisma.conductorSelection.findUnique({ where: key });
      if (existing) {
        selectionsSkipped++;
        return;
      }
    }
    await prisma.conductorSelection.upsert({
      where: key,
      update: { memberId, pointsAtSelection },
      create: { roundId, memberId, role, slotIndex, weekNumber, pointsAtSelection },
    });
    selectionsWritten++;
  }

  for (const row of mappedRows) {
    weeksTouched.add(row.weekNumber);
    const roundId = await getRoundId(row.weekNumber);

    await upsertSelection(roundId, row.slotIndex, "conductor", row.weekNumber, row.conductorName, row.points);
    if (row.passengerName) {
      await upsertSelection(roundId, row.slotIndex, "passenger", row.weekNumber, row.passengerName, null);
    }
  }

  return NextResponse.json({
    rowsProcessed: mappedRows.length,
    roundsCreated,
    selectionsWritten,
    selectionsSkipped,
    newMembersCreated: [...newMembersCreated].sort(),
    weeksTouched: [...weeksTouched].sort((a, b) => a - b),
  });
}
