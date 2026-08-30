import { prisma } from "@/lib/db";
import { requireMenuAccess } from "@/lib/menuAccess";
import { getConductorStatement, getConductorRankHistory, summarizeStatementByWeek } from "@/lib/conductor/statement";
import { formatStatNumber } from "@/lib/format";
import { ExcelExportButton } from "@/components/ExcelExportButton";

export default async function ConductorStatementPage({ searchParams }: PageProps<"/dashboards/individual/statement">) {
  const user = await requireMenuAccess("individual-conductor-statement");
  const params = await searchParams;

  // Same self-or-elevated-role rule as every other report in this section (see
  // individual/detail/page.tsx) - MEMBER can never view anyone but themselves.
  const canPickAnyMember = user.role === "ADMIN" || user.role === "LEADER";
  const memberParam = Array.isArray(params.member) ? params.member[0] : params.member;
  const selectedMemberId = canPickAnyMember && memberParam ? Number(memberParam) : user.id;

  const viewParam = Array.isArray(params.view) ? params.view[0] : params.view;
  const view = viewParam === "summary" ? "summary" : "detail";

  const allMembers = canPickAnyMember
    ? await prisma.member.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];
  const member = await prisma.member.findUnique({ where: { id: selectedMemberId }, select: { id: true, name: true } });

  const { entries, finalBalance } = await getConductorStatement(selectedMemberId);
  const rankHistory = await getConductorRankHistory(selectedMemberId);
  const currentRank = [...rankHistory.values()].at(-1) ?? null;
  const weekRows = view === "summary" ? summarizeStatementByWeek(entries) : null;

  // Query string helper so the toggle and the member-picker preserve each other - the
  // toggle is plain links rather than form controls, since a MEMBER viewing their own
  // statement has no form on this page at all for it to live inside.
  const linkFor = (v: "detail" | "summary") =>
    `?${new URLSearchParams({ ...(canPickAnyMember ? { member: String(selectedMemberId) } : {}), view: v }).toString()}`;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Conductor Points Statement</h1>
      {currentRank && (
        <p className="text-sm text-neutral-500">
          Currently rank #{currentRank.rank} of {currentRank.totalMembers} ({formatStatNumber(currentRank.balance)} pts)
        </p>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        {canPickAnyMember ? (
          <form className="flex items-center gap-2 text-sm flex-wrap">
            <button type="submit" className="bg-accent text-accent-contrast rounded px-3 py-1">Go</button>
            <label htmlFor="member" className="font-medium">Member</label>
            <select id="member" name="member" defaultValue={selectedMemberId} className="border border-neutral-300 rounded px-2 py-1">
              {allMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </form>
        ) : (
          <p className="text-sm text-neutral-500">{member?.name}</p>
        )}

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-sm">
            <a href={linkFor("detail")} className={`px-2 py-1 rounded ${view === "detail" ? "bg-accent text-accent-contrast" : "border border-neutral-300"}`}>
              Detail
            </a>
            <a href={linkFor("summary")} className={`px-2 py-1 rounded ${view === "summary" ? "bg-accent text-accent-contrast" : "border border-neutral-300"}`}>
              Summary
            </a>
          </div>
          {member && <ExcelExportButton href={`/api/dashboards/individual/statement/export?member=${member.id}`} />}
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-neutral-500 text-sm">No conductor point activity yet for {member?.name}.</p>
      ) : view === "summary" ? (
        <div className="flex flex-col gap-1">
          {weekRows!.map((w) => {
            const r = rankHistory.get(w.weekNumber);
            return (
              <div key={w.weekNumber} className="flex justify-between border-b border-neutral-100 py-1 text-sm">
                <span className="font-medium">Week {w.weekNumber}</span>
                {r && (
                  <span className="text-neutral-400 text-xs">
                    Rank #{r.rank} of {r.totalMembers}
                  </span>
                )}
                <span className={w.netPoints >= 0 ? "text-green-700" : "text-red-700"}>
                  {w.netPoints >= 0 ? "+" : ""}
                  {formatStatNumber(w.netPoints)}
                </span>
                <span className="text-neutral-500">Balance: {formatStatNumber(w.balanceAfter)}</span>
              </div>
            );
          })}
          <div className="flex justify-end font-semibold text-sm pt-2">Final balance: {formatStatNumber(finalBalance)}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry, i) =>
            entry.type === "earn" ? (
              <div key={i} className="border border-neutral-200 rounded p-3">
                <div className="flex justify-between items-baseline">
                  <span className="font-medium">Week {entry.weekNumber}</span>
                  {rankHistory.get(entry.weekNumber) && (
                    <span className="text-xs text-neutral-400">
                      Rank #{rankHistory.get(entry.weekNumber)!.rank} of {rankHistory.get(entry.weekNumber)!.totalMembers}
                    </span>
                  )}
                  <span className="text-green-700">+{formatStatNumber(entry.points)}</span>
                  <span className="text-neutral-500 text-sm">Balance: {formatStatNumber(entry.balanceAfter)}</span>
                </div>
                <ul className="text-sm text-neutral-600 mt-1 pl-4 list-disc">
                  {entry.categories.map((c) => (
                    <li key={c.categoryKey}>
                      {c.categoryName}:{" "}
                      {c.mode === "rate"
                        ? `${formatStatNumber(c.rawValue)} ÷ ${c.unitSize} × ${c.pointsPerUnit} = ${formatStatNumber(c.points)}`
                        : `flat ${formatStatNumber(c.points)} (present this week)`}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div key={i} className="border border-amber-300 bg-amber-50 rounded p-3">
                <div className="flex justify-between items-baseline">
                  <span className="font-medium">Selected as Conductor - round starting week {entry.roundStartWeek}</span>
                  <span className="text-red-700">-{formatStatNumber(entry.points)}</span>
                  <span className="text-neutral-500 text-sm">Balance: {formatStatNumber(entry.balanceAfter)}</span>
                </div>
              </div>
            )
          )}
          <div className="flex justify-end font-semibold text-sm pt-2">
            Final balance: {formatStatNumber(finalBalance)}
          </div>
        </div>
      )}
    </div>
  );
}
