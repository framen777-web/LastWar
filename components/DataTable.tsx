"use client";

import { useMemo, useState } from "react";
import { formatStatNumber } from "@/lib/format";

export type DataTableColumn = {
  key: string;
  header: React.ReactNode;
  /** Second header row under this column, e.g. MVP's per-column weight values. */
  subHeader?: React.ReactNode;
  align?: "left" | "right" | "center";
  /**
   * "text" sorts as a string and shows a filter box; "number" sorts numerically with no
   * filter box; omit for columns with no sort/filter UI (badges, action cells, deltas).
   */
  filter?: "text" | "number";
  /** Fixed column width in px. If any column sets this, the whole table switches to a fixed layout. */
  width?: number;
  /** Pins this column to the left edge of the scroll container on horizontal scroll - for
   * a "Member" column on a wide table, so the name stays visible while scanning categories.
   * Assumes it's the first column and `showRowNumbers` is off; only one column should set this. */
  sticky?: boolean;
};

export type DataTableRow = {
  id: string | number;
  cells: Record<string, React.ReactNode>;
  /** Raw values sort/filter operate on - required for any column with `filter` set. */
  sortValues?: Record<string, number | string>;
};

type SortState = { key: string; direction: "asc" | "desc" };
type FilterState = Record<string, { text?: string }>;

const ALIGN_CLASS: Record<"left" | "right" | "center", string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

function compareValues(a: string | number | undefined, b: string | number | undefined, kind: "text" | "number"): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  if (kind === "number") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

