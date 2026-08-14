// One-time data migration: copies every row from the old SQLite dev.db into the Postgres
// database at DATABASE_URL. Run manually once, never invoked automatically:
//
//   npx tsx scripts/migrate-to-postgres.ts
//
// Reads the SQLite side with better-sqlite3 directly rather than through Prisma - once
// prisma/schema.prisma's datasource is "postgresql", the generated Prisma Client is
// Postgres-flavored (query dialect, RETURNING support, etc.) and can't be pointed back at
// the SQLite file. The Postgres side goes through the app's real `prisma` client from
// lib/db.ts, i.e. whatever DATABASE_URL is currently set to - so point that at the target
// database before running this.
//
// IDs are preserved exactly (every relation in this schema is a plain integer foreign key),
// so this uses createMany with explicit `id` values, then resets each table's identity
// sequence to continue from MAX(id) - a raw SQL call that's fine here (one-time migration
// tooling), even though the app itself never uses raw SQL.

import Database from "better-sqlite3";
import path from "node:path";
import { prisma } from "@/lib/db";

const DB_PATH = path.join(process.cwd(), "dev.db");

function toBool(v: unknown): boolean {
  return v === 1 || v === true;
}
function toDate(v: unknown): Date {
  return new Date(v as string);
}
function toDateOrNull(v: unknown): Date | null {
  return v === null || v === undefined ? null : new Date(v as string);
}

