import { prisma } from "@/lib/db";
import { ZoomWrapper, ZoomProvider, ZoomControl } from "@/components/ZoomWrapper";
import { ShareReportButton } from "@/components/ShareReportButton";
import { NumberStepper } from "@/components/NumberStepper";
import { SuggestionSelect } from "@/components/SuggestionSelect";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/DataTable";
import { getMemberWeekRows } from "@/lib/mvp/data";
import { computeAllMvp, type ScoredRow } from "@/lib/mvp/mvp";
import { getWeights } from "@/lib/mvp/weights";
import { requireMenuAccess } from "@/lib/menuAccess";
import { resolveBottomWeeksWindow } from "@/lib/reports/r1Settings";
import { REPORT_NAME_COL_WIDTH, REPORT_VALUE_COL_WIDTH, parseLimitParam, applyLimit } from "@/lib/reportLayout";
import { LimitSelect } from "@/components/LimitSelect";

const SUGGESTION_BADGE_STYLES: Record<string, string> = {
  Promote: "bg-green-100 text-green-800 border-green-300",
  Watch: "bg-amber-100 text-amber-800 border-amber-300",
  Demote: "bg-red-100 text-red-800 border-red-300",
};

function SuggestionBadge({ value }: { value: string | null }) {
  return (
    <span className={`border rounded px-2 py-1 text-xs ${SUGGESTION_BADGE_STYLES[value ?? ""] ?? "bg-neutral-50 text-neutral-500 border-neutral-200"}`}>
      {value ?? "—"}
    </span>
  );
}

function fmtVS(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Math.round(n).toLocaleString();
}

