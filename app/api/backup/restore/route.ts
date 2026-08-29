import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireAdminApi } from "@/lib/auth/dal";
import { BACKUP_TABLES, getSchemaFingerprint, getTableColumns } from "@/lib/backup/schemaFingerprint";

type PrismaModelClient = {
  deleteMany: () => Prisma.PrismaPromise<unknown>;
  createMany: (args: { data: unknown[] }) => Prisma.PrismaPromise<unknown>;
};

type BackupPayload = {
  meta?: { schemaFingerprint?: string; appVersion?: string };
  data?: Record<string, unknown[]>;
};

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { backup?: BackupPayload; force?: boolean };
  const backup = body.backup;
  if (!backup?.meta || !backup?.data) {
    return NextResponse.json({ error: "This doesn't look like a backup file." }, { status: 400 });
  }

  const currentFingerprint = await getSchemaFingerprint();
  const matches = backup.meta.schemaFingerprint === currentFingerprint;
  if (!matches && !body.force) {
    return NextResponse.json(
      {
        error: "schema_mismatch",
        message: `This backup was taken from app version ${backup.meta.appVersion ?? "unknown"}, and the database structure has changed since then. Restoring may drop fields that no longer exist or leave new required fields empty. Confirm to restore anyway.`,
      },
      { status: 409 }
    );
  }

  // Known-current columns per table, used to silently drop columns the backup has that the live
  // schema no longer does - protects a forced cross-version restore from crashing on an unknown
  // column rather than failing in a confusing way.
  const columnsByModel = await getTableColumns();
  function sanitizeRow(model: string, row: Record<string, unknown>): Record<string, unknown> {
    const known = columnsByModel.get(model);
    if (!known) return row;
    return Object.fromEntries(Object.entries(row).filter(([key]) => known.has(key)));
  }

  const client = prisma as unknown as Record<string, PrismaModelClient>;

  const deletes = [...BACKUP_TABLES].reverse().map((table) => client[table.prop].deleteMany());
  const creates = BACKUP_TABLES.flatMap((table) => {
    const rows = (backup.data![table.prop] ?? []).map((row) => sanitizeRow(table.model, row as Record<string, unknown>));
    return rows.length > 0 ? [client[table.prop].createMany({ data: rows })] : [];
  });
  // A restored table's autoincrement sequence otherwise stays wherever it was before the wipe -
  // any row the app creates afterward through the normal (no explicit id) path would collide
  // with a restored id once the sequence falls behind the data it now holds. Advance each
  // sequence to match what was actually restored, same technique used for the Render->Neon data
  // migration. Table names come from BACKUP_TABLES, not request input, so building this SQL by
  // interpolation is safe.
  const sequenceResets = BACKUP_TABLES.filter((t) => t.hasSequence).map((table) =>
    prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${table.model}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table.model}"), 1), (SELECT COUNT(*) FROM "${table.model}") > 0)`
    )
  );

  try {
    // Prisma's default interactive-transaction timeout is 5s - nowhere near enough for a
    // 19-table wipe+restore (confirmed by testing: it timed out on a database with only one row
    // per table). A full restore of a real dataset needs much more headroom.
    await prisma.$transaction([...deletes, ...creates, ...sequenceResets], { timeout: 300_000, maxWait: 30_000 });
  } catch (err) {
    return NextResponse.json(
      { error: "restore_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, tablesRestored: BACKUP_TABLES.length });
}
