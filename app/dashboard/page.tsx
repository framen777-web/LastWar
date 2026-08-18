import { prisma } from "@/lib/db";
import { DeleteWeekButton } from "@/components/DeleteWeekButton";
import { MemberWeekActions } from "@/components/MemberWeekActions";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/DataTable";
import { NumberStepper } from "@/components/NumberStepper";
import { pickNumberFormat, formatWithRule } from "@/lib/format";
import { requireMenuAccess } from "@/lib/menuAccess";

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireMenuAccess(["home-my-stats", "uploads-review"]);
  const ownScope = user.role === "MEMBER" ? { memberId: user.id } : {};

  const params = await searchParams;

  const allCategories = await prisma.category.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
  // free_text categories (e.g. Squads) don't produce a WeeklyStat value - they're shown
  // via the fixed Air/Tank/Missile/Fourth columns below instead, sourced per-week from
  // CategoryRecord (see squadsByMember) rather than from the dynamic per-category columns.
  const categories = allCategories.filter((c) => c.shape !== "free_text");
  const squadsCategory = allCategories.find((c) => c.key === "squads");

  const weeks = await prisma.weeklyStat.findMany({
    where: ownScope,
    select: { weekNumber: true },
    distinct: ["weekNumber"],
    orderBy: { weekNumber: "desc" },
  });
  const weekNumbers = weeks.map((w) => w.weekNumber);
  const defaultWeek = weekNumbers.length > 0 ? weekNumbers[0] : 1;

  const weekParam = Array.isArray(params.week) ? params.week[0] : params.week;
  const selectedWeek = weekParam ? Number(weekParam) : defaultWeek;

  // "" = every category (the original wide view), "squads" = just Air/Tank/Missile/Fourth,
  // or one category's own key - lets a reviewer focus on a single category at a time
  // instead of scanning a row with every category's column at once.
  const categoryParam = Array.isArray(params.category) ? params.category[0] : params.category;
  const selectedCategory = categoryParam ?? "";
  const showAllCategories = selectedCategory === "";
  const showSquads = selectedCategory === "squads";
  const focusedCategory = !showAllCategories && !showSquads ? categories.find((c) => c.key === selectedCategory) : undefined;

  // Members below MEMBER-scope: the query is filtered here, not just hidden in the UI - other
  // members' rows are never fetched for a Member-role viewer.
  const stats = await prisma.weeklyStat.findMany({
    where: { weekNumber: selectedWeek, ...ownScope },
    include: { member: true },
  });

  const memberIds = Array.from(new Set(stats.map((s) => s.memberId)));
  const members = await prisma.member.findMany({
    where: { id: { in: memberIds } },
    orderBy: { name: "asc" },
  });

  const statsByMember = new Map<number, Map<string, { value: number; rank: number | null }>>();
  for (const stat of stats) {
    if (!statsByMember.has(stat.memberId)) statsByMember.set(stat.memberId, new Map());
    statsByMember.get(stat.memberId)!.set(stat.categoryKey, { value: stat.value, rank: stat.rank });
  }

  // Squads is free_text (no WeeklyStat row) - read this week's Air/Tank/Missile/Fourth
  // straight from CategoryRecord, not from Member.squadAir etc (those are a frozen,
  // no-longer-updated snapshot from before this per-week tracking existed - they'd show
  // the same figure regardless of which week is selected here, which was the original bug
  // this replaces).
  type SquadsFields = { air: number | null; tank: number | null; missile: number | null; fourth: number | null };
  const squadsByMember = new Map<number, SquadsFields>();
  if (squadsCategory) {
    const squadsRecords = await prisma.categoryRecord.findMany({
      where: { categoryId: squadsCategory.id, weekNumber: selectedWeek, ...ownScope },
    });
    for (const r of squadsRecords) {
      squadsByMember.set(r.memberId, JSON.parse(r.fields) as SquadsFields);
    }
  }

  const multiCategoryIds = categories.filter((c) => c.importMode === "multi").map((c) => c.id);
  const recordCounts =
    multiCategoryIds.length > 0
      ? await prisma.categoryRecord.groupBy({
          by: ["memberId", "categoryId"],
          where: { weekNumber: selectedWeek, categoryId: { in: multiCategoryIds }, ...ownScope },
          _count: { _all: true },
        })
      : [];
  const categoryKeyById = new Map(categories.map((c) => [c.id, c.key]));
  const recordCountByMemberCategory = new Map<string, number>();
  for (const r of recordCounts) {
    const key = `${r.memberId}:${categoryKeyById.get(r.categoryId)}`;
    recordCountByMemberCategory.set(key, r._count._all);
  }

  const categoryRecordCountForWeek = await prisma.categoryRecord.count({ where: { weekNumber: selectedWeek, ...ownScope } });
  const totalRecordCountForWeek = stats.length + categoryRecordCountForWeek;

  const columns: DataTableColumn[] = [
    ...(user.role === "ADMIN" ? [{ key: "actions", header: "" }] : []),
    { key: "member", header: "Member", filter: "text", sticky: true },
    { key: "rank", header: "Rank", filter: "text" },
    ...(showAllCategories || showSquads
      ? [
          { key: "air", header: "Air", filter: "number" as const },
          { key: "tank", header: "Tank", filter: "number" as const },
          { key: "missile", header: "Missile", filter: "number" as const },
          { key: "fourth", header: "Fourth", filter: "number" as const },
        ]
      : []),
    ...(showAllCategories
      ? categories.map((c) => ({ key: c.key, header: c.name, filter: "number" as const }))
      : focusedCategory
        ? [{ key: focusedCategory.key, header: focusedCategory.name, filter: "number" as const }]
        : []),
  ];

  // One formatting rule per column (not per value) - decided once from every member's
  // value in that column, so a column never mixes "1,234" and "12.34" style rows.
  const airRule = pickNumberFormat(members.map((m) => squadsByMember.get(m.id)?.air));
  const tankRule = pickNumberFormat(members.map((m) => squadsByMember.get(m.id)?.tank));
  const missileRule = pickNumberFormat(members.map((m) => squadsByMember.get(m.id)?.missile));
  const fourthRule = pickNumberFormat(members.map((m) => squadsByMember.get(m.id)?.fourth));
  const categoryRules = new Map(
    categories.map((c) => [c.key, pickNumberFormat(members.map((m) => statsByMember.get(m.id)?.get(c.key)?.value))])
  );

  const rows: DataTableRow[] = members.map((member) => {
    const memberStats = statsByMember.get(member.id) ?? new Map();
    const squads = squadsByMember.get(member.id);
    const rankStat = memberStats.get("alliance_rank");
    const rankLabel = rankStat ? `R${rankStat.value}` : "—";

    const cells: Record<string, React.ReactNode> = {
      member: <span className="font-medium">{member.name}</span>,
      rank: <span className="text-neutral-500">{rankLabel}</span>,
      air: <span className="text-neutral-500">{formatWithRule(squads?.air, airRule)}</span>,
      tank: <span className="text-neutral-500">{formatWithRule(squads?.tank, tankRule)}</span>,
      missile: <span className="text-neutral-500">{formatWithRule(squads?.missile, missileRule)}</span>,
      fourth: <span className="text-neutral-500">{formatWithRule(squads?.fourth, fourthRule)}</span>,
    };
    const sortValues: Record<string, number | string> = { member: member.name, rank: rankStat ? rankLabel : "" };
    if (squads?.air != null) sortValues.air = squads.air;
    if (squads?.tank != null) sortValues.tank = squads.tank;
    if (squads?.missile != null) sortValues.missile = squads.missile;
    if (squads?.fourth != null) sortValues.fourth = squads.fourth;

    for (const c of categories) {
      const stat = memberStats.get(c.key);
      const recordCount = recordCountByMemberCategory.get(`${member.id}:${c.key}`) ?? 0;
      cells[c.key] = (
        <span className="text-neutral-700">
          {formatWithRule(stat?.value, categoryRules.get(c.key)!)}
          {c.importMode === "multi" && recordCount > 0 && <span className="text-neutral-400 text-xs"> · {recordCount}</span>}
        </span>
      );
      if (stat) sortValues[c.key] = stat.value;
    }

    if (user.role === "ADMIN") {
      cells.actions = (
        <MemberWeekActions
          weekNumber={selectedWeek}
          memberId={member.id}
          memberName={member.name}
          rank={rankStat?.value ?? null}
          categories={categories.map((c) => ({ key: c.key, name: c.name, value: memberStats.get(c.key)?.value ?? null }))}
          squads={squads ?? null}
        />
      );
    }

    return { id: member.id, cells, sortValues };
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{user.role === "MEMBER" ? "Detail List" : "Upload Review"}</h1>

      <form className="flex items-center gap-2 text-sm flex-wrap">
        <button type="submit" className="bg-accent text-accent-contrast rounded px-3 py-1">
          Go
        </button>

        <label htmlFor="week" className="font-medium">
          Week
        </label>
        <NumberStepper id="week" name="week" defaultValue={selectedWeek} min={1} listId="dashboard-known-weeks" />
        <datalist id="dashboard-known-weeks">
          {weekNumbers.map((w) => (
            <option key={w} value={w} />
          ))}
        </datalist>

        <label htmlFor="category" className="font-medium">
          Category
        </label>
        <select id="category" name="category" defaultValue={selectedCategory} className="border border-neutral-300 rounded px-2 py-1">
          <option value="">All categories</option>
          <option value="squads">Squads</option>
          {categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>

        {user.role === "ADMIN" && totalRecordCountForWeek > 0 && (
          <DeleteWeekButton weekNumber={selectedWeek} recordCount={totalRecordCountForWeek} />
        )}
      </form>

      {members.length === 0 ? (
        <p className="text-neutral-500 text-sm">No data for week {selectedWeek} yet.</p>
      ) : (
        // Table on every screen size here, not the mobile card view - this page is an
        // editing/review workflow (spot-check completeness, edit, delete), which needs the
        // real scrollable table, not simplified cards.
        <DataTable columns={columns} rows={rows} defaultSort={{ key: "member", direction: "asc" }} />
      )}
    </div>
  );
}
