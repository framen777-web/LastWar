import { prisma } from "@/lib/db";
import { DeleteWeekButton } from "@/components/DeleteWeekButton";

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const params = await searchParams;

  const allCategories = await prisma.category.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
  // free_text categories (e.g. Squads) don't produce a WeeklyStat value - they write
  // straight onto the member record instead, shown via the fixed Air/Tank/Missile/Fourth
  // columns below.
  const categories = allCategories.filter((c) => c.shape !== "free_text");

  const weeks = await prisma.weeklyStat.findMany({
    select: { weekNumber: true },
    distinct: ["weekNumber"],
    orderBy: { weekNumber: "desc" },
  });
  const weekNumbers = weeks.map((w) => w.weekNumber);
  const defaultWeek = weekNumbers.length > 0 ? weekNumbers[0] : 1;

  const weekParam = Array.isArray(params.week) ? params.week[0] : params.week;
  const selectedWeek = weekParam ? Number(weekParam) : defaultWeek;

  const stats = await prisma.weeklyStat.findMany({
    where: { weekNumber: selectedWeek },
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

  const multiCategoryIds = categories.filter((c) => c.importMode === "multi").map((c) => c.id);
  const recordCounts =
    multiCategoryIds.length > 0
      ? await prisma.categoryRecord.groupBy({
          by: ["memberId", "categoryId"],
          where: { weekNumber: selectedWeek, categoryId: { in: multiCategoryIds } },
          _count: { _all: true },
        })
      : [];
  const categoryKeyById = new Map(categories.map((c) => [c.id, c.key]));
  const recordCountByMemberCategory = new Map<string, number>();
  for (const r of recordCounts) {
    const key = `${r.memberId}:${categoryKeyById.get(r.categoryId)}`;
    recordCountByMemberCategory.set(key, r._count._all);
  }

  const categoryRecordCountForWeek = await prisma.categoryRecord.count({ where: { weekNumber: selectedWeek } });
  const totalRecordCountForWeek = stats.length + categoryRecordCountForWeek;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Weekly Info</h1>

      <form className="flex items-center gap-2 text-sm">
        <label htmlFor="week" className="font-medium">
          Week
        </label>
        <input
          id="week"
          name="week"
          type="number"
          min={1}
          defaultValue={selectedWeek}
          list="dashboard-known-weeks"
          className="border border-neutral-300 rounded px-2 py-1 w-24"
        />
        <datalist id="dashboard-known-weeks">
          {weekNumbers.map((w) => (
            <option key={w} value={w} />
          ))}
        </datalist>
        <button type="submit" className="bg-neutral-900 text-white rounded px-3 py-1">
          Go
        </button>

        {totalRecordCountForWeek > 0 && (
          <DeleteWeekButton weekNumber={selectedWeek} recordCount={totalRecordCountForWeek} />
        )}
      </form>

      {members.length === 0 ? (
        <p className="text-neutral-500 text-sm">No data for week {selectedWeek} yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-neutral-300 text-left">
                <th className="py-2 pr-3">Member</th>
                <th className="py-2 pr-3">Rank</th>
                <th className="py-2 pr-3">HQ</th>
                <th className="py-2 pr-3">Air</th>
                <th className="py-2 pr-3">Tank</th>
                <th className="py-2 pr-3">Missile</th>
                <th className="py-2 pr-3">Fourth</th>
                {categories.map((c) => (
                  <th key={c.key} className="py-2 pr-3 whitespace-nowrap">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const memberStats = statsByMember.get(member.id) ?? new Map();
                return (
                  <tr key={member.id} className="border-b border-neutral-100">
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">{member.name}</td>
                    <td className="py-2 pr-3 text-neutral-500">{member.allianceRank ?? "—"}</td>
                    <td className="py-2 pr-3 text-neutral-500">{member.level ?? "—"}</td>
                    <td className="py-2 pr-3 text-neutral-500">{member.squadAir ?? "—"}</td>
                    <td className="py-2 pr-3 text-neutral-500">{member.squadTank ?? "—"}</td>
                    <td className="py-2 pr-3 text-neutral-500">{member.squadMissile ?? "—"}</td>
                    <td className="py-2 pr-3 text-neutral-500">{member.squadFourth ?? "—"}</td>
                    {categories.map((c) => {
                      const stat = memberStats.get(c.key);
                      const recordCount = recordCountByMemberCategory.get(`${member.id}:${c.key}`) ?? 0;
                      return (
                        <td key={c.key} className="py-2 pr-3 text-neutral-700 whitespace-nowrap">
                          {stat?.value ?? "—"}
                          {c.importMode === "multi" && recordCount > 0 && (
                            <span className="text-neutral-400 text-xs"> · {recordCount}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
