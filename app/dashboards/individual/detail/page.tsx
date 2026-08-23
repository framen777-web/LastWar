import { ZoomWrapper, ZoomProvider, ZoomControl } from "@/components/ZoomWrapper";
import { ShareReportButton } from "@/components/ShareReportButton";
import { prisma } from "@/lib/db";
import { requireMenuAccess } from "@/lib/menuAccess";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/DataTable";
import { MobileCardList } from "@/components/MobileCardList";
import { pickNumberFormat, formatWithRule } from "@/lib/format";
import { getMemberGrowthData } from "@/lib/dashboards/individualGrowth";

export default async function IndividualDetailListPage({ searchParams }: PageProps<"/dashboards/individual/detail">) {
  const user = await requireMenuAccess("individual-detail-list");
  const params = await searchParams;

  // Mirrors /dashboard's ownScope pattern: MEMBER can never view anyone but themselves, even
  // via a crafted ?member= query param - the id is only ever taken from the param for
  // ADMIN/LEADER, who get the same "pick any member" access every other Alliance Report has.
  const canPickAnyMember = user.role === "ADMIN" || user.role === "LEADER";
  const memberParam = Array.isArray(params.member) ? params.member[0] : params.member;
  const selectedMemberId = canPickAnyMember && memberParam ? Number(memberParam) : user.id;

  const allMembers = canPickAnyMember
    ? await prisma.member.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];

  const { member, categories, rows: growthRows } = await getMemberGrowthData(selectedMemberId);

  const columns: DataTableColumn[] = [
    { key: "week", header: "Week", filter: "number" },
    ...categories.flatMap((c): DataTableColumn[] =>
      c.cumulative
        ? [
            { key: c.key, header: c.name, filter: "number" as const },
            { key: `${c.key}__gain`, header: `${c.name} (gain)`, filter: "number" as const },
          ]
        : [{ key: c.key, header: c.name, filter: "number" as const }]
    ),
  ];

  const valueRule = new Map(categories.map((c) => [c.key, pickNumberFormat(growthRows.map((r) => r.values[c.key]))]));
  const gainRule = new Map(
    categories.filter((c) => c.cumulative).map((c) => [c.key, pickNumberFormat(growthRows.map((r) => r.gains[c.key]))])
  );

  const rows: DataTableRow[] = [...growthRows].reverse().map((r) => {
    const cells: Record<string, React.ReactNode> = { week: <span className="font-medium">{r.week}</span> };
    const sortValues: Record<string, number | string> = { week: r.week };

    for (const c of categories) {
      const value = r.values[c.key];
      cells[c.key] = <span className="text-neutral-700">{formatWithRule(value, valueRule.get(c.key)!)}</span>;
      if (value !== undefined) sortValues[c.key] = value;

      if (c.cumulative) {
        const gain = r.gains[c.key];
        cells[`${c.key}__gain`] =
          gain === undefined ? (
            <span className="text-neutral-400">—</span>
          ) : (
            <span className={gain >= 0 ? "text-green-600" : "text-red-600"}>
              {gain >= 0 ? "+" : ""}
              {formatWithRule(gain, gainRule.get(c.key)!)}
            </span>
          );
        if (gain !== undefined) sortValues[`${c.key}__gain`] = gain;
      }
    }

    return { id: r.week, cells, sortValues };
  });

  return (
    <ZoomProvider>
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold">Detail List</h1>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          {canPickAnyMember ? (
            <form className="flex items-center gap-2 text-sm flex-wrap">
              <button type="submit" className="bg-accent text-accent-contrast rounded px-3 py-1">
                Go
              </button>
              <label htmlFor="member" className="font-medium">
                Member
              </label>
              <select id="member" name="member" defaultValue={selectedMemberId} className="border border-neutral-300 rounded px-2 py-1">
                {allMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </form>
          ) : (
            <p className="text-sm text-neutral-500">
              {member?.name} {member?.allianceRank ? `· ${member.allianceRank}` : ""}
            </p>
          )}

          {member && growthRows.length > 0 && (
            <div className="flex items-center gap-2">
              <ZoomControl />
              <ShareReportButton targetId="individual-detail-content" filename="individual-detail.png" title={member.name} />
              <a
                href={`/api/dashboards/individual/export?member=${member.id}`}
                className="border border-neutral-300 rounded px-3 py-1.5 text-sm hover:bg-neutral-50"
              >
                Export to Excel
              </a>
            </div>
          )}
        </div>

        {!member ? (
          <p className="text-neutral-500 text-sm">Member not found.</p>
        ) : growthRows.length === 0 ? (
          <p className="text-neutral-500 text-sm">No stats recorded for {member.name} yet.</p>
        ) : (
          <>
            <div className="hidden md:block">
              <ZoomWrapper contentId="individual-detail-content">
                <DataTable columns={columns} rows={rows} defaultSort={{ key: "week", direction: "desc" }} />
              </ZoomWrapper>
            </div>
            <div className="md:hidden">
              <MobileCardList columns={columns} rows={rows} titleKey="week" />
            </div>
          </>
        )}
      </div>
    </ZoomProvider>
  );
}
