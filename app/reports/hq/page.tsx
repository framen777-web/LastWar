import { prisma } from "@/lib/db";
import { ZoomWrapper } from "@/components/ZoomWrapper";
import { ShareToWhatsApp } from "@/components/ShareToWhatsApp";
import { ShareScreenshotToWhatsApp } from "@/components/ShareScreenshotToWhatsApp";
import { getWhatsappShareUrl } from "@/lib/whatsapp";

type LevelUpRow = { name: string; thisWeek: number; lastWeek: number | null };
type DistributionRow = { level: number; count: number; pct: number };

async function getLevelUps(week: number): Promise<LevelUpRow[]> {
  const stats = await prisma.weeklyStat.findMany({
    where: { categoryKey: "members", weekNumber: { lte: week } },
    include: { member: true },
    orderBy: { weekNumber: "asc" },
  });

  const byMember = new Map<number, { name: string; thisWeek?: number; lastWeek?: number }>();
  for (const s of stats) {
    const entry = byMember.get(s.memberId) ?? { name: s.member.name };
    if (s.weekNumber === week) {
      entry.thisWeek = s.value;
    } else {
      entry.lastWeek = s.value;
    }
    byMember.set(s.memberId, entry);
  }

  const rows: LevelUpRow[] = [];
  for (const entry of byMember.values()) {
    if (entry.thisWeek === undefined) continue;
    if (entry.lastWeek === undefined) {
      rows.push({ name: entry.name, thisWeek: entry.thisWeek, lastWeek: null });
    } else if (entry.thisWeek > entry.lastWeek) {
      rows.push({ name: entry.name, thisWeek: entry.thisWeek, lastWeek: entry.lastWeek });
    }
  }

  rows.sort((a, b) => b.thisWeek - a.thisWeek);
  return rows;
}

async function getHqDistribution(week: number): Promise<DistributionRow[]> {
  const stats = await prisma.weeklyStat.findMany({ where: { categoryKey: "members", weekNumber: week } });
  const counts = new Map<number, number>();
  for (const s of stats) {
    const level = Math.round(s.value);
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  const total = stats.length;
  const rows = Array.from(counts.entries()).map(([level, count]) => ({
    level,
    count,
    pct: total > 0 ? Math.round((count / total) * 100) : 0,
  }));
  rows.sort((a, b) => b.level - a.level);
  return rows;
}

function formatShareText(week: number, levelUps: LevelUpRow[], distribution: DistributionRow[]): string {
  const lines = [`*HQ Levels - Week ${week}*`, "", "_Level Ups_"];
  if (levelUps.length === 0) {
    lines.push("None");
  } else {
    for (const r of levelUps) lines.push(`${r.name}: ${r.thisWeek} (${r.lastWeek ?? "New"})`);
  }
  lines.push("", "_Distribution_");
  if (distribution.length === 0) {
    lines.push("None");
  } else {
    for (const r of distribution) lines.push(`HQ ${r.level}: ${r.count} members (${r.pct}%)`);
  }
  return lines.join("\n").trim();
}

export default async function HqLevelsPage({ searchParams }: PageProps<"/reports/hq">) {
  const params = await searchParams;

  const weeks = await prisma.weeklyStat.findMany({
    where: { categoryKey: "members" },
    select: { weekNumber: true },
    distinct: ["weekNumber"],
    orderBy: { weekNumber: "desc" },
  });
  const weekNumbers = weeks.map((w) => w.weekNumber);
  const defaultWeek = weekNumbers.length > 0 ? weekNumbers[0] : 1;

  const weekParam = Array.isArray(params.week) ? params.week[0] : params.week;
  const selectedWeek = weekParam ? Number(weekParam) : defaultWeek;

  const [levelUps, distribution] = await Promise.all([getLevelUps(selectedWeek), getHqDistribution(selectedWeek)]);

  const shareText = formatShareText(selectedWeek, levelUps, distribution);
  const shareUrl = await getWhatsappShareUrl(shareText);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">HQ Levels</h1>
      <p className="text-neutral-500 text-sm">
        Members who leveled up this week, and the alliance's HQ level distribution for this week.
      </p>

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
          list="hq-known-weeks"
          className="border border-neutral-300 rounded px-2 py-1 w-24"
        />
        <datalist id="hq-known-weeks">
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
        <ShareScreenshotToWhatsApp targetId="hq-content" filename="hq-levels.png" title="HQ Levels" />
      </div>

      <ZoomWrapper contentId="hq-content">
        <div className="flex flex-row flex-nowrap items-start gap-4 overflow-x-auto">
          <div className="border border-neutral-200 rounded overflow-hidden shrink-0 w-[300px]">
            <div className="bg-fuchsia-300 px-3 py-1 font-semibold text-center text-neutral-900">
              HQ Level Ups
            </div>
            {levelUps.length === 0 ? (
              <p className="text-neutral-500 text-sm p-2">No level ups this week.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left">
                      <th className="py-0.5 px-3">Member</th>
                      <th className="py-0.5 px-3">This Week</th>
                      <th className="py-0.5 px-3">Last Week</th>
                    </tr>
                  </thead>
                  <tbody>
                    {levelUps.map((r) => (
                      <tr key={r.name} className="border-b border-neutral-100">
                        <td className="py-0.5 px-3 font-medium whitespace-nowrap">{r.name}</td>
                        <td className="py-0.5 px-3">{r.thisWeek}</td>
                        <td className="py-0.5 px-3 text-neutral-500">{r.lastWeek ?? "New"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="border border-neutral-200 rounded overflow-hidden shrink-0 w-[240px]">
            <div className="bg-fuchsia-300 px-3 py-1 font-semibold text-center text-neutral-900">
              HQ Distribution
            </div>
            {distribution.length === 0 ? (
              <p className="text-neutral-500 text-sm p-2">No data for this week.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left">
                      <th className="py-0.5 px-3">HQ</th>
                      <th className="py-0.5 px-3">Members</th>
                      <th className="py-0.5 px-3">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {distribution.map((r) => (
                      <tr key={r.level} className="border-b border-neutral-100">
                        <td className="py-0.5 px-3 font-medium">{r.level}</td>
                        <td className="py-0.5 px-3">{r.count}</td>
                        <td className="py-0.5 px-3 text-neutral-500">{r.pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </ZoomWrapper>
    </div>
  );
}
