import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { BACKUP_TABLES, getSchemaFingerprint } from "@/lib/backup/schemaFingerprint";
import { APP_VERSION } from "@/lib/version";

type PrismaModelClient = { findMany: () => Promise<unknown[]> };

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const data: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) {
    data[table.prop] = await (prisma as unknown as Record<string, PrismaModelClient>)[table.prop].findMany();
  }

  const payload = {
    meta: { appVersion: APP_VERSION, schemaFingerprint: await getSchemaFingerprint(), exportedAt: new Date().toISOString() },
    data,
  };

  const filename = `alliance-stats-backup-${new Date().toISOString().slice(0, 10)}-v${APP_VERSION}.json`;
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
