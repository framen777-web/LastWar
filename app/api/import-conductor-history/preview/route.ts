import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { parseCsv } from "@/lib/importCsv/parseCsv";
import { applyMapping } from "@/lib/importConductorHistory/applyMapping";
import { findMemberId, stripAllianceTag } from "@/lib/pipeline/matchMemberCore";
import type { ConductorHistoryMapping } from "@/lib/importConductorHistory/types";

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { csvText?: string; mapping?: ConductorHistoryMapping };
  if (!body.csvText || !body.mapping) {
    return NextResponse.json({ error: "csvText and mapping are required." }, { status: 400 });
  }

  const { headers, rows } = parseCsv(body.csvText);
  const mappedRows = applyMapping(headers, rows, body.mapping);

  const members = await prisma.member.findMany();
  const memberIdByName = new Map(members.map((m) => [m.id, m.name]));

  const matchedMembers = new Map<string, string>();
  const newMemberNames = new Set<string>();
  const weeksFound = new Set<number>();

  function resolve(name: string) {
    if (matchedMembers.has(name) || newMemberNames.has(name)) return;
    const id = findMemberId(name, members);
    if (id !== null) matchedMembers.set(name, memberIdByName.get(id) ?? name);
    else newMemberNames.add(stripAllianceTag(name));
  }

  for (const row of mappedRows) {
    weeksFound.add(row.weekNumber);
    resolve(row.conductorName);
    if (row.passengerName) resolve(row.passengerName);
  }

  const weeksArr = [...weeksFound].sort((a, b) => a - b);
  const existingRounds = weeksArr.length
    ? await prisma.conductorRound.findMany({
        where: { weeksInCycle: 1, startWeek: { in: weeksArr } },
        include: { selections: true },
      })
    : [];
  const existingSet = new Set<string>();
  for (const r of existingRounds) {
    for (const s of r.selections) existingSet.add(`${r.startWeek}:${s.slotIndex}:${s.role}`);
  }

  let collisions = 0;
  for (const row of mappedRows) {
    if (existingSet.has(`${row.weekNumber}:${row.slotIndex}:conductor`)) collisions++;
    if (row.passengerName && existingSet.has(`${row.weekNumber}:${row.slotIndex}:passenger`)) collisions++;
  }

  const sampleRows = mappedRows.slice(0, 10).map((r) => ({
    weekNumber: r.weekNumber,
    conductorName: r.conductorName,
    points: r.points,
    passengerName: r.passengerName,
  }));

  return NextResponse.json({
    totalRows: mappedRows.length,
    weeksFound: weeksArr,
    matchedMembers: [...matchedMembers.entries()].map(([raw, matchedName]) => ({ raw, matchedName })),
    newMembers: [...newMemberNames].sort(),
    allMembers: members.map((m) => ({ id: m.id, name: m.name })).sort((a, b) => a.name.localeCompare(b.name)),
    sampleRows,
    collisions,
  });
}
