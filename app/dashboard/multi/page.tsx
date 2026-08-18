import { prisma } from "@/lib/db";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/DataTable";
import { MultiCategoryRowActions } from "@/components/MultiCategoryRowActions";
import { NumberStepper } from "@/components/NumberStepper";
import { pickNumberFormat, formatWithRule } from "@/lib/format";
import { requireMenuAccess } from "@/lib/menuAccess";

// Import labels are free-text as extracted (e.g. "2026-8-2 20:00:52") - drop a trailing
// time component for display since only the date distinguishes separate imports here.
function formatImportLabel(dedupKey: string): string {
  if (!dedupKey) return "—";
  return dedupKey.replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*$/, "").trim() || dedupKey;
}

export default async function MultiTablePage({ searchParams }: PageProps<"/dashboard/multi">) {
  const user = await requireMenuAccess("uploads-multi-event-review");
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

  const columns: DataTableColumn[] = [
    ...(user.role === "ADMIN" ? [{ key: "actions", header: "" }] : []),
    { key: "member", header: "Member", filter: "text", sticky: true },
    ...imports.map((dedupKey) => ({ key: dedupKey, header: formatImportLabel(dedupKey), filter: "number" as const })),
  ];

  const importRules = new Map(
    imports.map((dedupKey) => [
      dedupKey,
      pickNumberFormat(members.map((m) => valueByMemberImport.get(`${m.id}:${dedupKey}`))),
    ])
  );

  const rows: DataTableRow[] = members.map((member) => {
    const cells: Record<string, React.ReactNode> = { member: <span className="font-medium">{member.name}</span> };
    const sortValues: Record<string, number | string> = { member: member.name };
    for (const dedupKey of imports) {
      const value = valueByMemberImport.get(`${member.id}:${dedupKey}`);
      cells[dedupKey] = <span className="text-neutral-700">{formatWithRule(value, importRules.get(dedupKey)!)}</span>;
      if (value !== undefined) sortValues[dedupKey] = value;
    }
    if (user.role === "ADMIN" && selectedCategory) {
      cells.actions = (
        <MultiCategoryRowActions
          weekNumber={selectedWeek}
          memberId={member.id}
          memberName={member.name}
          categoryKey={selectedCategory.key}
          categoryName={selectedCategory.name}
          imports={imports.map((dedupKey) => ({
            dedupKey,
            label: formatImportLabel(dedupKey),
            value: valueByMemberImport.get(`${member.id}:${dedupKey}`) ?? null,
          }))}
        />
      );
    }
    return { id: member.id, cells, sortValues };
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Multi Event Review</h1>
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

        <button type="submit" className="bg-accent text-accent-contrast rounded px-3 py-1">
          Go
        </button>

        <label htmlFor="week" className="font-medium">
          Week
        </label>
        <NumberStepper id="week" name="week" defaultValue={selectedWeek} min={1} listId="multi-known-weeks" />
        <datalist id="multi-known-weeks">
          {weekNumbers.map((w) => (
            <option key={w} value={w} />
          ))}
        </datalist>
      </form>

      {!selectedCategory ? (
        <p className="text-neutral-500 text-sm">No categories are set to multi-import. Configure one in Setup.</p>
      ) : records.length === 0 ? (
        <p className="text-neutral-500 text-sm">
          No {selectedCategory.name} imports for week {selectedWeek} yet.
        </p>
      ) : (
        // Table on every screen size, same as Upload Review - this is an editing workflow.
        <DataTable columns={columns} rows={rows} defaultSort={{ key: "member", direction: "asc" }} />
      )}
    </div>
  );
}
