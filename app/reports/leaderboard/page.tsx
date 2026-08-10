import { prisma } from "@/lib/db";
import { ZoomWrapper } from "@/components/ZoomWrapper";
import { ShareToWhatsApp } from "@/components/ShareToWhatsApp";
import { ShareScreenshotToWhatsApp } from "@/components/ShareScreenshotToWhatsApp";
import { getWhatsappShareUrl } from "@/lib/whatsapp";

// Kills is a lifetime-cumulative reading in-game (never resets) - "this week" and
// "last N weeks" have to be computed as the gain between cumulative readings, not the
// raw stored value. VS/DS/Donations reset/are tracked per-event, so the raw value is
// already the right per-week figure.
const LEADERBOARD_CATEGORIES = [
  { key: "kills", label: "Kills", cumulative: true },
  { key: "desert_storm", label: "DS", cumulative: false },
  { key: "vs", label: "VS", cumulative: false },
  { key: "donations", label: "Donations", cumulative: false },
];

const IMPROVEMENT_CAP = 500;

type SeriesRow = { weekNumber: number; memberId: number; memberName: string; value: number };

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString();
}

// For non-cumulative categories, the series is just the raw stored values. For
// cumulative categories (Kills), each reading is converted into the gain since that
// member's previous reading - a member's very first-ever reading has no baseline to
// diff against, so it's dropped rather than shown as a misleading giant "gain".
async function getCategorySeries(categoryKey: string, cumulative: boolean): Promise<SeriesRow[]> {
  const stats = await prisma.weeklyStat.findMany({
    where: { categoryKey },
    include: { member: true },
    orderBy: { weekNumber: "asc" },
  });

  if (!cumulative) {
    return stats.map((s) => ({ weekNumber: s.weekNumber, memberId: s.memberId, memberName: s.member.name, value: s.value }));
  }

  const lastByMember = new Map<number, number>();
  const series: SeriesRow[] = [];
  for (const s of stats) {
    const prev = lastByMember.get(s.memberId);
    if (prev !== undefined) {
      series.push({ weekNumber: s.weekNumber, memberId: s.memberId, memberName: s.member.name, value: s.value - prev });
    }
    lastByMember.set(s.memberId, s.value);
  }
  return series;
}

function recentWeeksFromSeries(series: SeriesRow[], maxWeek: number, limit: number, inclusive: boolean): number[] {
  const weeks = Array.from(
    new Set(series.filter((r) => (inclusive ? r.weekNumber <= maxWeek : r.weekNumber < maxWeek)).map((r) => r.weekNumber))
  );
  weeks.sort((a, b) => b - a);
  return weeks.slice(0, limit);
}

function topThisWeek(series: SeriesRow[], week: number, limit = 20) {
  return series
    .filter((r) => r.weekNumber === week)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((r) => ({ name: r.memberName, value: r.value }));
}

