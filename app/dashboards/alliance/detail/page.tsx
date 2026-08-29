import { ZoomWrapper, ZoomProvider, ZoomControl } from "@/components/ZoomWrapper";
import { ShareReportButton } from "@/components/ShareReportButton";
import { ExcelExportButton } from "@/components/ExcelExportButton";
import { prisma } from "@/lib/db";
import { requireMenuAccess } from "@/lib/menuAccess";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/DataTable";
import { NumberStepper } from "@/components/NumberStepper";
import { pickNumberFormat, formatWithRule } from "@/lib/format";
import { getAllianceDetailData, type DetailRow, type SummaryRow } from "@/lib/dashboards/allianceDetail";

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function AllianceDetailReportPage({ searchParams }: PageProps<"/dashboards/alliance/detail">) {
  await requireMenuAccess("alliance-detail-report");
  const params = await searchParams;

  const weeks = await prisma.weeklyStat.findMany({
    select: { weekNumber: true },
    distinct: ["weekNumber"],
    orderBy: { weekNumber: "desc" },
  });
  const weekNumbers = weeks.map((w) => w.weekNumber);
  const defaultWeek = weekNumbers.length > 0 ? weekNumbers[0] : 1;

  const fromWeek = Number(firstParam(params.fromWeek)) || defaultWeek;
  const toWeek = Number(firstParam(params.toWeek)) || defaultWeek;
  const commanderParam = firstParam(params.commander);
  const commanderId = commanderParam ? Number(commanderParam) : undefined;
  const rank = firstParam(params.rank) || undefined;
  const mode = firstParam(params.mode) === "summary" ? "summary" : "detail";

  const members = await prisma.member.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  const { categories, detailRows, summaryRows } = await getAllianceDetailData({ fromWeek, toWeek, commanderId, rank });

  const columns: DataTableColumn[] = [
    { key: "member", header: "Member", filter: "text", sticky: true },
    ...(mode === "detail" ? [{ key: "week", header: "Week", filter: "number" as const }] : []),
    { key: "rank", header: "Rank", filter: "text" },
    { key: "mvp", header: "MVP", filter: "number" },
    { key: "air", header: "Air", filter: "number" },
    { key: "tank", header: "Tank", filter: "number" },
    { key: "missile", header: "Missile", filter: "number" },
    { key: "fourth", header: "Fourth", filter: "number" },
    ...categories.map((c) => ({ key: c.key, header: c.name, filter: "number" as const })),
  ];

  const sourceRows: (DetailRow | SummaryRow)[] = mode === "detail" ? detailRows : summaryRows;

  const airRule = pickNumberFormat(sourceRows.map((r) => r.squads.air));
  const tankRule = pickNumberFormat(sourceRows.map((r) => r.squads.tank));
  const missileRule = pickNumberFormat(sourceRows.map((r) => r.squads.missile));
  const fourthRule = pickNumberFormat(sourceRows.map((r) => r.squads.fourth));
  const categoryRules = new Map(categories.map((c) => [c.key, pickNumberFormat(sourceRows.map((r) => r.values[c.key]))]));

  const rows: DataTableRow[] = sourceRows.map((r) => {
    const isDetail = "weekNumber" in r;
    const cells: Record<string, React.ReactNode> = {
      member: <span className="font-medium">{r.memberName}</span>,
      rank: <span className="text-neutral-500">{r.rankLabel}</span>,
      mvp: <span className="font-semibold">{r.mvp !== undefined ? r.mvp.toFixed(2) : "—"}</span>,
      air: <span className="text-neutral-500">{formatWithRule(r.squads.air, airRule)}</span>,
      tank: <span className="text-neutral-500">{formatWithRule(r.squads.tank, tankRule)}</span>,
      missile: <span className="text-neutral-500">{formatWithRule(r.squads.missile, missileRule)}</span>,
      fourth: <span className="text-neutral-500">{formatWithRule(r.squads.fourth, fourthRule)}</span>,
    };
    const sortValues: Record<string, number | string> = { member: r.memberName, rank: r.rankLabel };
    if (r.mvp !== undefined) sortValues.mvp = r.mvp;
    if (r.squads.air !== undefined) sortValues.air = r.squads.air;
    if (r.squads.tank !== undefined) sortValues.tank = r.squads.tank;
    if (r.squads.missile !== undefined) sortValues.missile = r.squads.missile;
    if (r.squads.fourth !== undefined) sortValues.fourth = r.squads.fourth;

    if (isDetail) {
      cells.week = <span className="text-neutral-500">{r.weekNumber}</span>;
      sortValues.week = r.weekNumber;
    }

    for (const c of categories) {
      const value = r.values[c.key];
      cells[c.key] = <span className="text-neutral-700">{formatWithRule(value, categoryRules.get(c.key)!)}</span>;
      if (value !== undefined) sortValues[c.key] = value;
    }

    return { id: isDetail ? `${r.memberId}-${r.weekNumber}` : r.memberId, cells, sortValues };
  });

  const exportParams = new URLSearchParams({
    fromWeek: String(fromWeek),
    toWeek: String(toWeek),
    mode,
    ...(commanderId ? { commander: String(commanderId) } : {}),
    ...(rank ? { rank } : {}),
  });

  return (
    <ZoomProvider>
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold">Detail Report</h1>

        <div className="flex items-center gap-2 flex-wrap">
          <form className="flex items-end gap-3 text-sm flex-wrap contents">
            <button type="submit" className="bg-accent text-accent-contrast rounded px-3 py-1.5">
              Go
            </button>

            <div className="flex flex-col gap-1">
              <label htmlFor="fromWeek" className="font-medium">
                From week
              </label>
              <NumberStepper id="fromWeek" name="fromWeek" defaultValue={fromWeek} min={1} listId="alliance-known-weeks" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="toWeek" className="font-medium">
                To week
              </label>
              <NumberStepper id="toWeek" name="toWeek" defaultValue={toWeek} min={1} listId="alliance-known-weeks" />
            </div>
            <datalist id="alliance-known-weeks">
              {weekNumbers.map((w) => (
                <option key={w} value={w} />
              ))}
            </datalist>

            <div className="flex flex-col gap-1">
              <label htmlFor="commander" className="font-medium">
                Commander
              </label>
              <select id="commander" name="commander" defaultValue={commanderId ?? ""} className="border border-neutral-300 rounded px-2 py-1">
                <option value="">All commanders</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="rank" className="font-medium">
                Rank
              </label>
              <select id="rank" name="rank" defaultValue={rank ?? ""} className="border border-neutral-300 rounded px-2 py-1">
                <option value="">All ranks</option>
                {["R1", "R2", "R3", "R4", "R5"].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="mode" className="font-medium">
                View
              </label>
              <select id="mode" name="mode" defaultValue={mode} className="border border-neutral-300 rounded px-2 py-1">
                <option value="detail">Detail (per week)</option>
                <option value="summary">Summary (consolidated)</option>
              </select>
            </div>
          </form>
          <ZoomControl />
          <ShareReportButton targetId="alliance-detail-content" filename={`alliance-detail-${mode}.png`} title="Alliance Detail Report" />
        </div>

        <p className="text-neutral-400 text-xs">
          Summary consolidates the selected weeks per member: each category collapses per its own &quot;Summarised as&quot;
          setting in Setup → Categories (Sum / Average / Max / Min / Selected week - defaults to Selected week, the
          value from the last week in range). MVP always sums across the range regardless of any category setting.
        </p>

        <div className="flex items-center gap-3">
          <ExcelExportButton href={`/api/dashboards/alliance/detail/export?${exportParams.toString()}`} className="self-start" />
        </div>

        <ZoomWrapper contentId="alliance-detail-content">
          {rows.length === 0 ? (
            <p className="text-neutral-500 text-sm">No data for the selected filters.</p>
          ) : (
            <DataTable columns={columns} rows={rows} defaultSort={{ key: "member", direction: "asc" }} />
          )}
        </ZoomWrapper>
      </div>
    </ZoomProvider>
  );
}
