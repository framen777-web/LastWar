-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Member" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT '',
    "allianceRank" TEXT,
    "power" INTEGER,
    "level" INTEGER,
    "status" TEXT,
    "lastActive" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Member" ("aliases", "allianceRank", "createdAt", "id", "lastActive", "level", "name", "power", "status", "updatedAt") SELECT "aliases", "allianceRank", "createdAt", "id", "lastActive", "level", "name", "power", "status", "updatedAt" FROM "Member";
DROP TABLE "Member";
ALTER TABLE "new_Member" RENAME TO "Member";
CREATE UNIQUE INDEX "Member_name_key" ON "Member"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
