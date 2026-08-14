import { ZoomWrapper } from "@/components/ZoomWrapper";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/DataTable";
import { pickNumberFormat, formatWithRule } from "@/lib/format";
import { getMemberWeekRows } from "@/lib/mvp/data";
import { computeAllMvp, type ScoredRow } from "@/lib/mvp/mvp";
import { getWeights } from "@/lib/mvp/weights";
import { requireRole } from "@/lib/auth/dal";
import { REPORT_NAME_COL_WIDTH, REPORT_VALUE_COL_WIDTH } from "@/lib/reportLayout";

const LIMIT_OPTIONS = [10, 20, 50] as const;

function fmtPct(n: number | null): { text: string; negative: boolean } {
  if (n === null) return { text: "—", negative: false };
  const pct = n * 100;
  return { text: `${pct.toFixed(2)}%`, negative: pct < 0 };
}

export default async function MvpReportPage({ searchParams }: PageProps<"/reports/mvp">) {
  await requireRole(["ADMIN", "LEADER"]);
  const params = await searchParams;

  const rows = await getMemberWeekRows();
  const weights = await getWeights();

  const weekNumbers = Array.from(new Set(rows.map((r) => r.weekNumber))).sort((a, b) => a - b);
  const defaultWeek = weekNumbers.length > 0 ? weekNumbers[weekNumbers.length - 1] : 1;

  const weekParam = Array.isArray(params.week) ? params.week[0] : params.week;
  const selectedWeek = weekParam ? Number(weekParam) : defaultWeek;

  const limitParam = Array.isArray(params.limit) ? params.limit[0] : params.limit;
  const selectedLimit = limitParam ?? "20";

  const scored = computeAllMvp(rows, weights)
    .filter((r) => r.weekNumber === selectedWeek)
    .sort((a, b) => b.mvp - a.mvp);

  const limited: ScoredRow[] = selectedLimit === "all" ? scored : scored.slice(0, Number(selectedLimit));

  const showZs = weights.zombieSiege !== 0;
  const showAe = weights.allianceExercise !== 0;

  const columns: DataTableColumn[] = [
    { key: "member", header: "Commander", filter: "text", width: REPORT_NAME_COL_WIDTH },
    { key: "mvp", header: "MVP", filter: "number", width: REPORT_VALUE_COL_WIDTH },
    { key: "vs", header: "VS", subHeader: weights.vs.toFixed(2), filter: "number", width: REPORT_VALUE_COL_WIDTH },
    { key: "ds", header: "DS", subHeader: weights.ds.toFixed(2), filter: "number", width: REPORT_VALUE_COL_WIDTH },
    { key: "donations", header: "Donations", subHeader: weights.donations.toFixed(2), filter: "number", width: REPORT_VALUE_COL_WIDTH },
    { key: "hqUpgrade", header: "HQ Level Up", subHeader: weights.hqMover.toFixed(2), filter: "number", width: REPORT_VALUE_COL_WIDTH },
    { key: "kills", header: "Week Kills", subHeader: weights.kills.toFixed(2), filter: "number", width: REPORT_VALUE_COL_WIDTH },
    { key: "squad", header: "Squad % Improved", subHeader: weights.squad.toFixed(2), filter: "number", width: REPORT_VALUE_COL_WIDTH },
    { key: "cs", header: "Canyon Storm", subHeader: weights.canyonStorm.toFixed(2), filter: "number", width: REPORT_VALUE_COL_WIDTH },
    ...(showZs
      ? [{ key: "zs", header: "Zombie Siege", subHeader: weights.zombieSiege.toFixed(2), filter: "number" as const, width: REPORT_VALUE_COL_WIDTH }]
      : []),
    ...(showAe
      ? [
          {
            key: "ae",
            header: "Alliance Exercise",
            subHeader: weights.allianceExercise.toFixed(2),
            filter: "number" as const,
            width: REPORT_VALUE_COL_WIDTH,
          },
        ]
      : []),
  ];

  const vsRule = pickNumberFormat(limited.map((r) => r.vsScore));
  const dsRule = pickNumberFormat(limited.map((r) => r.dsPoints));
  const donationsRule = pickNumberFormat(limited.map((r) => r.donations));
  const killsRule = pickNumberFormat(limited.map((r) => r.weekKills));
  const csRule = pickNumberFormat(limited.map((r) => r.cs));
  const zsRule = pickNumberFormat(limited.map((r) => r.zs));
  const aeRule = pickNumberFormat(limited.map((r) => r.ae));

  const tableRows: DataTableRow[] = limited.map((r) => {
    const squad = fmtPct(r.squadImproved);
    const cells: Record<string, React.ReactNode> = {
      member: <span className="font-medium">{r.memberName}</span>,
      mvp: <span className="font-semibold">{r.mvp.toFixed(2)}</span>,
      vs: formatWithRule(r.vsScore, vsRule),
      ds: formatWithRule(r.dsPoints, dsRule),
      donations: formatWithRule(r.donations, donationsRule),
      hqUpgrade: <span className="text-center block">{r.hqUpgrade === 100 ? "✓" : "—"}</span>,
      kills: formatWithRule(r.weekKills, killsRule),
      squad: <span className={squad.negative ? "text-red-600" : ""}>{squad.text}</span>,
      cs: formatWithRule(r.cs, csRule),
    };
    const sortValues: Record<string, number | string> = {
      member: r.memberName,
      mvp: r.mvp,
      hqUpgrade: r.hqUpgrade === 100 ? 1 : 0,
    };
    if (r.vsScore !== null) sortValues.vs = r.vsScore;
    if (r.dsPoints !== null) sortValues.ds = r.dsPoints;
    if (r.donations !== null) sortValues.donations = r.donations;
    if (r.weekKills !== null) sortValues.kills = r.weekKills;
    if (r.squadImproved !== null) sortValues.squad = r.squadImproved * 100;
    if (r.cs !== null) sortValues.cs = r.cs;
    if (showZs) {
      cells.zs = formatWithRule(r.zs, zsRule);
      if (r.zs !== null) sortValues.zs = r.zs;
    }
    if (showAe) {
      cells.ae = formatWithRule(r.ae, aeRule);
      if (r.ae !== null) sortValues.ae = r.ae;
    }
    return { id: r.memberId, cells, sortValues };
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">MVP Report</h1>

      <form className="flex items-center gap-2 text-sm flex-wrap">
        <label htmlFor="week" className="font-medium">
          Week
        </label>
        <input
          id="week"
          name="week"
          type="number"
          min={1}
          defaultValue={selectedWeek}
          list="mvp-known-weeks"
          className="border border-neutral-300 rounded px-2 py-1 w-24"
        />
        <datalist id="mvp-known-weeks">
          {weekNumbers.map((w) => (
            <option key={w} value={w} />
          ))}
        </datalist>

        <label htmlFor="limit" className="font-medium">
          Show
        </label>
        <select id="limit" name="limit" defaultValue={selectedLimit} className="border border-neutral-300 rounded px-2 py-1">
          {LIMIT_OPTIONS.map((n) => (
            <option key={n} value={n}>
              Top {n}
            </option>
          ))}
          <option value="all">All</option>
        </select>

        <button type="submit" className="bg-accent text-accent-contrast rounded px-3 py-1">
          Go
        </button>
      </form>

      {scored.length === 0 ? (
        <p className="text-neutral-500 text-sm">No data for week {selectedWeek}.</p>
      ) : (
        <ZoomWrapper contentId="mvp-report-content">
          <DataTable
            columns={columns}
            rows={tableRows}
            showRowNumbers
            defaultSort={{ key: "mvp", direction: "desc" }}
            fitContent
            dense
            textSizeClass="text-base"
          />
        </ZoomWrapper>
      )}
    </div>
  );
}
