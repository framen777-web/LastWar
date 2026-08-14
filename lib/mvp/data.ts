import { prisma } from "@/lib/db";

export type MemberWeekRow = {
  memberId: number;
  memberName: string;
  weekNumber: number;
  hq: number | null;
  power: number | null;
  dsPoints: number | null;
  vsScore: number | null;
  totalKills: number | null;
  donations: number | null;
  air: number | null;
  tank: number | null;
  missile: number | null;
  t4: number | null;
  cs: number | null;
  ae: number | null;
  zs: number | null;
};

const WEEKLY_STAT_CATEGORIES = ["power", "kills", "donations", "vs", "desert_storm", "ae", "members"] as const;

/**
 * Assembles the spec's per-member-per-week "Data" row from what this app
 * already tracks - WeeklyStat for most metrics, the squads CategoryRecord's
 * `fields` JSON for air/tank/missile/t4 (squads has no single "value", see
 * lib/pipeline/run.ts's free_text branch). Canyon Storm / Zombie Siege are
 * looked up by convention (categoryKey "canyon_storm" / "zombie_siege") so
 * they light up automatically if those categories are ever added in Setup.
 */
export async function getMemberWeekRows(): Promise<MemberWeekRow[]> {
  const stats = await prisma.weeklyStat.findMany({
    where: { categoryKey: { in: [...WEEKLY_STAT_CATEGORIES, "canyon_storm", "zombie_siege"] } },
    include: { member: true },
  });

  const squadsCategory = await prisma.category.findUnique({ where: { key: "squads" } });
  const squadRecords = squadsCategory
    ? await prisma.categoryRecord.findMany({
        where: { categoryId: squadsCategory.id, dedupKey: "" },
        include: { member: true },
      })
    : [];

  const rowsByKey = new Map<string, MemberWeekRow>();

  function getRow(memberId: number, memberName: string, weekNumber: number): MemberWeekRow {
    const key = `${memberId}:${weekNumber}`;
    let row = rowsByKey.get(key);
    if (!row) {
      row = {
        memberId,
        memberName,
        weekNumber,
        hq: null,
        power: null,
        dsPoints: null,
        vsScore: null,
        totalKills: null,
        donations: null,
        air: null,
        tank: null,
        missile: null,
        t4: null,
        cs: null,
        ae: null,
        zs: null,
      };
      rowsByKey.set(key, row);
    }
    return row;
  }

  for (const s of stats) {
    const row = getRow(s.memberId, s.member.name, s.weekNumber);
    switch (s.categoryKey) {
      case "power":
        row.power = s.value;
        break;
      case "kills":
        row.totalKills = s.value;
        break;
      case "donations":
        row.donations = s.value;
        break;
      case "vs":
        row.vsScore = s.value;
        break;
      case "desert_storm":
        row.dsPoints = s.value;
        break;
      case "ae":
        row.ae = s.value;
        break;
      case "members":
        row.hq = s.value;
        break;
      case "canyon_storm":
        row.cs = s.value;
        break;
      case "zombie_siege":
        row.zs = s.value;
        break;
    }
  }

  for (const r of squadRecords) {
    const row = getRow(r.memberId, r.member.name, r.weekNumber);
    const fields = JSON.parse(r.fields) as { air?: number | null; tank?: number | null; missile?: number | null; fourth?: number | null };
    row.air = fields.air ?? null;
    row.tank = fields.tank ?? null;
    row.missile = fields.missile ?? null;
    row.t4 = fields.fourth ?? null;
  }

  return Array.from(rowsByKey.values());
}