async function resetSequence(table: string) {
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1), true)`
  );
}

async function main() {
  const existingMembers = await prisma.member.count();
  if (existingMembers > 0) {
    throw new Error(
      `Target database already has ${existingMembers} Member row(s) - refusing to run to avoid duplicating data. ` +
        `This script is meant for a fresh, empty Postgres database (after "prisma db push").`
    );
  }

  const db = new Database(DB_PATH, { readonly: true });

  console.log("Migrating from", DB_PATH, "to", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@"));

  // --- Member (no deps) ---
  const members = db.prepare("SELECT * FROM Member").all() as any[];
  await prisma.member.createMany({
    data: members.map((m) => ({
      id: m.id,
      name: m.name,
      aliases: m.aliases,
      allianceRank: m.allianceRank,
      status: m.status,
      lastActive: m.lastActive,
      squadAir: m.squadAir,
      squadTank: m.squadTank,
      squadMissile: m.squadMissile,
      squadFourth: m.squadFourth,
      createdAt: toDate(m.createdAt),
      updatedAt: toDate(m.updatedAt),
      passwordHash: m.passwordHash,
      role: m.role,
      isActive: toBool(m.isActive),
      theme: m.theme,
    })),
  });
  await resetSequence("Member");
  console.log(`Member: ${members.length} row(s)`);

  // --- Category (no deps) ---
  const categories = db.prepare("SELECT * FROM Category").all() as any[];
  await prisma.category.createMany({
    data: categories.map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      description: c.description,
      shape: c.shape,
      divisor: c.divisor,
      divisorLabel: c.divisorLabel,
      importMode: c.importMode,
      dedupField: c.dedupField,
      storedFields: c.storedFields,
      valueField: c.valueField,
      active: toBool(c.active),
      sortOrder: c.sortOrder,
      createdAt: toDate(c.createdAt),
      updatedAt: toDate(c.updatedAt),
      cumulative: toBool(c.cumulative),
      conductorMode: c.conductorMode,
      conductorPointsPerUnit: c.conductorPointsPerUnit,
      conductorUnitSize: c.conductorUnitSize,
      conductorFlatValue: c.conductorFlatValue,
    })),
  });
  await resetSequence("Category");
  console.log(`Category: ${categories.length} row(s)`);

  // --- Setting (no id column, key is the PK) ---
  const settings = db.prepare("SELECT * FROM Setting").all() as any[];
  await prisma.setting.createMany({
    data: settings.map((s) => ({ key: s.key, value: s.value, updatedAt: toDate(s.updatedAt) })),
  });
  console.log(`Setting: ${settings.length} row(s)`);

  // --- Suggestion (-> Member) ---
  const suggestions = db.prepare("SELECT * FROM Suggestion").all() as any[];
  await prisma.suggestion.createMany({
    data: suggestions.map((s) => ({
      id: s.id,
      memberId: s.memberId,
      weekNumber: s.weekNumber,
      value: s.value,
      updatedAt: toDate(s.updatedAt),
    })),
  });
  await resetSequence("Suggestion");
  console.log(`Suggestion: ${suggestions.length} row(s)`);

  // --- RawExtraction (no deps) ---
  const rawExtractions = db.prepare("SELECT * FROM RawExtraction").all() as any[];
  await prisma.rawExtraction.createMany({
    data: rawExtractions.map((r) => ({
      id: r.id,
      imageFilename: r.imageFilename,
      categoryKey: r.categoryKey,
      weekNumber: r.weekNumber,
      rawJson: r.rawJson,
      confidence: r.confidence,
      status: r.status,
      createdAt: toDate(r.createdAt),
    })),
  });
  await resetSequence("RawExtraction");
  console.log(`RawExtraction: ${rawExtractions.length} row(s)`);

  // --- WeeklyStat (-> Member) ---
  const weeklyStats = db.prepare("SELECT * FROM WeeklyStat").all() as any[];
  await prisma.weeklyStat.createMany({
    data: weeklyStats.map((w) => ({
      id: w.id,
      memberId: w.memberId,
      weekNumber: w.weekNumber,
      categoryKey: w.categoryKey,
      value: w.value,
      rank: w.rank,
      createdAt: toDate(w.createdAt),
      updatedAt: toDate(w.updatedAt),
    })),
  });
  await resetSequence("WeeklyStat");
  console.log(`WeeklyStat: ${weeklyStats.length} row(s)`);

  // --- CategoryRecord (-> Category, Member) ---
  const categoryRecords = db.prepare("SELECT * FROM CategoryRecord").all() as any[];
  await prisma.categoryRecord.createMany({
    data: categoryRecords.map((r) => ({
      id: r.id,
      categoryId: r.categoryId,
      memberId: r.memberId,
      weekNumber: r.weekNumber,
      dedupKey: r.dedupKey,
      rawValue: r.rawValue,
      value: r.value,
      rank: r.rank,
      fields: r.fields,
      createdAt: toDate(r.createdAt),
      updatedAt: toDate(r.updatedAt),
    })),
  });
  await resetSequence("CategoryRecord");
  console.log(`CategoryRecord: ${categoryRecords.length} row(s)`);

  // --- ConductorRound (no deps) ---
  const conductorRounds = db.prepare("SELECT * FROM ConductorRound").all() as any[];
  await prisma.conductorRound.createMany({
    data: conductorRounds.map((r) => ({
      id: r.id,
      weeksInCycle: r.weeksInCycle,
      startWeek: r.startWeek,
      status: r.status,
      source: r.source,
      createdAt: toDate(r.createdAt),
      confirmedAt: toDateOrNull(r.confirmedAt),
    })),
  });
  await resetSequence("ConductorRound");
  console.log(`ConductorRound: ${conductorRounds.length} row(s)`);

  // --- ConductorSelection (-> ConductorRound, Member) ---
  const conductorSelections = db.prepare("SELECT * FROM ConductorSelection").all() as any[];
  await prisma.conductorSelection.createMany({
    data: conductorSelections.map((s) => ({
      id: s.id,
      roundId: s.roundId,
      memberId: s.memberId,
      role: s.role,
      slotIndex: s.slotIndex,
      weekNumber: s.weekNumber,
      pointsAtSelection: s.pointsAtSelection,
      sourceCategoryKey: s.sourceCategoryKey,
      sourceRank: s.sourceRank,
      manualOverride: toBool(s.manualOverride),
      createdAt: toDate(s.createdAt),
    })),
  });
  await resetSequence("ConductorSelection");
  console.log(`ConductorSelection: ${conductorSelections.length} row(s)`);

  db.close();

  console.log("\nDone. Verifying target row counts:");
  const counts = await Promise.all([
    prisma.member.count(),
    prisma.category.count(),
    prisma.setting.count(),
    prisma.suggestion.count(),
    prisma.rawExtraction.count(),
    prisma.weeklyStat.count(),
    prisma.categoryRecord.count(),
    prisma.conductorRound.count(),
    prisma.conductorSelection.count(),
  ]);
  console.log({
    Member: counts[0],
    Category: counts[1],
    Setting: counts[2],
    Suggestion: counts[3],
    RawExtraction: counts[4],
    WeeklyStat: counts[5],
    CategoryRecord: counts[6],
    ConductorRound: counts[7],
    ConductorSelection: counts[8],
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
