import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { parseCsv } from "@/lib/importCsv/parseCsv";
import { applyMapping } from "@/lib/importCsv/applyMapping";
import { resolveOrRenameMember } from "@/lib/pipeline/renameMember";
import type { ImportMapping } from "@/lib/importCsv/types";

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as {
    csvText?: string;
    mapping?: ImportMapping;
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

  const squadsCategory = body.mapping.squadsMapping ? await prisma.category.findUnique({ where: { key: "squads" } }) : null;

  let weeklyStatsWritten = 0;
  let weeklyStatsSkipped = 0;
  let categoryRecordsWritten = 0;
  let categoryRecordsSkipped = 0;
  const newMembersCreated = new Set<string>();
  const weeksTouched = new Set<number>();
  // Rank is written into WeeklyStat per week below (as categoryKey "alliance_rank", part
  // of row.categoryValues) same as any other mapped field. This set just tracks which
  // members had a rank mapped, so we know whose "current" allianceRank field to refresh
  // afterward - from the true latest week on record, not just the latest seen in this batch.
  const membersWithRankData = new Set<number>();

  for (const row of mappedRows) {
    const memberCountBefore = await prisma.member.count();
    const memberId = await resolveOrRenameMember(row.memberName, resolutions);
    if ((await prisma.member.count()) > memberCountBefore) newMembersCreated.add(row.memberName);

    weeksTouched.add(row.weekNumber);

    if (row.allianceRank) membersWithRankData.add(memberId);

    for (const cv of row.categoryValues) {
      const key = { memberId_weekNumber_categoryKey: { memberId, weekNumber: row.weekNumber, categoryKey: cv.categoryKey } };
      if (!overwriteExisting) {
        const existing = await prisma.weeklyStat.findUnique({ where: key });
        if (existing) {
          weeklyStatsSkipped++;
          continue;
        }
      }
      await prisma.weeklyStat.upsert({
        where: key,
        update: { value: cv.value },
        create: { memberId, weekNumber: row.weekNumber, categoryKey: cv.categoryKey, value: cv.value },
      });
      weeklyStatsWritten++;
    }

    if (row.squadsFields && squadsCategory) {
      const key = {
        categoryId_memberId_weekNumber_dedupKey: {
          categoryId: squadsCategory.id,
          memberId,
          weekNumber: row.weekNumber,
          dedupKey: "",
        },
      };
      const fields = JSON.stringify(row.squadsFields);
      if (!overwriteExisting) {
        const existing = await prisma.categoryRecord.findUnique({ where: key });
        if (existing) {
          categoryRecordsSkipped++;
          continue;
        }
      }
      await prisma.categoryRecord.upsert({
        where: key,
        update: { fields },
        create: { categoryId: squadsCategory.id, memberId, weekNumber: row.weekNumber, dedupKey: "", rawValue: 0, value: 0, fields },
      });
      categoryRecordsWritten++;
    }
  }

  let allianceRanksUpdated = 0;
  for (const memberId of membersWithRankData) {
    const latest = await prisma.weeklyStat.findFirst({
      where: { memberId, categoryKey: "alliance_rank" },
      orderBy: { weekNumber: "desc" },
    });
    if (latest) {
      await prisma.member.update({ where: { id: memberId }, data: { allianceRank: `R${latest.value}` } });
      allianceRanksUpdated++;
    }
  }

  return NextResponse.json({
    rowsProcessed: mappedRows.length,
    weeklyStatsWritten,
    weeklyStatsSkipped,
    categoryRecordsWritten,
    categoryRecordsSkipped,
    newMembersCreated: [...newMembersCreated].sort(),
    weeksTouched: [...weeksTouched].sort((a, b) => a - b),
    allianceRanksUpdated,
  });
}
