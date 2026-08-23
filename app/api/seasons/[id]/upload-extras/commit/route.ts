import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { parseCsv, parseCsvNumber } from "@/lib/importCsv/parseCsv";
import { resolveOrRenameMember } from "@/lib/pipeline/renameMember";
import { loadEditableSeason } from "@/lib/season/validate";
import type { ExtrasMapping } from "../preview/route";

// Always overwrites in place - this is a one-time final total, not an incremental import,
// so there's no "overwrite existing" checkbox the way Import History has one.
export async function POST(request: Request, ctx: RouteContext<"/api/seasons/[id]/upload-extras/commit">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const seasonId = Number(id);

  const guard = await loadEditableSeason(seasonId);
  if ("error" in guard) return guard.error;

  const body = (await request.json()) as {
    csvText?: string;
    mapping?: ExtrasMapping;
    resolutions?: Record<string, number | null>;
  };
  if (!body.csvText || !body.mapping || !body.mapping.memberColumn) {
    return NextResponse.json({ error: "csvText and a member column mapping are required." }, { status: 400 });
  }
  const resolutions = body.resolutions ?? {};

  const items = await prisma.seasonExtraItem.findMany({ where: { seasonId } });
  const itemIdByKey = new Map(items.map((i) => [i.key, i.id]));
  const itemColumns = Object.entries(body.mapping.itemColumns).filter(([, key]) => itemIdByKey.has(key));

  const { headers, rows } = parseCsv(body.csvText);
  const memberIdx = headers.indexOf(body.mapping.memberColumn);
  if (memberIdx === -1) return NextResponse.json({ error: "Mapped member column not found in the file." }, { status: 400 });
  const itemIdxByKey = itemColumns.map(([header, key]) => ({ key, idx: headers.indexOf(header) })).filter((c) => c.idx !== -1);

  let rowsProcessed = 0;
  let valuesWritten = 0;
  const newMembersCreated = new Set<string>();

  for (const row of rows) {
    const memberName = (row[memberIdx] ?? "").trim();
    if (!memberName) continue;
    rowsProcessed++;

    const memberCountBefore = await prisma.member.count();
    const memberId = await resolveOrRenameMember(memberName, resolutions);
    if ((await prisma.member.count()) > memberCountBefore) newMembersCreated.add(memberName);

    for (const c of itemIdxByKey) {
      const value = parseCsvNumber(row[c.idx]);
      if (value === null) continue;
      const itemId = itemIdByKey.get(c.key)!;
      await prisma.seasonExtraValue.upsert({
        where: { itemId_memberId: { itemId, memberId } },
        update: { rawValue: value },
        create: { itemId, memberId, rawValue: value },
      });
      valuesWritten++;
    }
  }

  return NextResponse.json({ rowsProcessed, valuesWritten, newMembersCreated: [...newMembersCreated].sort() });
}
