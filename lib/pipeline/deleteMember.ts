import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";

type PrismaDelegate = { deleteMany: (args: { where: Record<string, number> }) => Prisma.PrismaPromise<unknown> };
type MemberForeignKey = { table_name: string; column_name: string };

/**
 * Finds every table with a foreign key pointing at Member, and the actual column name
 * backing it - NOT assumed to always be "memberId" (PivotView uses "creatorId",
 * FeedbackItem uses "submittedById") - read straight from Postgres's own catalog at
 * runtime, same technique lib/backup/schemaFingerprint.ts already uses for its schema
 * fingerprint. This project's Prisma generator ("prisma-client") has no DMMF export to
 * read this from instead, so the catalog is the only live source of truth - and it means
 * a table added next month is covered automatically here too, with nothing new to
 * remember (unlike app/api/users/merge/route.ts's hand-maintained table list, which has
 * already missed a newly-added table twice).
 */
async function memberForeignKeys(): Promise<{ delegateName: string; fkField: string }[]> {
  const rows = await prisma.$queryRaw<MemberForeignKey[]>`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND ccu.table_name = 'Member'
  `;
  return rows.map((r) => ({
    delegateName: r.table_name.charAt(0).toLowerCase() + r.table_name.slice(1),
    fkField: r.column_name,
  }));
}

/**
 * Permanently deletes a member and every row anywhere in the database that references
 * them - for rejecting a bogus auto-created member (bad OCR name, not a real person),
 * not for anything involving a real member's history. A plain prisma.member.delete()
 * would hit the same FK-RESTRICT error the merge route had to work around, since every
 * Member-referencing table here uses a non-cascading foreign key.
 */
export async function deleteMemberAndAllData(memberId: number): Promise<void> {
  const scoped = await memberForeignKeys();
  await prisma.$transaction([
    ...scoped.map(({ delegateName, fkField }) =>
      (prisma[delegateName as keyof typeof prisma] as unknown as PrismaDelegate).deleteMany({ where: { [fkField]: memberId } })
    ),
    prisma.member.delete({ where: { id: memberId } }),
  ]);
}
