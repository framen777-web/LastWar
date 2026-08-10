import { prisma } from "@/lib/db";
import { ZoomWrapper } from "@/components/ZoomWrapper";
import { ShareToWhatsApp } from "@/components/ShareToWhatsApp";
import { ShareScreenshotToWhatsApp } from "@/components/ShareScreenshotToWhatsApp";
import { getWhatsappShareUrl } from "@/lib/whatsapp";

const NEW_RECORDS_CATEGORIES = [
  { key: "vs", label: "New VS Records", headerClass: "bg-green-300" },
  { key: "desert_storm", label: "New DS Records", headerClass: "bg-pink-300" },
  { key: "donations", label: "New Donation Records", headerClass: "bg-amber-300" },
  { key: "kills", label: "New Kill Records", headerClass: "bg-sky-300" },
];

type RecordRow = { name: string; newValue: number; oldValue: number; increasePct: number };

async function getNewRecords(categoryKey: string, week: number): Promise<RecordRow[]> {
  const stats = await prisma.weeklyStat.findMany({
    where: { categoryKey, weekNumber: { lte: week } },
    include: { member: true },
  });

  const byMember = new Map<number, { name: string; thisWeek?: number; bestBefore?: number }>();
  for (const s of stats) {
    const entry = byMember.get(s.memberId) ?? { name: s.member.name };
    if (s.weekNumber === week) {
      entry.thisWeek = s.value;
    } else {
      entry.bestBefore = Math.max(entry.bestBefore ?? -Infinity, s.value);
    }
    byMember.set(s.memberId, entry);
  }

  const records: RecordRow[] = [];
  for (const entry of byMember.values()) {
    if (
      entry.thisWeek !== undefined &&
      entry.bestBefore !== undefined &&
      entry.bestBefore > 0 &&
      entry.thisWeek > entry.bestBefore
    ) {
      records.push({
        name: entry.name,
        newValue: entry.thisWeek,
        oldValue: entry.bestBefore,
        increasePct: Math.round(((entry.thisWeek - entry.bestBefore) / entry.bestBefore) * 100),
      });
    }
  }

  records.sort((a, b) => b.newValue - a.newValue);
  return records;
}

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString();
}

function formatShareText(week: number, byCategory: { label: string; records: RecordRow[] }[]): string {
  const lines = [`*New Records - Week ${week}*`, ""];
  for (const { label, records } of byCategory) {
    lines.push(`*${label}*`);
    if (records.length === 0) {
      lines.push("None");
    } else {
      for (const r of records) {
        lines.push(`${r.name}: ${formatNumber(r.newValue)} (was ${formatNumber(r.oldValue)}, +${r.increasePct}%)`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export default async function NewRecordsPage({ searchParams }: PageProps<"/reports/new-records">) {
  const params = await searchParams;

  const weeks = await prisma.weeklyStat.findMany({
    select: { weekNumber: true },
    distinct: ["weekNumber"],
    orderBy: { weekNumber: "desc" },
  });
  const weekNumbers = weeks.map((w) => w.weekNumber);
  const defaultWeek = weekNumbers.length > 0 ? weekNumbers[0] : 1;

  const weekParam = Array.isArray(params.week) ? params.week[0] : params.week;
  const selectedWeek = weekParam ? Number(weekParam) : defaultWeek;

  const newRecordsByCategory = await Promise.all(
    NEW_RECORDS_CATEGORIES.map((c) => getNewRecords(c.key, selectedWeek))
  );

  const shareText = formatShareText(
    selectedWeek,
    NEW_RECORDS_CATEGORIES.map((c, i) => ({ label: c.label, records: newRecordsByCategory[i] }))
  );
  const shareUrl = await getWhatsappShareUrl(shareText);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">New Records</h1>
      <p className="text-neutral-500 text-sm">
        Members who beat their own personal best this week, for each category.
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
          list="reports-known-weeks"
          className="border border-neutral-300 rounded px-2 py-1 w-24"
        />
        <datalist id="reports-known-weeks">
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
        <ShareScreenshotToWhatsApp targetId="new-records-content" filename="new-records.png" title="New Records" />
      </div>

      <ZoomWrapper contentId="new-records-content">
        <div className="flex flex-row flex-nowrap items-start gap-4 overflow-x-auto">
          {NEW_RECORDS_CATEGORIES.map((c, i) => {
            const records = newRecordsByCategory[i];
            return (
              <div key={c.key} className="border border-neutral-200 rounded overflow-hidden shrink-0 w-[260px]">
                <div className={`${c.headerClass} px-3 py-1 font-semibold text-center text-neutral-900`}>{c.label}</div>
                {records.length === 0 ? (
                  <p className="text-neutral-500 text-sm p-2">No new records this week.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-neutral-200 text-left">
                          <th className="py-0.5 px-3">Member</th>
                          <th className="py-0.5 px-3">New</th>
                          <th className="py-0.5 px-3">Old</th>
                          <th className="py-0.5 px-3">Increase</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.map((r) => (
                          <tr key={r.name} className="border-b border-neutral-100">
                            <td className="py-0.5 px-3 font-medium whitespace-nowrap">{r.name}</td>
                            <td className="py-0.5 px-3">{formatNumber(r.newValue)}</td>
                            <td className="py-0.5 px-3 text-neutral-500">{formatNumber(r.oldValue)}</td>
                            <td className="py-0.5 px-3 text-green-700">{r.increasePct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ZoomWrapper>
    </div>
  );
}
