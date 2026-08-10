-- CreateTable
CREATE TABLE "AeImport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "memberId" INTEGER NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "eventDate" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "rank" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AeImport_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AeImport_memberId_weekNumber_eventDate_key" ON "AeImport"("memberId", "weekNumber", "eventDate");
