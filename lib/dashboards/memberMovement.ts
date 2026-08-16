import { prisma } from "@/lib/db";

export type MemberMovementRow = { memberId: number; name: string };

export type MemberMovementReport = {
  week: number;
  priorWeek: number;
  openingCount: number;
  closingCount: number;
  joined: MemberMovementRow[];
  left: MemberMovementRow[];
};

// "Active in week N" mirrors lib/members/activeSync.ts's own definition - any member with a
// WeeklyStat row or a CategoryRecord row for that week (union, since squads-only reporters
// never produce a WeeklyStat row).
async function activeMemberIdsForWeek(weekNumber: number): Promise<Set<number>> {
  const [statMembers, recordMembers] = await Promise.all([
    prisma.weeklyStat.findMany({ where: { weekNumber }, select: { memberId: true }, distinct: ["memberId"] }),
    prisma.categoryRecord.findMany({ where: { weekNumber }, select: { memberId: true }, distinct: ["memberId"] }),
  ]);
  return new Set([...statMembers.map((s) => s.memberId), ...recordMembers.map((r) => r.memberId)]);
}

export async function getMemberMovementReport(week: number): Promise<MemberMovementReport> {
  const priorWeek = week - 1;
  const [currentIds, priorIds] = await Promise.all([
    activeMemberIdsForWeek(week),
    priorWeek >= 1 ? activeMemberIdsForWeek(priorWeek) : Promise.resolve(new Set<number>()),
  ]);

  const joinedIds = [...currentIds].filter((id) => !priorIds.has(id));
  const leftIds = [...priorIds].filter((id) => !currentIds.has(id));

  const touchedIds = [...new Set([...joinedIds, ...leftIds])];
  const members = touchedIds.length > 0 ? await prisma.member.findMany({ where: { id: { in: touchedIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(members.map((m) => [m.id, m.name]));

  const byName = (a: MemberMovementRow, b: MemberMovementRow) => a.name.localeCompare(b.name);
  const joined = joinedIds.map((id) => ({ memberId: id, name: nameById.get(id) ?? "?" })).sort(byName);
  const left = leftIds.map((id) => ({ memberId: id, name: nameById.get(id) ?? "?" })).sort(byName);

  return { week, priorWeek, openingCount: priorIds.size, closingCount: currentIds.size, joined, left };
}
