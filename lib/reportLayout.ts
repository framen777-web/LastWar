// Shared column widths (px) for the weekly report pages, so every member/name column and
// every numeric value column lines up at the same width across panels and reports - these
// are screenshotted for WhatsApp, so a uniform grid matters more than auto-fit content.
export const REPORT_NAME_COL_WIDTH = 140;
export const REPORT_VALUE_COL_WIDTH = 100;

// Shared "Show" row-limit control, so every report offers the same choice of how many
// rows to render instead of a silent hardcoded cap - matches the pattern from the MVP
// report, which was the first to need this.
export const LIMIT_OPTIONS = [10, 20, 50] as const;

export function parseLimitParam(param: string | string[] | undefined, fallback: string): string {
  const value = Array.isArray(param) ? param[0] : param;
  return value ?? fallback;
}

export function applyLimit<T>(rows: T[], limit: string): T[] {
  return limit === "all" ? rows : rows.slice(0, Number(limit));
}
