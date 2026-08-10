import { prisma } from "@/lib/db";

// Import labels are free-text as extracted (e.g. "2026-8-2 20:00:52") - drop a trailing
// time component for display since only the date distinguishes separate imports here.
function formatImportLabel(dedupKey: string): string {
  if (!dedupKey) return "—";
  return dedupKey.replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*$/, "").trim() || dedupKey;
}

export default async function MultiTablePage({ searchParams }: PageProps<"/dashboard/multi">) {
  const params = await searchParams;

  const multiCategories = await prisma.category.findMany({
    where: { active: true, importMode: "multi" },
    orderBy: { sortOrder: "asc" },
  });

  const categoryParam = Array.isArray(params.category) ? params.category[0] : params.category;
  const selectedCategory =
    multiCategories.find((c) => c.key === categoryParam) ?? multiCategories[0] ?? null;

  const weeks = selectedCategory
    ? await prisma.categoryRecord.findMany({
        where: { categoryId: selectedCategory.id },
        select: { weekNumber: true },
        distinct: ["weekNumber"],
        orderBy: { weekNumber: "desc" },
      })
    : [];
  const weekNumbers = weeks.map((w) => w.weekNumber);
  const defaultWeek = weekNumbers.length > 0 ? weekNumbers[0] : 1;

  const weekParam = Array.isArray(params.week) ? params.week[0] : params.week;
  const selectedWeek = weekParam ? Number(weekParam) : defaultWeek;

  const records = selectedCategory
    ? await prisma.categoryRecord.findMany({
        where: { weekNumber: selectedWeek, categoryId: selectedCategory.id },
        include: { member: true },
        orderBy: [{ member: { name: "asc" } }],
      })
    : [];

  const imports = Array.from(new Set(records.map((r) => r.dedupKey))).sort();
  const members = Array.from(new Map(records.map((r) => [r.memberId, r.member])).values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const valueByMemberImport = new Map<string, number>();
  for (const r of records) {
    valueByMemberImport.set(`${r.memberId}:${r.dedupKey}`, r.value);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Multitable (Multiple Imports)</h1>
      <p className="text-neutral-500 text-sm">
        Each member's value per individual import — the breakdown behind the summed value on Weekly Info.
      </p>

      <form className="flex items-center gap-2 text-sm flex-wrap">
        <label htmlFor="category" className="font-medium">
          Category
        </label>
        <select
          id="category"
          name="category"
          defaultValue={selectedCategory?.key}
          className="border border-neutral-300 rounded px-2 py-1"
        >
          {multiCategories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>

        <label htmlFor="week" className="font-medium">
          Week
        </label>
        <input
          id="week"
          name="week"
          type="number"
          min={1}
          defaultValue={selectedWeek}
          list="multi-known-weeks"
          className="border border-neutral-300 rounded px-2 py-1 w-24"
        />
        <datalist id="multi-known-weeks">
          {weekNumbers.map((w) => (
            <option key={w} value={w} />
          ))}
        </datalist>
        <button type="submit" className="bg-neutral-900 text-white rounded px-3 py-1">
          Go
        </button>
      </form>

      {!selectedCategory ? (
        <p className="text-neutral-500 text-sm">No categories are set to multi-import. Configure one in Setup.</p>
      ) : records.length === 0 ? (
        <p className="text-neutral-500 text-sm">
          No {selectedCategory.name} imports for week {selectedWeek} yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-neutral-300 text-left">
                <th className="py-2 pr-3">Member</th>
                {imports.map((dedupKey) => (
                  <th key={dedupKey} className="py-2 pr-3 whitespace-nowrap">
                    {formatImportLabel(dedupKey)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-b border-neutral-100">
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">{member.name}</td>
                  {imports.map((dedupKey) => (
                    <td key={dedupKey} className="py-2 pr-3 text-neutral-700 whitespace-nowrap">
                      {valueByMemberImport.get(`${member.id}:${dedupKey}`) ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
