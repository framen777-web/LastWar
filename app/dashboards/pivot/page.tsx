import { prisma } from "@/lib/db";
import { ZoomWrapper, ZoomProvider, ZoomControl } from "@/components/ZoomWrapper";
import { ShareReportButton } from "@/components/ShareReportButton";
import { requireMenuAccess } from "@/lib/menuAccess";
import { getPivotCategories, getPivotSeries } from "@/lib/dashboards/pivot";
import { LineChart } from "@/components/LineChart";
import { formatStatNumber } from "@/lib/format";
import { SaveViewControls } from "./SaveViewControls";

const WEEK_COUNT_OPTIONS = [4, 8, 12, 26, 52];

// A checked <input type="checkbox" name="members" value="3"> submits as a repeated query param
// (members=3&members=7) - Next gives that back as a string[]. A saved view's config string
// (built by SaveViewControls) instead comma-joins into one value (members=3,7). Accepting both
// shapes here means the live form and a loaded saved view both just work, with no client-side JS
// needed to bridge the two formats before submit.
function parseListParam(param: string | string[] | undefined): string[] {
  if (!param) return [];
  const values = Array.isArray(param) ? param : param.split(",");
  return values.map((v) => v.trim()).filter(Boolean);
}

export default async function PivotPage({ searchParams }: PageProps<"/dashboards/pivot">) {
  const user = await requireMenuAccess("dashboards-pivot");
  const params = await searchParams;

  const canPickAnyMember = user.role === "ADMIN" || user.role === "LEADER";
  const allMembers = await prisma.member.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const allCategories = await getPivotCategories();

  const requestedMemberIds = parseListParam(params.members)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  const selectedMemberIds = canPickAnyMember
    ? requestedMemberIds.length > 0
      ? requestedMemberIds
      : allMembers.slice(0, 1).map((m) => m.id)
    : [user.id];

  const requestedCategoryKeys = parseListParam(params.categories);
  const selectedCategories = allCategories.filter((c) =>
    requestedCategoryKeys.length > 0 ? requestedCategoryKeys.includes(c.key) : allCategories[0]?.key === c.key
  );

  const weeksParam = Array.isArray(params.weeks) ? params.weeks[0] : params.weeks;
  const weeksCount = WEEK_COUNT_OPTIONS.includes(Number(weeksParam)) ? Number(weeksParam) : WEEK_COUNT_OPTIONS[1];

  const knownWeeks = await prisma.weeklyStat.findMany({
    select: { weekNumber: true },
    distinct: ["weekNumber"],
    orderBy: { weekNumber: "asc" },
  });
  const weekNumbers = knownWeeks.map((w) => w.weekNumber);
  const selectedWeeks = weekNumbers.slice(-weeksCount);

  // Cap total series so the chart and legend stay readable.
  const series = (await getPivotSeries(selectedMemberIds, selectedCategories, selectedWeeks)).slice(0, 8);

  const savedViews = await prisma.pivotView.findMany({
    where: { creatorId: user.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, config: true },
  });

  const showMemberInLabel = selectedMemberIds.length > 1;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Custom Pivot</h1>
      <p className="text-neutral-500 text-sm">
        Pick any combination of {canPickAnyMember ? "commanders" : "your own data"}, categories, and a week range to
        build your own chart. Save the ones you come back to often - saved views are private to you.
      </p>

      <form className="flex flex-col gap-3 text-sm border border-neutral-200 rounded p-4">
        {canPickAnyMember && (
          <fieldset className="flex flex-col gap-1">
            <legend className="font-medium mb-1">Members</legend>
            <div className="flex flex-wrap gap-3">
              {allMembers.map((m) => (
                <label key={m.id} className="flex items-center gap-1">
                  <input type="checkbox" name="members" value={m.id} defaultChecked={selectedMemberIds.includes(m.id)} />
                  {m.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="flex flex-col gap-1">
          <legend className="font-medium mb-1">Categories</legend>
          <div className="flex flex-wrap gap-3">
            {allCategories.map((c) => (
              <label key={c.key} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  name="categories"
                  value={c.key}
                  defaultChecked={selectedCategories.some((sc) => sc.key === c.key)}
                />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center gap-2">
          <label htmlFor="weeks" className="font-medium">
            Weeks
          </label>
          <select id="weeks" name="weeks" defaultValue={weeksCount} className="border border-neutral-300 rounded px-2 py-1">
            {WEEK_COUNT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button type="submit" className="bg-accent text-accent-contrast rounded px-3 py-1">
            Go
          </button>
        </div>
      </form>

      <SaveViewControls
        currentQuery={{ members: selectedMemberIds, categories: selectedCategories.map((c) => c.key), weeks: weeksCount }}
        savedViews={savedViews}
      />

      <ZoomProvider>
        <div className="flex items-center gap-2">
          <ZoomControl />
          <ShareReportButton targetId="pivot-chart-content" filename="pivot.png" title="Custom Pivot" />
        </div>
        <ZoomWrapper contentId="pivot-chart-content">
          <div className="border border-neutral-200 rounded p-4">
            {series.length === 0 || series.every((s) => s.points.every((p) => p === null)) ? (
              <p className="text-neutral-500 text-sm">No data for this selection.</p>
            ) : (
              <LineChart
                xLabels={selectedWeeks.map((w) => `W${w}`)}
                series={series.map((s) => ({
                  label: showMemberInLabel ? `${s.memberName} - ${s.categoryName}` : s.categoryName,
                  points: s.points,
                }))}
                formatValue={formatStatNumber}
              />
            )}
          </div>
        </ZoomWrapper>
      </ZoomProvider>
    </div>
  );
}
