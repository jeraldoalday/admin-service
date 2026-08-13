-- CreateTable
CREATE TABLE "team_permission_grants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "team_permission_grants_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "team_permission_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "team_permission_grants_teamId_userId_idx" ON "team_permission_grants"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "team_permission_grants_teamId_userId_permission_key" ON "team_permission_grants"("teamId", "userId", "permission");