function topSumOverWeeks(series: SeriesRow[], weeks: number[], limit = 20) {
  if (weeks.length === 0) return [];
  const weekSet = new Set(weeks);
  const sums = new Map<number, { name: string; total: number }>();
  for (const r of series) {
    if (!weekSet.has(r.weekNumber)) continue;
    const entry = sums.get(r.memberId) ?? { name: r.memberName, total: 0 };
    entry.total += r.value;
    sums.set(r.memberId, entry);
  }
  return Array.from(sums.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

function getImprovement(series: SeriesRow[], week: number, limit = 20) {
  const thisWeekRows = series.filter((r) => r.weekNumber === week);
  const priorWeeks = new Set(recentWeeksFromSeries(series, week, 5, false));

  const priorSum = new Map<number, number>();
  const priorCount = new Map<number, number>();
  for (const r of series) {
    if (!priorWeeks.has(r.weekNumber)) continue;
    priorSum.set(r.memberId, (priorSum.get(r.memberId) ?? 0) + r.value);
    priorCount.set(r.memberId, (priorCount.get(r.memberId) ?? 0) + 1);
  }

  const results = thisWeekRows.map((r) => {
    const count = priorCount.get(r.memberId) ?? 0;
    const avg = count > 0 ? priorSum.get(r.memberId)! / count : 0;
    const pct = avg > 0 ? Math.min(IMPROVEMENT_CAP, Math.round((r.value / avg) * 100)) : IMPROVEMENT_CAP;
    return { name: r.memberName, pct };
  });

  return results.sort((a, b) => b.pct - a.pct).slice(0, limit);
}

// All-time panel: non-cumulative categories surface each member's single best week ever
// (and which week); the cumulative category (Kills) instead surfaces their latest/highest
// raw reading, since that reading already *is* their lifetime total.
async function getAllTimeBestWeek(categoryKey: string, limit = 20) {
  const stats = await prisma.weeklyStat.findMany({ where: { categoryKey }, include: { member: true } });
  const best = new Map<number, { name: string; value: number; week: number }>();
  for (const s of stats) {
    const cur = best.get(s.memberId);
    if (!cur || s.value > cur.value) best.set(s.memberId, { name: s.member.name, value: s.value, week: s.weekNumber });
  }
  return Array.from(best.values())
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

async function getLatestCumulative(categoryKey: string, limit = 20) {
  const stats = await prisma.weeklyStat.findMany({ where: { categoryKey }, include: { member: true } });
  const latest = new Map<number, { name: string; value: number; week: number }>();
  for (const s of stats) {
    const cur = latest.get(s.memberId);
    if (!cur || s.weekNumber > cur.week) latest.set(s.memberId, { name: s.member.name, value: s.value, week: s.weekNumber });
  }
  return Array.from(latest.values())
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function formatShareText(
  categoryLabel: string,
  week: number,
  thisWeek: { name: string; value: number }[],
  last5: { name: string; total: number }[],
  last10: { name: string; total: number }[],
  improvement: { name: string; pct: number }[],
  allTime: { name: string; value: number }[],
  allTimeLabel: string
): string {
  const top = (rows: { name: string; value: number }[]) =>
    rows
      .slice(0, 10)
      .map((r, i) => `${i + 1}. ${r.name}: ${formatNumber(r.value)}`)
      .join("\n") || "None";

  const lines = [
    `*${categoryLabel} Leaderboard - Week ${week}*`,
    "",
    "_This week_",
    top(thisWeek),
    "",
    "_Last 5 weeks_",
    top(last5.map((r) => ({ name: r.name, value: r.total }))),
    "",
    "_Last 10 weeks_",
    top(last10.map((r) => ({ name: r.name, value: r.total }))),
    "",
    "_Improvement_",
    improvement
      .slice(0, 10)
      .map((r, i) => `${i + 1}. ${r.name}: ${r.pct}%`)
      .join("\n") || "None",
    "",
    `_${allTimeLabel}_`,
    top(allTime),
  ];
  return lines.join("\n").trim();
}

export default async function LeaderboardPage({ searchParams }: PageProps<"/reports/leaderboard">) {
  const params = await searchParams;

  const categoryParam = Array.isArray(params.category) ? params.category[0] : params.category;
  const selectedCategory = LEADERBOARD_CATEGORIES.find((c) => c.key === categoryParam) ?? LEADERBOARD_CATEGORIES[0];

  const weeks = await prisma.weeklyStat.findMany({
    where: { categoryKey: selectedCategory.key },
    select: { weekNumber: true },
    distinct: ["weekNumber"],
    orderBy: { weekNumber: "desc" },
  });
  const weekNumbers = weeks.map((w) => w.weekNumber);
  const defaultWeek = weekNumbers.length > 0 ? weekNumbers[0] : 1;

  const weekParam = Array.isArray(params.week) ? params.week[0] : params.week;
  const selectedWeek = weekParam ? Number(weekParam) : defaultWeek;

  const series = await getCategorySeries(selectedCategory.key, selectedCategory.cumulative);

  const last5Weeks = recentWeeksFromSeries(series, selectedWeek, 5, true);
  const last10Weeks = recentWeeksFromSeries(series, selectedWeek, 10, true);

  const thisWeek = topThisWeek(series, selectedWeek);
  const last5 = topSumOverWeeks(series, last5Weeks);
  const last10 = topSumOverWeeks(series, last10Weeks);
  const improvement = getImprovement(series, selectedWeek);
  const allTime = selectedCategory.cumulative
    ? await getLatestCumulative(selectedCategory.key)
    : await getAllTimeBestWeek(selectedCategory.key);

  const allTimeLabel = selectedCategory.cumulative ? `Total ${selectedCategory.label}` : "All time Top 20";
  const allTimeValueLabel = selectedCategory.cumulative ? `All ${selectedCategory.label}` : "Total Score";

  const shareText = formatShareText(
    selectedCategory.label,
    selectedWeek,
    thisWeek,
    last5,
    last10,
    improvement,
    allTime.map((r) => ({ name: r.name, value: r.value })),
    allTimeLabel
  );
  const shareUrl = await getWhatsappShareUrl(shareText);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Leaderboards</h1>
      {selectedCategory.cumulative && (
        <p className="text-neutral-500 text-xs bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Kills is a lifetime total in-game, so "this week" / "last N weeks" here show the gain since the
          previous reading, not the raw ranking-screen number.
        </p>
      )}

      <form className="flex items-center gap-2 text-sm flex-wrap">
        <label htmlFor="category" className="font-medium">
          Category
        </label>
        <select
          id="category"
          name="category"
          defaultValue={selectedCategory.key}
          className="border border-neutral-300 rounded px-2 py-1"
        >
          {LEADERBOARD_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
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
          list="leaderboard-known-weeks"
          className="border border-neutral-300 rounded px-2 py-1 w-24"
        />
        <datalist id="leaderboard-known-weeks">
          {weekNumbers.map((w) => (
            <option key={w} value={w} />
          ))}
        </datalist>
        <button type="submit" className="bg-neutral-900 text-white rounded px-3 py-1">
          Go
        </button>
      </form>

      <div className="flex items-center gap-2 flex-wrap">
        <ShareToWhatsApp url={shareUrl} />
        <ShareScreenshotToWhatsApp
          targetId="leaderboard-content"
          filename={`leaderboard-${selectedCategory.key}.png`}
          title={`${selectedCategory.label} Leaderboard`}
        />
      </div>

      <ZoomWrapper contentId="leaderboard-content">
      <div className="flex flex-row flex-nowrap items-start gap-4 overflow-x-auto">
        <Panel title={`Top 20 ${selectedCategory.label} from this week`} headerClass="bg-pink-300">
          {thisWeek.length === 0 ? <Empty /> : <SimpleTable rows={thisWeek} valueLabel={selectedCategory.label} />}
        </Panel>

        <Panel title={`Top 20 ${selectedCategory.label} from last 5 weeks`} headerClass="bg-sky-300">
          {last5.length === 0 ? (
            <Empty />
          ) : (
            <SimpleTable rows={last5.map((r) => ({ name: r.name, value: r.total }))} valueLabel="Total" />
          )}
        </Panel>

        <Panel title={`Top 20 ${selectedCategory.label} from last 10 weeks`} headerClass="bg-amber-300">
          {last10.length === 0 ? (
            <Empty />
          ) : (
            <SimpleTable rows={last10.map((r) => ({ name: r.name, value: r.total }))} valueLabel="Total" />
          )}
        </Panel>

        <Panel title="Improvement over 5-week average" headerClass="bg-green-300">
          {improvement.length === 0 ? (
            <Empty />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 text-left">
                    <th className="py-0.5 px-3">Name</th>
                    <th className="py-0.5 px-3">Improvement</th>
                  </tr>
                </thead>
                <tbody>
                  {improvement.map((r) => (
                    <tr key={r.name} className="border-b border-neutral-100">
                      <td className="py-0.5 px-3 font-medium whitespace-nowrap">{r.name}</td>
                      <td className="py-0.5 px-3">{r.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title={allTimeLabel} headerClass="bg-red-300" width={!selectedCategory.cumulative ? "w-[320px]" : undefined}>
          {allTime.length === 0 ? (
            <Empty />
          ) : selectedCategory.cumulative ? (
            <SimpleTable rows={allTime.map((r) => ({ name: r.name, value: r.value }))} valueLabel={allTimeValueLabel} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 text-left">
                    <th className="py-0.5 px-3">Name</th>
                    <th className="py-0.5 px-3">Week</th>
                    <th className="py-0.5 px-3">{allTimeValueLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {allTime.map((r) => (
                    <tr key={r.name} className="border-b border-neutral-100">
                      <td className="py-0.5 px-3 font-medium whitespace-nowrap">{r.name}</td>
                      <td className="py-0.5 px-3 text-neutral-500">{r.week}</td>
                      <td className="py-0.5 px-3">{formatNumber(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      </ZoomWrapper>
    </div>
  );
}

function Panel({
  title,
  headerClass,
  width,
  children,
}: {
  title: string;
  headerClass: string;
  width?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`border border-neutral-200 rounded overflow-hidden shrink-0 ${width ?? "w-[260px]"}`}>
      <div className={`${headerClass} px-3 py-1 font-semibold text-center text-neutral-900`}>{title}</div>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-neutral-500 text-sm p-2">No data.</p>;
}

function SimpleTable({ rows, valueLabel }: { rows: { name: string; value: number }[]; valueLabel: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-neutral-200 text-left">
            <th className="py-0.5 px-3">Name</th>
            <th className="py-0.5 px-3">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-neutral-100">
              <td className="py-0.5 px-3 font-medium whitespace-nowrap">{r.name}</td>
              <td className="py-0.5 px-3">{formatNumber(r.value)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-0.5 px-3">Total</td>
            <td className="py-0.5 px-3">{formatNumber(rows.reduce((sum, r) => sum + r.value, 0))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
