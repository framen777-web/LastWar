import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

// Unlike Backup, this is for a human to read in Excel/Sheets, not to re-import into this app - so
// it's scoped to the tables actually meaningful to look at, skipping pure app-plumbing: Setting
// (config/secrets, not data), MenuItem (nav config, not data), RawExtraction/RawSeasonExtraction
// (transient AI-pipeline scratch data, meaningless once committed or dismissed), and
// R1WeekSettings (report UI state, not alliance data).
const SHEETS: { name: string; query: () => Promise<Record<string, unknown>[]> }[] = [
  { name: "Members", query: () => prisma.member.findMany() },
  { name: "Categories", query: () => prisma.category.findMany() },
  { name: "WeeklyStats", query: () => prisma.weeklyStat.findMany({ include: { member: { select: { name: true } } } }) },
  {
    name: "CategoryRecords",
    query: () =>
      prisma.categoryRecord.findMany({ include: { member: { select: { name: true } }, category: { select: { name: true } } } }),
  },
  { name: "Suggestions", query: () => prisma.suggestion.findMany({ include: { member: { select: { name: true } } } }) },
  {
    name: "ConductorSelections",
    query: () => prisma.conductorSelection.findMany({ include: { member: { select: { name: true } } } }),
  },
  { name: "Seasons", query: () => prisma.season.findMany() },
  { name: "SeasonResults", query: () => prisma.seasonResult.findMany({ include: { member: { select: { name: true } } } }) },
  {
    name: "SeasonExtraValues",
    query: () =>
      prisma.seasonExtraValue.findMany({ include: { member: { select: { name: true } }, item: { select: { name: true } } } }),
  },
];

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const workbook = new ExcelJS.Workbook();
  for (const { name, query } of SHEETS) {
    const rows = await query();
    const sheet = workbook.addWorksheet(name);
    if (rows.length === 0) continue;
    const columns = Object.keys(flatten(rows[0])).map((key) => ({ header: key, key, width: 16 }));
    sheet.columns = columns;
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) sheet.addRow(flatten(row));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="alliance-stats-export-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}

// Prisma's included relations (e.g. `member: { name: "..." }`) come back nested - flatten one
// level so each becomes its own readable column ("member.name") instead of "[object Object]".
function flatten(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        out[`${key}.${nestedKey}`] = nestedValue;
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}
