import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireRole } from "@/lib/auth/dal";
import { getAllianceDetailData, type DetailRow, type SummaryRow } from "@/lib/dashboards/allianceDetail";

export async function GET(request: Request) {
  await requireRole(["ADMIN", "LEADER"]);

  const { searchParams } = new URL(request.url);
  const fromWeek = Number(searchParams.get("fromWeek"));
  const toWeek = Number(searchParams.get("toWeek"));
  if (!Number.isInteger(fromWeek) || !Number.isInteger(toWeek) || fromWeek < 1 || toWeek < fromWeek) {
    return NextResponse.json({ error: "Invalid week range." }, { status: 400 });
  }
  const commanderParam = searchParams.get("commander");
  const commanderId = commanderParam ? Number(commanderParam) : undefined;
  const rank = searchParams.get("rank") || undefined;
  const mode = searchParams.get("mode") === "summary" ? "summary" : "detail";

  const { categories, detailRows, summaryRows } = await getAllianceDetailData({ fromWeek, toWeek, commanderId, rank });
  const rows: (DetailRow | SummaryRow)[] = mode === "detail" ? detailRows : summaryRows;

  const workbook = new ExcelJS.Workbook();
  const sheetName = mode === "detail" ? "Detail" : "Summary";
  const sheet = workbook.addWorksheet(sheetName);

  const columns: { header: string; key: string; width: number }[] = [
    { header: "Member", key: "member", width: 20 },
    ...(mode === "detail" ? [{ header: "Week", key: "week", width: 8 }] : []),
    { header: "Rank", key: "rank", width: 8 },
    { header: "Air", key: "air", width: 10 },
    { header: "Tank", key: "tank", width: 10 },
    { header: "Missile", key: "missile", width: 10 },
    { header: "Fourth", key: "fourth", width: 10 },
    ...categories.map((c) => ({ header: c.name, key: c.key, width: 14 })),
  ];
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };

  for (const r of rows) {
    const rowData: Record<string, number | string> = { member: r.memberName, rank: r.rankLabel };
    if ("weekNumber" in r) rowData.week = r.weekNumber;
    if (r.squads.air !== undefined) rowData.air = r.squads.air;
    if (r.squads.tank !== undefined) rowData.tank = r.squads.tank;
    if (r.squads.missile !== undefined) rowData.missile = r.squads.missile;
    if (r.squads.fourth !== undefined) rowData.fourth = r.squads.fourth;
    for (const c of categories) {
      const v = r.values[c.key];
      if (v !== undefined) rowData[c.key] = v;
    }
    sheet.addRow(rowData);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `alliance-detail-${mode}-w${fromWeek}-w${toWeek}.xlsx`;

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
