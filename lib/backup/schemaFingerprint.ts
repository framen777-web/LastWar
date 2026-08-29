import { prisma } from "@/lib/db";

// Every table Backup/Restore touches, in dependency order (parents before children, so a
// restore's inserts satisfy foreign keys as it goes - Member/Category/etc. have no FK
// dependencies of their own, WeeklyStat/CategoryRecord/etc. depend only on those, and
// SeasonExtraValue depends on SeasonExtraItem which is itself one of the middle tier). `model` is
// the Postgres table name (== the Prisma schema's model name, unmapped); `prop` is the matching
// camelCase property on the Prisma client (prisma.<prop>.findMany() etc.); `hasSequence` marks
// the 16 of 19 tables with an autoincrement `id` - the 3 without (Setting.key, MenuItem.key,
// R1WeekSettings.weekNumber) use natural keys and have no sequence to reset after a restore.
export const BACKUP_TABLES = [
  { model: "Member", prop: "member", hasSequence: true },
  { model: "Category", prop: "category", hasSequence: true },
  { model: "Setting", prop: "setting", hasSequence: false },
  { model: "MenuItem", prop: "menuItem", hasSequence: false },
  { model: "ConductorRound", prop: "conductorRound", hasSequence: true },
  { model: "Season", prop: "season", hasSequence: true },
  { model: "R1WeekSettings", prop: "r1WeekSettings", hasSequence: false },
  { model: "RawExtraction", prop: "rawExtraction", hasSequence: true },
  { model: "WeeklyStat", prop: "weeklyStat", hasSequence: true },
  { model: "CategoryRecord", prop: "categoryRecord", hasSequence: true },
  { model: "Suggestion", prop: "suggestion", hasSequence: true },
  { model: "ConductorSelection", prop: "conductorSelection", hasSequence: true },
  { model: "SeasonExtraItem", prop: "seasonExtraItem", hasSequence: true },
  { model: "SeasonCategoryPoints", prop: "seasonCategoryPoints", hasSequence: true },
  { model: "SeasonCategoryWeight", prop: "seasonCategoryWeight", hasSequence: true },
  { model: "SeasonBand", prop: "seasonBand", hasSequence: true },
  { model: "RawSeasonExtraction", prop: "rawSeasonExtraction", hasSequence: true },
  { model: "SeasonResult", prop: "seasonResult", hasSequence: true },
  { model: "SeasonExtraValue", prop: "seasonExtraValue", hasSequence: true },
] as const;

type ColumnRow = { table_name: string; column_name: string; data_type: string; is_nullable: "YES" | "NO" };

/**
 * Live column shape (name/type/nullability) for every backed-up table, read straight from
 * Postgres's own catalog rather than the Prisma schema file. This project has no migrations
 * folder - schema changes go live via `prisma db push` directly - so the database itself, not a
 * hand-tracked file, is the actual source of truth for "what shape is this database right now."
 */
export async function getTableColumns(): Promise<Map<string, Map<string, ColumnRow>>> {
  const tableNames = BACKUP_TABLES.map((t) => t.model);
  const rows = await prisma.$queryRaw<ColumnRow[]>`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY(${tableNames})
  `;
  const byTable = new Map<string, Map<string, ColumnRow>>();
  for (const row of rows) {
    if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Map());
    byTable.get(row.table_name)!.set(row.column_name, row);
  }
  return byTable;
}

/**
 * A structural summary of every backed-up table's columns, used at restore time to decide
 * whether a backup was taken against the exact same database shape as the schema currently
 * running. Not a hand-maintained version number - it's derived from the live schema itself, so
 * it can't drift out of sync the way lib/version.ts's MAJOR.MINOR already has once.
 */
export async function getSchemaFingerprint(): Promise<string> {
  const byTable = await getTableColumns();
  return [...byTable.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([table, cols]) =>
        `${table}:${[...cols.values()]
          .map((c) => `${c.column_name}:${c.data_type}${c.is_nullable === "NO" ? "!" : "?"}`)
          .sort()
          .join(",")}`
    )
    .join("|");
}
