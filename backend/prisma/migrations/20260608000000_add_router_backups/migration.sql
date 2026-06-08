-- Backup module — adds SSH fields to Router + 2 new tables.
-- See backend/prisma/schema.prisma (RouterBackup + RouterBackupSchedule).

ALTER TABLE "routers"
  ADD COLUMN "sshPort"  INTEGER DEFAULT 22,
  ADD COLUMN "sshUser"  TEXT,
  ADD COLUMN "sshPass"  TEXT;

CREATE TABLE "router_backups" (
  "id"           TEXT          NOT NULL,
  "routerId"     INTEGER       NOT NULL,
  "fileName"     TEXT          NOT NULL,
  "filePath"     TEXT          NOT NULL,
  "sizeBytes"    INTEGER       NOT NULL DEFAULT 0,
  "startedAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"  TIMESTAMP(3),
  "status"       TEXT          NOT NULL DEFAULT 'pending',
  "errorMessage" TEXT,
  "triggeredBy"  TEXT          NOT NULL DEFAULT 'manual',
  "createdById"  TEXT,
  CONSTRAINT "router_backups_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "router_backups_routerId_startedAt_idx" ON "router_backups"("routerId", "startedAt");

ALTER TABLE "router_backups"
  ADD CONSTRAINT "router_backups_routerId_fkey"
  FOREIGN KEY ("routerId") REFERENCES "routers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "router_backups"
  ADD CONSTRAINT "router_backups_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "router_backup_schedules" (
  "id"              TEXT          NOT NULL,
  "routerId"        INTEGER       NOT NULL,
  "isActive"        BOOLEAN       NOT NULL DEFAULT true,
  "cronExpression"  TEXT          NOT NULL DEFAULT '0 3 * * *',
  "lastRunAt"       TIMESTAMP(3),
  "nextRunAt"       TIMESTAMP(3),
  "retentionCount"  INTEGER       NOT NULL DEFAULT 30,
  "createdAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "router_backup_schedules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "router_backup_schedules_routerId_key" ON "router_backup_schedules"("routerId");

ALTER TABLE "router_backup_schedules"
  ADD CONSTRAINT "router_backup_schedules_routerId_fkey"
  FOREIGN KEY ("routerId") REFERENCES "routers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
