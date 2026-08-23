import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { parseCsv, parseCsvNumber } from "@/lib/importCsv/parseCsv";
import { findMemberId, stripAllianceTag } from "@/lib/pipeline/matchMemberCore";

export type ExtrasMapping = {
  memberColumn: string;
  // CSV header -> this season's SeasonExtraItem.key
  itemColumns: Record<string, string>;
};

export async function POST(request: Request, ctx: RouteContext<"/api/seasons/[id]/upload-extras/preview">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const seasonId = Number(id);

  const body = (await request.json()) as { csvText?: string; mapping?: ExtrasMapping };
  if (!body.csvText || !body.mapping || !body.mapping.memberColumn) {
    return NextResponse.json({ error: "csvText and a member column mapping are required." }, { status: 400 });
  }

  const items = await prisma.seasonExtraItem.findMany({ where: { seasonId } });
  const itemKeys = new Set(items.map((i) => i.key));
  const itemColumns = Object.entries(body.mapping.itemColumns).filter(([, key]) => itemKeys.has(key));

  const { headers, rows } = parseCsv(body.csvText);
  const memberIdx = headers.indexOf(body.mapping.memberColumn);
  if (memberIdx === -1) return NextResponse.json({ error: "Mapped member column not found in the file." }, { status: 400 });
  const itemIdxByKey = itemColumns.map(([header, key]) => ({ key, idx: headers.indexOf(header) })).filter((c) => c.idx !== -1);

  const members = await prisma.member.findMany();
  const matchedMembers = new Map<string, string>();
  const newMemberNames = new Set<string>();
  const sampleRows: { memberName: string; values: Record<string, number> }[] = [];

  let totalRows = 0;
  for (const row of rows) {
    const memberName = (row[memberIdx] ?? "").trim();
    if (!memberName) continue;
    totalRows++;

    if (!matchedMembers.has(memberName) && !newMemberNames.has(memberName)) {
      const matchedId = findMemberId(memberName, members);
      if (matchedId !== null) {
        matchedMembers.set(memberName, members.find((m) => m.id === matchedId)?.name ?? memberName);
      } else {
        newMemberNames.add(stripAllianceTag(memberName));
      }
    }

    if (sampleRows.length < 10) {
      const values: Record<string, number> = {};
      for (const c of itemIdxByKey) {
        const v = parseCsvNumber(row[c.idx]);
        if (v !== null) values[c.key] = v;
      }
      sampleRows.push({ memberName, values });
    }
  }

  return NextResponse.json({
    totalRows,
    matchedMembers: [...matchedMembers.entries()].map(([raw, matchedName]) => ({ raw, matchedName })),
    newMembers: [...newMemberNames].sort(),
    allMembers: members.map((m) => ({ id: m.id, name: m.name })).sort((a, b) => a.name.localeCompare(b.name)),
    sampleRows,
  });
}
