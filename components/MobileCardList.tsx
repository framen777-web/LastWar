import type { DataTableColumn, DataTableRow } from "./DataTable";

// Mobile companion to DataTable - takes the exact same columns/rows a page already built
// for the desktop table, so there's no separate data-shaping logic to keep in sync. No
// sort/filter UI here (that's a desktop-table feature); this is a plain scan-down list.
export function MobileCardList({
  columns,
  rows,
  titleKey,
  actionsKey,
}: {
  columns: DataTableColumn[];
  rows: DataTableRow[];
  /** Column key whose cell renders as each card's title (e.g. member name). */
  titleKey: string;
  /** Column key whose cell renders as a small action cluster next to the title, if present in that row. */
  actionsKey?: string;
}) {
  const detailColumns = columns.filter((c) => c.key !== titleKey && c.key !== actionsKey);

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.id} className="border border-neutral-200 rounded-lg bg-surface-raised p-4">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="font-medium text-base">{row.cells[titleKey]}</div>
            {actionsKey && row.cells[actionsKey] && <div>{row.cells[actionsKey]}</div>}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {detailColumns.map((col) => (
              <div key={col.key} className="flex flex-col min-w-0">
                <span className="text-xs text-neutral-500 truncate">{col.header}</span>
                <span className="truncate">{row.cells[col.key]}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