function fmtMvp(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toFixed(2);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function Delta({ from, to, decimals }: { from: number | null; to: number | null; decimals: number }) {
  if (from === null || to === null) return null;
  const diff = to - from;
  if (diff === 0) return <span className="text-neutral-400 text-xs ml-1">±0</span>;
  const up = diff > 0;
  return (
    <span className={`text-xs ml-1 ${up ? "text-green-600" : "text-red-600"}`}>
      {up ? "▲" : "▼"}
      {Math.abs(diff).toFixed(decimals)}
    </span>
  );
}

export default async function R1ReportPage({ searchParams }: PageProps<"/reports/r1">) {
  const user = await requireMenuAccess("reports-r1");
  const isAdmin = user.role === "ADMIN";
  const params = await searchParams;

  const rows = await getMemberWeekRows();

  const firstWeekByMember = new Map<number, number>();
  for (const r of rows) {
    const existing = firstWeekByMember.get(r.memberId);
    if (existing === undefined || r.weekNumber < existing) {
      firstWeekByMember.set(r.memberId, r.weekNumber);
    }
  }

  const weights = await getWeights();
  const scoredAll = computeAllMvp(rows, weights);

  const mvpMap = new Map<string, ScoredRow>();
  for (const r of scoredAll) mvpMap.set(`${r.memberId}:${r.weekNumber}`, r);

  const weekNumbers = Array.from(new Set(rows.map((r) => r.weekNumber))).sort((a, b) => a - b);
  const defaultWeek = weekNumbers.length > 0 ? weekNumbers[weekNumbers.length - 1] : 1;

  const weekParam = Array.isArray(params.week) ? params.week[0] : params.week;
  const selectedWeek = weekParam ? Number(weekParam) : defaultWeek;

  // "Active" = has at least one recorded value for the selected week - deliberately not
  // Member.isActive, which reflects the most recently completed week, not whichever week
  // this report happens to be viewing.
  const activeMemberIdsThisWeek = new Set(rows.filter((r) => r.weekNumber === selectedWeek).map((r) => r.memberId));

  const rankParam = Array.isArray(params.rank) ? params.rank[0] : params.rank;
  const selectedRank = rankParam ? Number(rankParam) : 1;

  const selectedLimit = parseLimitParam(params.limit, "10");
  const bottomLabel = selectedLimit === "all" ? "Bottom all" : `Bottom ${selectedLimit}`;

  const weeksParam = Array.isArray(params.weeks) ? params.weeks[0] : params.weeks;
  const bottomWeeksWindow = await resolveBottomWeeksWindow(selectedWeek, weeksParam ? Number(weeksParam) : undefined);

  const members = await prisma.member.findMany({ select: { id: true, name: true, allianceRank: true } });

  const suggestions = await prisma.suggestion.findMany({ where: { weekNumber: selectedWeek } });
  const suggestionByMember = new Map(suggestions.map((s) => [s.memberId, s.value]));

  // Panel A - "Current Ranked {n}": members at that rank, prior window is W-5..W-2 (4 weeks).
  const priorWeeksA = [selectedWeek - 5, selectedWeek - 4, selectedWeek - 3, selectedWeek - 2].filter((w) => w >= 1);
  const panelA = members
    .filter((m) => m.allianceRank === `R${selectedRank}` && activeMemberIdsThisWeek.has(m.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => {
      const thisWeek = mvpMap.get(`${m.id}:${selectedWeek}`) ?? null;
      const priorEntries = priorWeeksA.map((w) => mvpMap.get(`${m.id}:${w}`)).filter((e): e is ScoredRow => !!e);
      const priorAvgVS = mean(priorEntries.filter((e) => e.vsScore !== null).map((e) => e.vsScore as number));
      const priorAvgMvp = priorEntries.length > 0 ? mean(priorEntries.map((e) => e.mvp)) : null;
      return {
        memberId: m.id,
        name: m.name,
        priorAvgVS,
        thisWeekVS: thisWeek?.vsScore ?? null,
        priorAvgMvp,
        thisWeekMvp: thisWeek?.mvp ?? null,
        suggestion: suggestionByMember.get(m.id) ?? null,
      };
    });

  // Panel B - "Bottom N over {bottomWeeksWindow} weeks": members present in W, mean MVP over
  // the trailing bottomWeeksWindow weeks ending at W (inclusive).
  const windowB = Array.from({ length: bottomWeeksWindow }, (_, i) => selectedWeek - bottomWeeksWindow + 1 + i).filter((w) => w >= 1);
  const windowVSForB = windowB.filter((w) => w !== selectedWeek);

  const presentThisWeek = scoredAll.filter((r) => {
    if (r.weekNumber !== selectedWeek) return false;
    if (!activeMemberIdsThisWeek.has(r.memberId)) return false;
    const firstWeek = firstWeekByMember.get(r.memberId);
    if (firstWeek === undefined) return true; // no history at all - shouldn't happen, don't hide unexpectedly
    return selectedWeek - firstWeek + 1 >= 5;
  });
  const panelB = presentThisWeek
    .map((r) => {
      const mvpEntries = windowB.map((w) => mvpMap.get(`${r.memberId}:${w}`)).filter((e): e is ScoredRow => !!e);
      if (mvpEntries.length === 0) return null;
      const currentAvgMvp = mean(mvpEntries.map((e) => e.mvp));

      const vsEntries = windowVSForB
        .map((w) => mvpMap.get(`${r.memberId}:${w}`))
        .filter((e): e is ScoredRow => !!e && e.vsScore !== null);
      const currentAvgVS = vsEntries.length > 0 ? mean(vsEntries.map((e) => e.vsScore as number)) : null;

      return {
        memberId: r.memberId,
        name: r.memberName,
        currentAvgVS,
        thisWeekVS: r.vsScore,
        currentAvgMvp,
        thisWeekMvp: r.mvp,
        suggestion: suggestionByMember.get(r.memberId) ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => (a.currentAvgMvp ?? 0) - (b.currentAvgMvp ?? 0));
  const panelBLimited = applyLimit(panelB, selectedLimit);

  const panelAColumns: DataTableColumn[] = [
    { key: "member", header: "Commander", filter: "text", width: REPORT_NAME_COL_WIDTH },
    { key: "priorAvgVS", header: "Prior Ave VS", filter: "number", width: REPORT_VALUE_COL_WIDTH },
    { key: "thisWeekVS", header: "This Week VS", filter: "number", width: REPORT_VALUE_COL_WIDTH },
    { key: "priorAvgMvp", header: "Prior Avg MVP", filter: "number", width: REPORT_VALUE_COL_WIDTH },
    { key: "thisWeekMvp", header: "This week MVP", filter: "number", width: REPORT_VALUE_COL_WIDTH },
    { key: "suggestion", header: "Suggestion", width: REPORT_VALUE_COL_WIDTH },
  ];

  const panelARows: DataTableRow[] = panelA.map((r) => {
    const cells: Record<string, React.ReactNode> = {
      member: <span className="font-medium">{r.name}</span>,
      priorAvgVS: fmtVS(r.priorAvgVS),
      thisWeekVS: (
        <>
          {fmtVS(r.thisWeekVS)}
          <Delta from={r.priorAvgVS} to={r.thisWeekVS} decimals={0} />
        </>
      ),
      priorAvgMvp: fmtMvp(r.priorAvgMvp),
      thisWeekMvp: (
        <>
          {fmtMvp(r.thisWeekMvp)}
          <Delta from={r.priorAvgMvp} to={r.thisWeekMvp} decimals={2} />
        </>
      ),
      suggestion: isAdmin ? (
        <SuggestionSelect memberId={r.memberId} weekNumber={selectedWeek} initialValue={r.suggestion} />
      ) : (
        <SuggestionBadge value={r.suggestion} />
      ),
    };
    const sortValues: Record<string, number | string> = { member: r.name };
    if (r.priorAvgVS !== null) sortValues.priorAvgVS = r.priorAvgVS;
    if (r.thisWeekVS !== null && r.thisWeekVS !== undefined) sortValues.thisWeekVS = r.thisWeekVS;
    if (r.priorAvgMvp !== null) sortValues.priorAvgMvp = r.priorAvgMvp;
    if (r.thisWeekMvp !== null && r.thisWeekMvp !== undefined) sortValues.thisWeekMvp = r.thisWeekMvp;
    return { id: r.memberId, cells, sortValues };
  });

  const panelBColumns: DataTableColumn[] = [
    { key: "member", header: "Commander", filter: "text", width: REPORT_NAME_COL_WIDTH },
    { key: "currentAvgVS", header: "Current Avg VS", filter: "number", width: REPORT_VALUE_COL_WIDTH },
    { key: "thisWeekVS", header: "This Week VS", filter: "number", width: REPORT_VALUE_COL_WIDTH },
    { key: "currentAvgMvp", header: "Current AVG MVP", filter: "number", width: REPORT_VALUE_COL_WIDTH },
    { key: "thisWeekMvp", header: "This week MVP", filter: "number", width: REPORT_VALUE_COL_WIDTH },
    { key: "suggestion", header: "Suggestion", width: REPORT_VALUE_COL_WIDTH },
  ];

  const panelBRows: DataTableRow[] = panelBLimited.map((r) => {
    const cells: Record<string, React.ReactNode> = {
      member: <span className="font-medium">{r.name}</span>,
      currentAvgVS: fmtVS(r.currentAvgVS),
      thisWeekVS: (
        <>
          {fmtVS(r.thisWeekVS)}
          <Delta from={r.currentAvgVS} to={r.thisWeekVS} decimals={0} />
        </>
      ),
      currentAvgMvp: fmtMvp(r.currentAvgMvp),
      thisWeekMvp: (
        <>
          {fmtMvp(r.thisWeekMvp)}
          <Delta from={r.currentAvgMvp} to={r.thisWeekMvp} decimals={2} />
        </>
      ),
      suggestion: isAdmin ? (
        <SuggestionSelect memberId={r.memberId} weekNumber={selectedWeek} initialValue={r.suggestion} options={["Watch", "Demote"]} />
      ) : (
        <SuggestionBadge value={r.suggestion} />
      ),
    };
    const sortValues: Record<string, number | string> = { member: r.name, thisWeekMvp: r.thisWeekMvp };
    if (r.currentAvgVS !== null) sortValues.currentAvgVS = r.currentAvgVS;
    if (r.thisWeekVS !== null) sortValues.thisWeekVS = r.thisWeekVS;
    if (r.currentAvgMvp !== null) sortValues.currentAvgMvp = r.currentAvgMvp;
    return { id: r.memberId, cells, sortValues };
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">R1 Report</h1>

      <ZoomProvider>
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <form className="flex items-center gap-2 contents">
          <button type="submit" className="bg-accent text-accent-contrast rounded px-3 py-1">
            Go
          </button>

          <label htmlFor="week" className="font-medium">
            Week
          </label>
          <NumberStepper id="week" name="week" defaultValue={selectedWeek} min={1} listId="r1-known-weeks" />
          <datalist id="r1-known-weeks">
            {weekNumbers.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>

          <label htmlFor="rank" className="font-medium">
            Rank
          </label>
          <NumberStepper id="rank" name="rank" defaultValue={selectedRank} min={1} max={5} className="w-8" />

          <label htmlFor="weeks" className="font-medium">
            Weeks
          </label>
          <NumberStepper id="weeks" name="weeks" defaultValue={bottomWeeksWindow} min={1} className="w-8" />

          <LimitSelect defaultValue={selectedLimit} />
        </form>

        <ZoomControl />
        <ShareReportButton targetId="r1-report-content" filename="r1-report.png" title="R1 Report" />
      </div>

      <ZoomWrapper contentId="r1-report-content">
        <div className="flex flex-col gap-6">
          <div className="border border-neutral-200 rounded overflow-hidden">
            <div className="report-panel-header bg-sky-300 px-3 py-1 font-semibold">Current Ranked {selectedRank}</div>
            {panelA.length === 0 ? (
              <p className="text-neutral-500 text-sm p-2">No members at rank R{selectedRank}.</p>
            ) : (
              <DataTable
                columns={panelAColumns}
                rows={panelARows}
                defaultSort={{ key: "member", direction: "asc" }}
                fitContent
                dense
                textSizeClass="text-base"
              />
            )}
          </div>

          <div className="border border-neutral-200 rounded overflow-hidden">
            <div className="report-panel-header bg-pink-300 px-3 py-1 font-semibold">{bottomLabel} over {bottomWeeksWindow} weeks</div>
            {panelBLimited.length === 0 ? (
              <p className="text-neutral-500 text-sm p-2">No data for week {selectedWeek}.</p>
            ) : (
              <DataTable
                columns={panelBColumns}
                rows={panelBRows}
                defaultSort={{ key: "thisWeekMvp", direction: "asc" }}
                fitContent
                dense
                textSizeClass="text-base"
              />
            )}
          </div>
        </div>
      </ZoomWrapper>
      </ZoomProvider>
    </div>
  );
}
