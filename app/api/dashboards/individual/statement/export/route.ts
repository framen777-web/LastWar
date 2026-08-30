import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuthApi } from "@/lib/auth/dal";
import { prisma } from "@/lib/db";
import { getConductorStatement } from "@/lib/conductor/statement";

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

  const { entries, finalBalance } = await getConductorStatement(memberId);

  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet("Statement");
  summary.columns = [
    { header: "Week", key: "week", width: 8 },
    { header: "Event", key: "event", width: 36 },
    { header: "Points", key: "points", width: 12 },
    { header: "Balance", key: "balance", width: 12 },
  ];
  summary.getRow(1).font = { bold: true };
  for (const e of entries) {
    summary.addRow({
      week: e.weekNumber,
      event: e.type === "earn" ? "Earned" : `Selected as Conductor (round week ${e.roundStartWeek})`,
      points: e.type === "earn" ? e.points : -e.points,
      balance: e.balanceAfter,
    });
  }
  summary.addRow({ event: "Final balance", balance: finalBalance });

  const detail = workbook.addWorksheet("Category Detail");
  detail.columns = [
    { header: "Week", key: "week", width: 8 },
    { header: "Category", key: "category", width: 20 },
    { header: "Raw Value", key: "rawValue", width: 12 },
    { header: "Mode", key: "mode", width: 10 },
    { header: "Formula", key: "formula", width: 28 },
    { header: "Points", key: "points", width: 12 },
  ];
  detail.getRow(1).font = { bold: true };
  for (const e of entries) {
    if (e.type !== "earn") continue;
    for (const c of e.categories) {
      detail.addRow({
        week: e.weekNumber,
        category: c.categoryName,
        rawValue: c.rawValue,
        mode: c.mode,
        formula: c.mode === "rate" ? `${c.rawValue} / ${c.unitSize} * ${c.pointsPerUnit}` : `flat ${c.flatValue}`,
        points: c.points,
      });
    }
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
