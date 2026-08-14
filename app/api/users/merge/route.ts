import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

/**
 * Merges two Member rows that turned out to be the same person (missed during import -
 * see lib/pipeline/renameMember.ts for the "caught during import" path, which doesn't
 * need this since it never creates the duplicate in the first place). `keepId` is the
 * survivor; `mergeId`'s rows move onto it wherever there's no conflict, and `mergeId` is
 * deleted. On conflict (both members already have a row at the same natural key), the
 * kept member's row wins and the merged-away one is simply dropped - matches "keep"
 * being the intentional primary record.
 */
export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { keepId?: number; mergeId?: number };
  const keepId = Number(body.keepId);
  const mergeId = Number(body.mergeId);

  if (!Number.isInteger(keepId) || !Number.isInteger(mergeId) || keepId === mergeId) {
    return NextResponse.json({ error: "keepId and mergeId must be different member IDs." }, { status: 400 });
  }

  const [keepMember, mergeMember] = await Promise.all([
    prisma.member.findUnique({ where: { id: keepId } }),
    prisma.member.findUnique({ where: { id: mergeId } }),
  ]);
  if (!keepMember || !mergeMember) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const [keepStats, mergeStats, keepRecords, mergeRecords, keepSuggestions, mergeSuggestions, mergeSelections] = await Promise.all([
    prisma.weeklyStat.findMany({ where: { memberId: keepId } }),
    prisma.weeklyStat.findMany({ where: { memberId: mergeId } }),
    prisma.categoryRecord.findMany({ where: { memberId: keepId } }),
    prisma.categoryRecord.findMany({ where: { memberId: mergeId } }),
    prisma.suggestion.findMany({ where: { memberId: keepId } }),
    prisma.suggestion.findMany({ where: { memberId: mergeId } }),
    prisma.conductorSelection.findMany({ where: { memberId: mergeId } }),
  ]);

  const keepStatKeys = new Set(keepStats.map((s) => `${s.weekNumber}:${s.categoryKey}`));
  const keepRecordKeys = new Set(keepRecords.map((r) => `${r.categoryId}:${r.weekNumber}:${r.dedupKey}`));
  const keepSuggestionKeys = new Set(keepSuggestions.map((s) => s.weekNumber));

  const statsToMove = mergeStats.filter((s) => !keepStatKeys.has(`${s.weekNumber}:${s.categoryKey}`));
  const statsToDrop = mergeStats.filter((s) => keepStatKeys.has(`${s.weekNumber}:${s.categoryKey}`));
  const recordsToMove = mergeRecords.filter((r) => !keepRecordKeys.has(`${r.categoryId}:${r.weekNumber}:${r.dedupKey}`));
  const recordsToDrop = mergeRecords.filter((r) => keepRecordKeys.has(`${r.categoryId}:${r.weekNumber}:${r.dedupKey}`));
  const suggestionsToMove = mergeSuggestions.filter((s) => !keepSuggestionKeys.has(s.weekNumber));
  const suggestionsToDrop = mergeSuggestions.filter((s) => keepSuggestionKeys.has(s.weekNumber));

  const aliases = new Set(
    [...keepMember.aliases.split(","), ...mergeMember.aliases.split(","), mergeMember.name].map((a) => a.trim()).filter(Boolean)
  );
  aliases.delete(keepMember.name);

  await prisma.$transaction([
    ...statsToMove.map((s) => prisma.weeklyStat.update({ where: { id: s.id }, data: { memberId: keepId } })),
    ...statsToDrop.map((s) => prisma.weeklyStat.delete({ where: { id: s.id } })),
    ...recordsToMove.map((r) => prisma.categoryRecord.update({ where: { id: r.id }, data: { memberId: keepId } })),
    ...recordsToDrop.map((r) => prisma.categoryRecord.delete({ where: { id: r.id } })),
    ...suggestionsToMove.map((s) => prisma.suggestion.update({ where: { id: s.id }, data: { memberId: keepId } })),
    ...suggestionsToDrop.map((s) => prisma.suggestion.delete({ where: { id: s.id } })),
    ...mergeSelections.map((sel) => prisma.conductorSelection.update({ where: { id: sel.id }, data: { memberId: keepId } })),
    prisma.member.update({ where: { id: keepId }, data: { aliases: [...aliases].join(", ") } }),
    prisma.member.delete({ where: { id: mergeId } }),
  ]);

  return NextResponse.json({
    ok: true,
    weeklyStatsMoved: statsToMove.length,
    weeklyStatsDropped: statsToDrop.length,
    categoryRecordsMoved: recordsToMove.length,
    categoryRecordsDropped: recordsToDrop.length,
    suggestionsMoved: suggestionsToMove.length,
    suggestionsDropped: suggestionsToDrop.length,
    conductorSelectionsMoved: mergeSelections.length,
  });
}
