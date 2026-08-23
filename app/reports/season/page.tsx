import { prisma } from "@/lib/db";
import { ZoomWrapper, ZoomProvider, ZoomControl } from "@/components/ZoomWrapper";
import { ShareReportButton } from "@/components/ShareReportButton";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/DataTable";
import { pickNumberFormat, formatWithRule } from "@/lib/format";
import { requireMenuAccess } from "@/lib/menuAccess";
import { getSeasonReportData } from "@/lib/season/report";
import { SeasonFinalizeControls } from "./SeasonFinalizeControls";

export default async function SeasonReportPage({ searchParams }: PageProps<"/reports/season">) {
  const user = await requireMenuAccess("home-season-reports");
  const params = await searchParams;

  const seasons = await prisma.season.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, weekStart: true, weekEnd: true } });

  if (seasons.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Season Report</h1>
        <p className="text-neutral-500 text-sm">No seasons set up yet - create one in Setup → Seasons.</p>
      </div>
    );
  }

  const seasonParam = Array.isArray(params.season) ? params.season[0] : params.season;
  const selectedSeasonId = seasonParam ? Number(seasonParam) : seasons[0].id;

  const data = await getSeasonReportData(selectedSeasonId);
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Season Report</h1>
        <p className="text-neutral-500 text-sm">Season not found.</p>
      </div>
    );
  }

  const columns: DataTableColumn[] = [
    { key: "rank", header: "Rank", filter: "number", align: "right" },
    { key: "member", header: "Commander", filter: "text" },
    ...data.categories.map((c): DataTableColumn => ({ key: `cat_${c.key}`, header: c.name, filter: "number" })),
    ...data.extraItems.map((i): DataTableColumn => ({ key: `extra_${i.key}`, header: i.name, filter: "number" })),
    { key: "seasonPoints", header: "Season Points", filter: "number" },
    { key: "band", header: "Band", filter: "number" },
    { key: "boxes", header: "Boxes", filter: "number" },
  ];

  const categoryRules = new Map(data.categories.map((c) => [c.key, pickNumberFormat(data.rows.map((r) => r.categoryPoints[c.key]))]));
  const extraRules = new Map(data.extraItems.map((i) => [i.key, pickNumberFormat(data.rows.map((r) => r.extraPoints[i.key]))]));

  const rows: DataTableRow[] = data.rows.map((r) => {
    const cells: Record<string, React.ReactNode> = {
      rank: <span className="text-neutral-500">{r.rank}</span>,
      member: <span className="font-medium">{r.memberName}</span>,
      seasonPoints: <span className="font-semibold">{formatWithRule(r.seasonPoints, "decimal")}</span>,
      band: <span className="text-neutral-500">{r.bandOrder ?? "—"}</span>,
      boxes: <span>{r.boxesAwarded}</span>,
    };
    const sortValues: Record<string, number | string> = {
      rank: r.rank,
      member: r.memberName,
      seasonPoints: r.seasonPoints,
      band: r.bandOrder ?? 9999,
      boxes: r.boxesAwarded,
    };
    for (const c of data.categories) {
      const v = r.categoryPoints[c.key];
      cells[`cat_${c.key}`] = formatWithRule(v, categoryRules.get(c.key)!);
      if (v !== undefined) sortValues[`cat_${c.key}`] = v;
    }
    for (const i of data.extraItems) {
      const v = r.extraPoints[i.key];
      cells[`extra_${i.key}`] = formatWithRule(v, extraRules.get(i.key)!);
      if (v !== undefined) sortValues[`extra_${i.key}`] = v;
    }
    return { id: r.memberId, cells, sortValues };
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Season Report</h1>
        {data.season.status === "final" && (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
            Finalized {data.season.finalizedAt ? new Date(data.season.finalizedAt).toLocaleDateString() : ""}
          </span>
        )}
      </div>

      <ZoomProvider>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <form className="flex items-center gap-2 text-sm contents">
            <button type="submit" className="bg-accent text-accent-contrast rounded px-3 py-1">
              Go
            </button>
            <label htmlFor="season" className="font-medium">
              Season
            </label>
            <select id="season" name="season" defaultValue={selectedSeasonId} className="border border-neutral-300 rounded px-2 py-1">
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.weekStart}–{s.weekEnd})
                </option>
              ))}
            </select>
          </form>
          <ZoomControl />
          <ShareReportButton targetId="season-report-content" filename={`season-report-${data.season.name}.png`} title="Season Report" />
          <a
            href={`/api/reports/season/export?seasonId=${data.season.id}`}
            className="border border-neutral-300 rounded px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Export to Excel
          </a>
        </div>

        {data.rows.length === 0 ? (
          <p className="text-neutral-500 text-sm">No active commanders to score.</p>
        ) : (
          <ZoomWrapper contentId="season-report-content">
            <DataTable columns={columns} rows={rows} defaultSort={{ key: "seasonPoints", direction: "desc" }} />
          </ZoomWrapper>
        )}

        {data.unallocatedBoxes > 0 && (
          <p className="text-amber-600 text-sm">{data.unallocatedBoxes} box(es) unallocated after banding — distribute manually.</p>
        )}
      </ZoomProvider>

      {user.role === "ADMIN" && (
        <SeasonFinalizeControls seasonId={data.season.id} status={data.season.status} finalizedAt={data.season.finalizedAt} />
      )}
    </div>
  );
}
