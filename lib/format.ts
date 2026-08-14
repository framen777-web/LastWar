// Shared number formatting for stat tables: values >=1000 show as thousands-grouped
// integers ("#,##0"), values <1000 show with 2 decimals ("##0.00") - safe to import from
// both server components (building table cells) and client components (DataTable footers).
//
// formatStatNumber() decides the rule per VALUE - fine for one-off numbers (e.g. WhatsApp
// share-text messages), but wrong inside a table column, where every row must use the same
// rule or the column looks inconsistent (some rows grouped, others decimal). For a column,
// call pickNumberFormat() once across all of that column's values, then formatWithRule()
// per cell with the result.
export type NumberFormatRule = "grouped" | "decimal";

export function pickNumberFormat(values: (number | null | undefined)[]): NumberFormatRule {
  const hasLarge = values.some((v) => v !== null && v !== undefined && Number.isFinite(v) && Math.abs(v) >= 1000);
  return hasLarge ? "grouped" : "decimal";
}

export function formatWithRule(n: number | null | undefined, rule: NumberFormatRule): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return rule === "grouped"
    ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatStatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
