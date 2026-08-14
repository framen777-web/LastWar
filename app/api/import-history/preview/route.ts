import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { parseCsv } from "@/lib/importCsv/parseCsv";
import { applyMapping } from "@/lib/importCsv/applyMapping";
import { findMemberId, stripAllianceTag } from "@/lib/pipeline/matchMemberCore";
import type { ImportMapping } from "@/lib/importCsv/types";

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { csvText?: string; mapping?: ImportMapping };
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
  const resolvedMemberId = new Map<string, number>();

  for (const row of mappedRows) {
    weeksFound.add(row.weekNumber);
    if (matchedMembers.has(row.memberName) || newMemberNames.has(row.memberName)) continue;

    const id = findMemberId(row.memberName, members);
    if (id !== null) {
      matchedMembers.set(row.memberName, memberIdByName.get(id) ?? row.memberName);
      resolvedMemberId.set(row.memberName, id);
    } else {
      newMemberNames.add(stripAllianceTag(row.memberName));
    }
  }

  const categoryKeys = [
    ...new Set([
      ...body.mapping.categoryMappings.map((c) => c.categoryKey),
      ...body.mapping.customFields.map((c) => c.categoryKey),
      ...(body.mapping.allianceRankColumn !== undefined ? ["alliance_rank"] : []),
    ]),
  ];
  const weeksArr = [...weeksFound].sort((a, b) => a - b);

  const existing =
    categoryKeys.length && weeksArr.length
      ? await prisma.weeklyStat.findMany({
          where: { categoryKey: { in: categoryKeys }, weekNumber: { in: weeksArr } },
          select: { memberId: true, weekNumber: true, categoryKey: true },
        })
      : [];
  const existingSet = new Set(existing.map((e) => `${e.memberId}:${e.weekNumber}:${e.categoryKey}`));

  let collisions = 0;
  for (const row of mappedRows) {
    const memberId = resolvedMemberId.get(row.memberName);
    if (memberId === undefined) continue;
    for (const cv of row.categoryValues) {
      if (existingSet.has(`${memberId}:${row.weekNumber}:${cv.categoryKey}`)) collisions++;
    }
  }

  const sampleRows = mappedRows.slice(0, 10).map((r) => ({
    memberName: r.memberName,
    weekNumber: r.weekNumber,
    values: Object.fromEntries(r.categoryValues.map((cv) => [cv.categoryKey, cv.value])),
    squads: r.squadsFields,
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
