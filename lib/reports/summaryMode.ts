export type SummaryMode = "sum" | "average" | "max" | "min" | "selected_week";

export const SUMMARY_MODE_LABELS: Record<SummaryMode, string> = {
  sum: "Sum",
  average: "Average",
  max: "Max",
  min: "Min",
  selected_week: "Selected week",
};

/**
 * Collapses a category's per-week values across [fromWeek, toWeek] into one number,
 * per the category's configured summaryMode. `perWeekValue` looks up one week's
 * contribution (the caller decides what "contribution" means - e.g. gain vs raw for
 * cumulative categories).
 */
export function reduceOverRange(
  mode: SummaryMode,
  perWeekValue: (week: number) => number | undefined,
  fromWeek: number,
  toWeek: number
): number | undefined {
  if (mode === "selected_week") return perWeekValue(toWeek);

  let acc: number | undefined;
  let count = 0;
  for (let week = fromWeek; week <= toWeek; week++) {
    const v = perWeekValue(week);
    if (v === undefined) continue;
    count++;
    if (mode === "max") acc = acc === undefined ? v : Math.max(acc, v);
    else if (mode === "min") acc = acc === undefined ? v : Math.min(acc, v);
    else acc = (acc ?? 0) + v; // sum and average both accumulate a running total first
  }
  if (mode === "average") return count > 0 ? acc! / count : undefined;
  return acc; // sum - undefined (not 0) when no week in range had data
}
