-- Audit log for operator-initiated bulk operations.
-- See backend/prisma/schema.prisma model BulkOperationLog for context.

CREATE TABLE "bulk_operation_logs" (
  "id"          TEXT          NOT NULL,
  "type"        TEXT          NOT NULL,
  "operatorId"  TEXT,
  "payload"     JSONB         NOT NULL,
  "results"     JSONB         NOT NULL,
  "totalCount"  INTEGER       NOT NULL DEFAULT 0,
  "okCount"     INTEGER       NOT NULL DEFAULT 0,
  "failedCount" INTEGER       NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "bulk_operation_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bulk_operation_logs_type_createdAt_idx"
  ON "bulk_operation_logs"("type", "createdAt");

CREATE INDEX "bulk_operation_logs_operatorId_idx"
  ON "bulk_operation_logs"("operatorId");

ALTER TABLE "bulk_operation_logs"
  ADD CONSTRAINT "bulk_operation_logs_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
