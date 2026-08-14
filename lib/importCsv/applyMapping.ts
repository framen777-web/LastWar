import { parseCsvNumber } from "./parseCsv";
import type { ImportMapping, MappedRow } from "./types";

/** Applies a column mapping to parsed CSV rows: divisor math, week-range filter, blank handling. */
export function applyMapping(headers: string[], rows: string[][], mapping: ImportMapping): MappedRow[] {
  const columnIndex = new Map(headers.map((h, i) => [h, i]));
  const memberIdx = columnIndex.get(mapping.memberColumn);
  const weekIdx = columnIndex.get(mapping.weekColumn);
  if (memberIdx === undefined || weekIdx === undefined) return [];

  const allianceRankIdx = mapping.allianceRankColumn !== undefined ? columnIndex.get(mapping.allianceRankColumn) : undefined;

  const squadsIdx = mapping.squadsMapping
    ? {
        air: mapping.squadsMapping.air !== undefined ? columnIndex.get(mapping.squadsMapping.air) : undefined,
        tank: mapping.squadsMapping.tank !== undefined ? columnIndex.get(mapping.squadsMapping.tank) : undefined,
        missile:
          mapping.squadsMapping.missile !== undefined ? columnIndex.get(mapping.squadsMapping.missile) : undefined,
        fourth:
          mapping.squadsMapping.fourth !== undefined ? columnIndex.get(mapping.squadsMapping.fourth) : undefined,
      }
    : null;

  const mappedRows: MappedRow[] = [];

  for (const row of rows) {
    const memberName = row[memberIdx]?.trim();
    const weekNumber = parseCsvNumber(row[weekIdx]);
    if (!memberName || weekNumber === null || !Number.isInteger(weekNumber)) continue;
    if (mapping.weekFrom !== undefined && weekNumber < mapping.weekFrom) continue;
    if (mapping.weekTo !== undefined && weekNumber > mapping.weekTo) continue;

    const categoryValues: { categoryKey: string; value: number }[] = [];
    for (const cm of [...mapping.categoryMappings, ...mapping.customFields.map((c) => ({ ...c }))]) {
      const idx = columnIndex.get(cm.column);
      if (idx === undefined) continue;
      const raw = parseCsvNumber(row[idx]);
      if (raw === null) continue;
      const divisor = cm.divisor || 1;
      categoryValues.push({ categoryKey: cm.categoryKey, value: raw / divisor });
    }

    let squadsFields: MappedRow["squadsFields"] = null;
    if (squadsIdx) {
      const air = squadsIdx.air !== undefined ? parseCsvNumber(row[squadsIdx.air]) : null;
      const tank = squadsIdx.tank !== undefined ? parseCsvNumber(row[squadsIdx.tank]) : null;
      const missile = squadsIdx.missile !== undefined ? parseCsvNumber(row[squadsIdx.missile]) : null;
      const fourth = squadsIdx.fourth !== undefined ? parseCsvNumber(row[squadsIdx.fourth]) : null;
      if (air !== null || tank !== null || missile !== null || fourth !== null) {
        squadsFields = { air, tank, missile, fourth };
      }
    }

    let allianceRank: string | null = null;
    if (allianceRankIdx !== undefined) {
      const rankNumber = parseCsvNumber(row[allianceRankIdx]);
      if (rankNumber !== null && Number.isInteger(rankNumber) && rankNumber > 0) {
        allianceRank = `R${rankNumber}`;
        // Tracked per week like any other mapped field (same WeeklyStat categoryKey the
        // screenshot pipeline uses, see recordAllianceRank in lib/pipeline/run.ts) - not
        // just as a "current" snapshot.
        categoryValues.push({ categoryKey: "alliance_rank", value: rankNumber });
      }
    }

    mappedRows.push({ memberName, weekNumber, categoryValues, squadsFields, allianceRank });
  }

  return mappedRows;
}
