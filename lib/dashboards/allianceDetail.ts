import { prisma } from "@/lib/db";

export type AllianceCategory = { key: string; name: string; cumulative: boolean };

export type AllianceFilters = {
  fromWeek: number;
  toWeek: number;
  /** undefined = every member */
  commanderId?: number;
  /** "R1".."R5", undefined = every rank */
  rank?: string;
};

type SquadsFields = { air?: number; tank?: number; missile?: number; fourth?: number };

export type DetailRow = {
  memberId: number;
  memberName: string;
  weekNumber: number;
  rankLabel: string;
  values: Record<string, number | undefined>;
  squads: SquadsFields;
};

export type SummaryRow = {
  memberId: number;
  memberName: string;
  rankLabel: string;
  values: Record<string, number | undefined>;
  squads: SquadsFields;
};

// Shared by the Detail Report page and its Excel export, so both modes (and both output
// formats) are always built from the exact same underlying computation.
export async function getAllianceDetailData(filters: AllianceFilters): Promise<{
  categories: AllianceCategory[];
  detailRows: DetailRow[];
  summaryRows: SummaryRow[];
}> {
  const { fromWeek, toWeek, commanderId, rank } = filters;

  const allCategories = await prisma.category.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const categories: AllianceCategory[] = allCategories
    .filter((c) => c.shape !== "free_text")
    .map((c) => ({ key: c.key, name: c.name, cumulative: c.cumulative }));
  const squadsCategory = allCategories.find((c) => c.key === "squads");

  const memberWhere = {
    ...(commanderId ? { id: commanderId } : {}),
    ...(rank ? { allianceRank: rank } : {}),
  };

  // One week before fromWeek too, purely as a baseline to compute fromWeek's own gain for
  // cumulative categories (e.g. Kills) - never shown itself, never counted in a sum.
  const stats = await prisma.weeklyStat.findMany({
    where: {
      weekNumber: { gte: fromWeek - 1, lte: toWeek },
      categoryKey: { in: categories.map((c) => c.key) },
      member: memberWhere,
    },
    include: { member: true },
  });

  const squadsRecords = squadsCategory
    ? await prisma.categoryRecord.findMany({
        where: { categoryId: squadsCategory.id, weekNumber: { gte: fromWeek, lte: toWeek }, member: memberWhere },
      })
    : [];

  // memberId:weekNumber:categoryKey -> value
  const valueByKey = new Map<string, number>();
  for (const s of stats) valueByKey.set(`${s.memberId}:${s.weekNumber}:${s.categoryKey}`, s.value);

  // memberId:weekNumber -> squads fields
  const squadsByKey = new Map<string, SquadsFields>();
  for (const r of squadsRecords) squadsByKey.set(`${r.memberId}:${r.weekNumber}`, JSON.parse(r.fields) as SquadsFields);

  const membersById = new Map(stats.map((s) => [s.memberId, s.member]));
  for (const r of squadsRecords) {
    if (!membersById.has(r.memberId)) {
      const member = await prisma.member.findUnique({ where: { id: r.memberId } });
      if (member) membersById.set(r.memberId, member);
    }
  }

  function rankLabelForWeek(memberId: number, weekNumber: number): string {
    const r = valueByKey.get(`${memberId}:${weekNumber}:alliance_rank`);
    return r !== undefined ? `R${r}` : "—";
  }

  function gain(memberId: number, categoryKey: string, weekNumber: number): number | undefined {
    const current = valueByKey.get(`${memberId}:${weekNumber}:${categoryKey}`);
    const previous = valueByKey.get(`${memberId}:${weekNumber - 1}:${categoryKey}`);
    if (current === undefined || previous === undefined) return undefined;
    return current - previous;
  }

  const detailRows: DetailRow[] = [];
  for (let week = fromWeek; week <= toWeek; week++) {
    for (const [memberId, member] of membersById) {
      const values: Record<string, number | undefined> = {};
      let hasAny = false;
      for (const c of categories) {
        const v = valueByKey.get(`${memberId}:${week}:${c.key}`);
        if (v !== undefined) hasAny = true;
        values[c.key] = v;
      }
      const squads = squadsByKey.get(`${memberId}:${week}`) ?? {};
      if (Object.keys(squads).length > 0) hasAny = true;
      if (!hasAny) continue;

      detailRows.push({
        memberId,
        memberName: member.name,
        weekNumber: week,
        rankLabel: rankLabelForWeek(memberId, week),
        values,
        squads,
      });
    }
  }

  // "HQ" (the "members" category key) tracks current HQ level, not an event score -
  // consolidating it (and squad composition) across weeks means "peak reached", i.e. max.
  // Everything else sums: a cumulative category (Kills) sums its per-week *gains*, since
  // summing the raw ever-increasing readings would be meaningless; anything else (VS,
  // Donations, AE, Desert Storm, Canyon Storm, and any new category added later) sums its
  // raw per-week values directly.
  const MAX_CATEGORY_KEYS = new Set(["members"]);

  const summaryRows: SummaryRow[] = [];
  for (const [memberId, member] of membersById) {
    const values: Record<string, number | undefined> = {};
    let hasAny = false;

    for (const c of categories) {
      let acc: number | undefined;
      for (let week = fromWeek; week <= toWeek; week++) {
        const raw = valueByKey.get(`${memberId}:${week}:${c.key}`);
        const contribution = c.cumulative ? gain(memberId, c.key, week) : raw;
        if (contribution === undefined) continue;
        if (MAX_CATEGORY_KEYS.has(c.key)) {
          acc = acc === undefined ? contribution : Math.max(acc, contribution);
        } else {
          acc = (acc ?? 0) + contribution;
        }
      }
      if (acc !== undefined) hasAny = true;
      values[c.key] = acc;
    }

    const squads: SquadsFields = {};
    for (let week = fromWeek; week <= toWeek; week++) {
      const weekSquads = squadsByKey.get(`${memberId}:${week}`);
      if (!weekSquads) continue;
      hasAny = true;
      for (const field of ["air", "tank", "missile", "fourth"] as const) {
        const v = weekSquads[field];
        if (v === undefined) continue;
        squads[field] = squads[field] === undefined ? v : Math.max(squads[field]!, v);
      }
    }

    if (!hasAny) continue;
    summaryRows.push({
      memberId,
      memberName: member.name,
      rankLabel: member.allianceRank ?? "—",
      values,
      squads,
    });
  }

  return { categories, detailRows, summaryRows };
}
