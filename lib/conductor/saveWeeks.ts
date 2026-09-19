import { prisma } from "@/lib/db";

export type SaveWeekConfig = { capValues: Record<string, number> };

export type SaveWeekRow = {
  id: number;
  weekNumber: number;
  endDate: string; // ISO date, e.g. "2026-09-21"
  active: boolean;
  capValues: Record<string, number>;
};

function toRow(row: { id: number; weekNumber: number; endDate: Date; active: boolean; capValues: string }): SaveWeekRow {
  return {
    id: row.id,
    weekNumber: row.weekNumber,
    endDate: row.endDate.toISOString().slice(0, 10),
    active: row.active,
    capValues: JSON.parse(row.capValues),
  };
}

export async function listSaveWeeks(): Promise<SaveWeekRow[]> {
  const rows = await prisma.saveWeek.findMany({ orderBy: { weekNumber: "asc" } });
  return rows.map(toRow);
}

// Only ACTIVE Save Weeks affect points - an inactive one is kept around (not deleted) so its
// cap values aren't lost if it's ever re-toggled on, but is invisible to every points
// calculation until then. Callers that need per-week config (lib/conductor/points.ts) fetch
// this once per calculation run rather than querying per member/week.
export async function getActiveSaveWeeksMap(): Promise<Map<number, SaveWeekConfig>> {
  const rows = await prisma.saveWeek.findMany({ where: { active: true } });
  const map = new Map<number, SaveWeekConfig>();
  for (const row of rows) {
    map.set(row.weekNumber, { capValues: JSON.parse(row.capValues) });
  }
  return map;
}

type SaveWeekInput = { weekNumber: number; endDate: string; active: boolean; capValues: Record<string, number> };

export async function createSaveWeek(data: SaveWeekInput): Promise<SaveWeekRow> {
  const row = await prisma.saveWeek.create({
    data: { weekNumber: data.weekNumber, endDate: new Date(data.endDate), active: data.active, capValues: JSON.stringify(data.capValues) },
  });
  return toRow(row);
}

export async function updateSaveWeek(id: number, data: SaveWeekInput): Promise<SaveWeekRow> {
  const row = await prisma.saveWeek.update({
    where: { id },
    data: { weekNumber: data.weekNumber, endDate: new Date(data.endDate), active: data.active, capValues: JSON.stringify(data.capValues) },
  });
  return toRow(row);
}

export async function deleteSaveWeek(id: number): Promise<void> {
  await prisma.saveWeek.delete({ where: { id } });
}
