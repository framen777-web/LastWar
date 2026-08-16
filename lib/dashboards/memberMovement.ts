import { prisma } from "@/lib/db";
import { getActiveMemberIdsForWeek } from "@/lib/members/weekActivity";

export type MemberMovementRow = { memberId: number; name: string };

export type MemberMovementReport = {
  week: number;
  priorWeek: number;
  openingCount: number;
  closingCount: number;
  joined: MemberMovementRow[];
  left: MemberMovementRow[];
};

export async function getMemberMovementReport(week: number): Promise<MemberMovementReport> {
  const priorWeek = week - 1;
  const [currentIds, priorIds] = await Promise.all([
    getActiveMemberIdsForWeek(week),
    priorWeek >= 1 ? getActiveMemberIdsForWeek(priorWeek) : Promise.resolve(new Set<number>()),
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