export function DataTable({
  columns,
  rows,
  defaultSort,
  showRowNumbers,
  footer,
  dense,
  fitContent,
  textSizeClass = "text-sm",
}: {
  columns: DataTableColumn[];
  rows: DataTableRow[];
  defaultSort?: SortState;
  showRowNumbers?: boolean;
  footer?: { label: string; sumKeys: string[] };
  dense?: boolean;
  /** Render unclipped at natural size instead of the default scrolling box - for reports meant to be screenshotted whole. */
  fitContent?: boolean;
  /** Tailwind font-size class for the table body/header text. Defaults to text-sm. */
  textSizeClass?: string;
}) {
  const [sort, setSort] = useState<SortState | undefined>(defaultSort);
  const [filters, setFilters] = useState<FilterState>({});

  const hasActiveFilter = Object.values(filters).some((f) => f?.text);

  const visibleRows = useMemo(() => {
    let result = rows;

    for (const col of columns) {
      const f = filters[col.key];
      if (col.filter !== "text" || !f?.text) continue;
      const needle = f.text.toLowerCase();
      result = result.filter((r) => String(r.sortValues?.[col.key] ?? "").toLowerCase().includes(needle));
    }

    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const kind = col?.filter === "text" ? "text" : "number";
      result = [...result].sort((a, b) => {
        const cmp = compareValues(a.sortValues?.[sort.key], b.sortValues?.[sort.key], kind);
        return sort.direction === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [rows, columns, filters, sort]);

  const footerSums = useMemo(() => {
    if (!footer) return null;
    const sums: Record<string, number> = {};
    for (const key of footer.sumKeys) {
      sums[key] = visibleRows.reduce((sum, r) => sum + (Number(r.sortValues?.[key]) || 0), 0);
    }
    return sums;
  }, [footer, visibleRows]);

  function toggleSort(col: DataTableColumn) {
    if (!col.filter) return;
    setSort((prev) => {
      if (!prev || prev.key !== col.key) return { key: col.key, direction: "asc" };
      return { key: col.key, direction: prev.direction === "asc" ? "desc" : "asc" };
    });
  }

  function setTextFilter(key: string, text: string) {
    setFilters((prev) => ({ ...prev, [key]: { ...prev[key], text } }));
  }

  const cellPad = dense ? "py-0.5 px-3" : "py-1.5 px-3";
  const hasSubHeader = columns.some((c) => c.subHeader !== undefined);
  const hasFixedWidths = columns.some((c) => c.width !== undefined);
  // Fixed-width columns wrap their header text instead of clipping it (a narrow column
  // can't afford a long header on one line) but still truncate body cells with an ellipsis
  // (so one long name can't blow the column out and break the uniform width).
  const headerWidthClass = (col: DataTableColumn) => (col.width !== undefined ? "whitespace-normal break-words" : "");
  const cellWidthClass = (col: DataTableColumn) => (col.width !== undefined ? "whitespace-nowrap overflow-hidden text-ellipsis" : "");
  // Needs its own opaque background - once pinned, other cells in the same row scroll
  // underneath it and would otherwise show through.
  const stickyHeaderClass = (col: DataTableColumn) => (col.sticky ? "sticky left-0 z-20 bg-surface-raised" : "");
  const stickyCellClass = (col: DataTableColumn) => (col.sticky ? "sticky left-0 z-10 bg-surface-raised" : "");

  return (
    <div className="flex flex-col gap-2">
      {!fitContent && hasActiveFilter && (
        <button
          onClick={() => setFilters({})}
          className="self-start text-xs text-accent underline decoration-dotted"
        >
          Clear filters
        </button>
      )}
      {/* fitContent (report/screenshot pages) renders unclipped at natural size - nothing
          scrolls, so there's no sticky-positioning ancestor and no bounded scroll box.
          Otherwise: the table is its own bounded, independently-scrolling region (both
          axes) instead of an unbounded `overflow-x-auto` block - that had two problems:
          the horizontal scrollbar only became reachable after scrolling all the way down
          the page past every row, and per the CSS overflow spec, setting only overflow-x
          forces overflow-y's *computed* value to auto too, which silently made this div
          (which never actually grows tall enough to scroll) the "nearest scrolling
          ancestor" for `position: sticky` - so the header was sticking to a container that
          never scrolled, instead of the page, and never visibly stayed pinned. Bounding the
          height here makes this div the real vertical scroll container, so sticky actually
          has something to stick within. */}
      <div className={fitContent ? "border border-neutral-200 rounded" : "overflow-auto max-h-[70vh] border border-neutral-200 rounded"}>
        {/* table-fixed relies on an auto (not w-full) table width so the colgroup's px
            widths become the table's actual size, not just column proportions within
            whatever width the flex/grid parent happens to hand it. */}
        <table className={`${textSizeClass} border-collapse ${hasFixedWidths ? "table-fixed" : "w-full whitespace-nowrap"}`}>
          {hasFixedWidths && (
            <colgroup>
              {showRowNumbers && <col style={{ width: 28 }} />}
              {columns.map((col) => (
                <col key={col.key} style={col.width !== undefined ? { width: col.width } : undefined} />
              ))}
            </colgroup>
          )}
          <thead className={fitContent ? "bg-surface-raised" : "sticky top-0 z-[1] bg-surface-raised"}>
            <tr className="border-b border-neutral-200 text-left">
              {showRowNumbers && <th className={cellPad}></th>}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`${cellPad} ${ALIGN_CLASS[col.align ?? "left"]} ${headerWidthClass(col)} ${stickyHeaderClass(col)} ${col.filter ? "cursor-pointer select-none" : ""}`}
                  onClick={() => toggleSort(col)}
                >
                  {col.header}
                  {sort?.key === col.key && <span className="text-neutral-400 ml-1">{sort.direction === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
            {hasSubHeader && (
              <tr className="border-b border-neutral-200 text-left text-neutral-400 text-xs">
                {showRowNumbers && <th className={cellPad}></th>}
                {columns.map((col) => (
                  <th key={col.key} className={`${cellPad} ${headerWidthClass(col)} ${stickyHeaderClass(col)}`}>
                    {col.subHeader}
                  </th>
                ))}
              </tr>
            )}
            {/* Report tables (fitContent) are meant to be screenshotted whole - filter
                inputs are per-viewer interactive state that doesn't belong in a shared
                static report, and skipping the row buys back a bit of vertical space. */}
            {!fitContent && (
              <tr className="border-b border-neutral-200">
                {showRowNumbers && <td className={cellPad}></td>}
                {columns.map((col) => (
                  <td key={col.key} className={`${cellPad} ${stickyHeaderClass(col)}`}>
                    {col.filter === "text" && (
                      <input
                        type="text"
                        value={filters[col.key]?.text ?? ""}
                        onChange={(e) => setTextFilter(col.key, e.target.value)}
                        placeholder="Filter…"
                        className="border border-neutral-300 rounded px-1.5 py-0.5 text-xs w-24 font-normal"
                      />
                    )}
                  </td>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td className={`${cellPad} text-neutral-500`} colSpan={columns.length + (showRowNumbers ? 1 : 0)}>
                  No rows match the current filters.
                </td>
              </tr>
            ) : (
              visibleRows.map((row, i) => (
                <tr key={row.id} className="border-b border-neutral-100">
                  {showRowNumbers && <td className={`${cellPad} text-neutral-500`}>{i + 1}</td>}
                  {columns.map((col) => (
                    <td key={col.key} className={`${cellPad} ${ALIGN_CLASS[col.align ?? "left"]} ${cellWidthClass(col)} ${stickyCellClass(col)}`}>
                      {row.cells[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
            {footerSums && (
              <tr className="font-semibold">
                {showRowNumbers && <td className={cellPad}></td>}
                {columns.map((col, i) => (
                  <td key={col.key} className={`${cellPad} ${cellWidthClass(col)} ${stickyCellClass(col)}`}>
                    {i === 0 ? footer!.label : footer!.sumKeys.includes(col.key) ? formatStatNumber(footerSums[col.key]) : ""}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
