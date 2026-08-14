import { parseCsvNumber } from "@/lib/importCsv/parseCsv";
import type { ConductorHistoryMapping, MappedHistoryRow } from "./types";

/**
 * Applies a column mapping to parsed CSV rows for historical Conductor/Passenger data.
 * There's no reliable day-of-week column in spreadsheet history, so rows are assigned to
 * slots in the order they appear for each week (1st row of the week -> slot 0/Monday,
 * 2nd -> slot 1/Tuesday, etc.) - a best-effort placement for display only, since points
 * and resets are the same regardless of which day they're attributed to within the week.
 */
export function applyMapping(
  headers: string[],
  rows: string[][],
  mapping: ConductorHistoryMapping
): (MappedHistoryRow & { slotIndex: number })[] {
  const columnIndex = new Map(headers.map((h, i) => [h, i]));
  const weekIdx = columnIndex.get(mapping.weekColumn);
  const conductorIdx = columnIndex.get(mapping.conductorNameColumn);
  const pointsIdx = columnIndex.get(mapping.pointsColumn);
  const passengerIdx = mapping.passengerNameColumn !== undefined ? columnIndex.get(mapping.passengerNameColumn) : undefined;
  if (weekIdx === undefined || conductorIdx === undefined || pointsIdx === undefined) return [];

  const slotCounters = new Map<number, number>();
  const mappedRows: (MappedHistoryRow & { slotIndex: number })[] = [];

  for (const row of rows) {
    const weekNumber = parseCsvNumber(row[weekIdx]);
    const conductorName = row[conductorIdx]?.trim();
    const points = parseCsvNumber(row[pointsIdx]);
    if (weekNumber === null || !Number.isInteger(weekNumber) || !conductorName || points === null) continue;
    if (mapping.weekFrom !== undefined && weekNumber < mapping.weekFrom) continue;
    if (mapping.weekTo !== undefined && weekNumber > mapping.weekTo) continue;

    const passengerName = passengerIdx !== undefined ? (row[passengerIdx]?.trim() ?? "") || null : null;

    const slotIndex = slotCounters.get(weekNumber) ?? 0;
    slotCounters.set(weekNumber, slotIndex + 1);

    mappedRows.push({ weekNumber, conductorName, points, passengerName, slotIndex });
  }

  return mappedRows;
}
