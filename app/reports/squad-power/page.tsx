import { prisma } from "@/lib/db";
import { ZoomWrapper } from "@/components/ZoomWrapper";
import { ShareToWhatsApp } from "@/components/ShareToWhatsApp";
import { ShareScreenshotToWhatsApp } from "@/components/ShareScreenshotToWhatsApp";
import { getWhatsappShareUrl } from "@/lib/whatsapp";

type SquadFields = { air?: number | null; tank?: number | null; missile?: number | null; fourth?: number | null };
type SquadStats = { topValue: number; topType: string | null; threeSum: number };

function computeSquadStats(fields: SquadFields | null): SquadStats {
  if (!fields) return { topValue: 0, topType: null, threeSum: 0 };
  const entries: [string, number][] = [
    ["Air", fields.air ?? 0],
    ["Tank", fields.tank ?? 0],
    ["Missile", fields.missile ?? 0],
    ["Fourth", fields.fourth ?? 0],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  const topValue = entries[0][1];
  const topType = topValue > 0 ? entries[0][0] : null;
  const threeSum = entries[0][1] + entries[1][1] + entries[2][1];
  return { topValue, topType, threeSum };
}

function formatValue(n: number): string {
  return n.toFixed(1);
}

type Row = {
  name: string;
  thisStats: SquadStats;
  priorStats: SquadStats;
  growth: number | null;
  squadType: string | null;
};

async function getSquadPowerReport(week: number): Promise<{ rows: Row[]; priorWeek: number | null }> {
  const category = await prisma.category.findUnique({ where: { key: "squads" } });
  if (!category) return { rows: [], priorWeek: null };

  const priorWeekRow = await prisma.categoryRecord.findFirst({
    where: { categoryId: category.id, weekNumber: { lt: week } },
    orderBy: { weekNumber: "desc" },
    select: { weekNumber: true },
  });
  const priorWeek = priorWeekRow?.weekNumber ?? null;

  const thisWeekRecords = await prisma.categoryRecord.findMany({
    where: { categoryId: category.id, weekNumber: week },
    include: { member: true },
  });
  const priorWeekRecords =
    priorWeek !== null
      ? await prisma.categoryRecord.findMany({
          where: { categoryId: category.id, weekNumber: priorWeek },
          include: { member: true },
        })
      : [];

  const thisByMember = new Map(thisWeekRecords.map((r) => [r.memberId, r]));
  const priorByMember = new Map(priorWeekRecords.map((r) => [r.memberId, r]));
  const allMemberIds = new Set([...thisByMember.keys(), ...priorByMember.keys()]);

  const rows: Row[] = [];
  for (const memberId of allMemberIds) {
    const thisRecord = thisByMember.get(memberId);
    const priorRecord = priorByMember.get(memberId);
    const name = thisRecord?.member.name ?? priorRecord?.member.name ?? "?";

    const thisStats = computeSquadStats(thisRecord ? JSON.parse(thisRecord.fields) : null);
    const priorStats = computeSquadStats(priorRecord ? JSON.parse(priorRecord.fields) : null);

    let growth: number | null = null;
    if (priorRecord && priorStats.threeSum > 0) {
      growth = ((thisStats.threeSum - priorStats.threeSum) / priorStats.threeSum) * 100;
    }

    rows.push({ name, thisStats, priorStats, growth, squadType: thisStats.topType ?? priorStats.topType });
  }

  rows.sort((a, b) => b.priorStats.threeSum - a.priorStats.threeSum);

  return { rows, priorWeek };
}

function formatShareText(week: number, rows: Row[]): string {
  const lines = [`*Squad Power & Growth - Week ${week}*`, ""];
  if (rows.length === 0) {
    lines.push("None");
  } else {
    for (const r of rows) {
      const growth = r.growth === null ? "—" : `${r.growth.toFixed(2)}%`;
      lines.push(
        `${r.name}: ${formatValue(r.thisStats.threeSum)} (Top: ${r.squadType ?? "—"} ${formatValue(r.thisStats.topValue)}) Growth: ${growth}`
      );
    }
  }
  return lines.join("\n").trim();
}

export default async function SquadPowerPage({ searchParams }: PageProps<"/reports/squad-power">) {
  const params = await searchParams;

  const weeks = await prisma.categoryRecord.findMany({
    where: { category: { key: "squads" } },
    select: { weekNumber: true },
    distinct: ["weekNumber"],
    orderBy: { weekNumber: "desc" },
  });
  const weekNumbers = weeks.map((w) => w.weekNumber);
  const defaultWeek = weekNumbers.length > 0 ? weekNumbers[0] : 1;

  const weekParam = Array.isArray(params.week) ? params.week[0] : params.week;
  const selectedWeek = weekParam ? Number(weekParam) : defaultWeek;

  const { rows, priorWeek } = await getSquadPowerReport(selectedWeek);

  const shareText = formatShareText(selectedWeek, rows);
  const shareUrl = await getWhatsappShareUrl(shareText);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Squad Power &amp; Growth</h1>
      <p className="text-neutral-500 text-sm">
        Top Squad = a member&apos;s highest self-reported troop type. 3 Squad power = the sum of their top 3 of
        4 troop types. Growth compares 3 Squad power to {priorWeek ?? "the previous"} week.
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
          list="squad-power-known-weeks"
          className="border border-neutral-300 rounded px-2 py-1 w-24"
        />
        <datalist id="squad-power-known-weeks">
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
        <ShareScreenshotToWhatsApp targetId="squad-power-content" filename="squad-power.png" title="Squad Power & Growth" />
      </div>

      <ZoomWrapper contentId="squad-power-content">
        {rows.length === 0 ? (
          <p className="text-neutral-500 text-sm">No squad data for week {selectedWeek} yet.</p>
        ) : (
          <div className="overflow-x-auto border border-neutral-200 rounded">
            <table className="text-sm border-collapse w-max">
              <thead>
                <tr className="border-b border-neutral-200 text-left">
                  <th rowSpan={2} className="py-0.5 px-3 align-bottom">
                    Commander
                  </th>
                  <th colSpan={2} className="py-0.5 px-3 text-center border-b border-neutral-200">
                    This Week
                  </th>
                  <th colSpan={2} className="py-0.5 px-3 text-center border-b border-neutral-200">
                    Last Week
                  </th>
                  <th rowSpan={2} className="py-0.5 px-3 align-bottom">
                    Growth
                  </th>
                  <th rowSpan={2} className="py-0.5 px-3 align-bottom whitespace-nowrap">
                    Squad Type
                  </th>
                </tr>
                <tr className="border-b border-neutral-200 text-left">
                  <th className="py-0.5 px-3 whitespace-nowrap">3 Squad power</th>
                  <th className="py-0.5 px-3 whitespace-nowrap">Top Squad</th>
                  <th className="py-0.5 px-3 whitespace-nowrap">3 Squad power</th>
                  <th className="py-0.5 px-3 whitespace-nowrap">Top Squad</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="border-b border-neutral-100">
                    <td className="py-0.5 px-3 font-medium whitespace-nowrap">{r.name}</td>
                    <td className="py-0.5 px-3">{formatValue(r.thisStats.threeSum)}</td>
                    <td className="py-0.5 px-3">{formatValue(r.thisStats.topValue)}</td>
                    <td className="py-0.5 px-3 text-neutral-500">{formatValue(r.priorStats.threeSum)}</td>
                    <td className="py-0.5 px-3 text-neutral-500">{formatValue(r.priorStats.topValue)}</td>
                    <td className={`py-0.5 px-3 ${r.growth !== null && r.growth < 0 ? "text-red-600" : "text-green-700"}`}>
                      {r.growth === null ? "—" : `${r.growth.toFixed(2)}%`}
                    </td>
                    <td className="py-0.5 px-3 whitespace-nowrap">{r.squadType ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ZoomWrapper>
    </div>
  );
}
