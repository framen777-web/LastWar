import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuthApi } from "@/lib/auth/dal";
import { prisma } from "@/lib/db";
import { getConductorStatement, getConductorRank, summarizeStatementByWeek } from "@/lib/conductor/statement";

export async function GET(request: Request) {
  const gate = await requireAuthApi();
  if ("error" in gate) return gate.error;
  const { user } = gate;

  const memberId = Number(new URL(request.url).searchParams.get("member"));
  if (!Number.isInteger(memberId) || memberId < 1) {
    return NextResponse.json({ error: "Invalid member id" }, { status: 400 });
  }

  // Same self-or-elevated-role rule as the page itself.
  const canPickAnyMember = user.role === "ADMIN" || user.role === "LEADER";
  if (!canPickAnyMember && memberId !== user.id) {
    return NextResponse.json({ error: "You can only export your own data." }, { status: 403 });
  }

  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return NextResponse.json({ error: "Member not found." }, { status: 404 });

  const { entries, categories } = await getConductorStatement(memberId);
  const rank = await getConductorRank(memberId);
  const weekRows = summarizeStatementByWeek(entries);

  // One pivoted sheet - each week is a row, each category a column - covers both the
  // Detail view (per-category columns) and the Summary view (Net/Balance) at once, so
  // there's no need to keep two export shapes in sync with the two on-screen views.
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Statement");

  sheet.addRow([`Member: ${member.name}`]);
  sheet.addRow([rank ? `Rank: #${rank.rank} of ${rank.totalMembers} (Total: ${rank.total} pts)` : "Rank: not currently active"]);
  sheet.addRow([]);

  const header = ["Week", ...categories.map((c) => c.name), "Conductor Selected", "Net", "Balance"];
  sheet.addRow(header);
  sheet.getRow(4).font = { bold: true };

  for (const w of weekRows) {
    sheet.addRow([
      w.weekNumber,
      ...categories.map((c) => w.categoryPoints[c.key] ?? 0),
      w.resetPoints > 0 ? -w.resetPoints : 0,
      w.netPoints,
      w.balanceAfter,
    ]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${member.name.replace(/[^a-zA-Z0-9._-]/g, "_")}-conductor-statement.xlsx`;

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
