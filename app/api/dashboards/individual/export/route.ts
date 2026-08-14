import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuthApi } from "@/lib/auth/dal";
import { getMemberGrowthData } from "@/lib/dashboards/individualGrowth";

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

  const { member, categories, rows } = await getMemberGrowthData(memberId);
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const workbook = new ExcelJS.Workbook();
  // Excel sheet names can't contain / \ ? * [ ] : and are capped at 31 chars.
  const sheet = workbook.addWorksheet(member.name.replace(/[/\\?*[\]:]/g, "_").slice(0, 31) || "Growth");

  const columns: { header: string; key: string; width: number }[] = [{ header: "Week", key: "week", width: 8 }];
  for (const c of categories) {
    columns.push({ header: c.name, key: c.key, width: 16 });
    if (c.cumulative) columns.push({ header: `${c.name} (gain)`, key: `${c.key}__gain`, width: 16 });
  }
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };

  for (const r of [...rows].reverse()) {
    const rowData: Record<string, number | string> = { week: r.week };
    for (const c of categories) {
      if (r.values[c.key] !== undefined) rowData[c.key] = r.values[c.key]!;
      if (c.cumulative && r.gains[c.key] !== undefined) rowData[`${c.key}__gain`] = r.gains[c.key]!;
    }
    sheet.addRow(rowData);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${member.name.replace(/[^a-zA-Z0-9._-]/g, "_")}-growth.xlsx`;

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
