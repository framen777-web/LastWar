import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireRole } from "@/lib/auth/dal";
import { getSeasonReportData } from "@/lib/season/report";

export async function GET(request: Request) {
  await requireRole(["ADMIN", "LEADER"]);

  const { searchParams } = new URL(request.url);
  const seasonId = Number(searchParams.get("seasonId"));
  if (!Number.isInteger(seasonId)) return NextResponse.json({ error: "Invalid seasonId." }, { status: 400 });

  const data = await getSeasonReportData(seasonId);
  if (!data) return NextResponse.json({ error: "Season not found." }, { status: 404 });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Season Report");

  const columns: { header: string; key: string; width: number }[] = [
    { header: "Rank", key: "rank", width: 8 },
    { header: "Commander", key: "member", width: 20 },
    ...data.categories.map((c) => ({ header: c.name, key: `cat_${c.key}`, width: 14 })),
    ...data.extraItems.map((i) => ({ header: i.name, key: `extra_${i.key}`, width: 14 })),
    { header: "Season Points", key: "seasonPoints", width: 14 },
    { header: "Band", key: "band", width: 8 },
    { header: "Boxes", key: "boxes", width: 8 },
  ];
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };

  for (const r of data.rows) {
    const rowData: Record<string, number | string> = {
      rank: r.rank,
      member: r.memberName,
      seasonPoints: r.seasonPoints,
      band: r.bandOrder ?? "—",
      boxes: r.boxesAwarded,
    };
    for (const c of data.categories) rowData[`cat_${c.key}`] = r.categoryPoints[c.key] ?? 0;
    for (const i of data.extraItems) rowData[`extra_${i.key}`] = r.extraPoints[i.key] ?? 0;
    sheet.addRow(rowData);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `season-report-${data.season.name.replace(/[^a-z0-9]+/gi, "_")}.xlsx`;

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
