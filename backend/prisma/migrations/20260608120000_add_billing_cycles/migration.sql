-- BillingCycle — parámetro mensual del ciclo de cobro del servicio.
-- Ver backend/prisma/schema.prisma para semántica completa.

CREATE TABLE "billing_cycles" (
  "id"                 TEXT          NOT NULL,
  "year"               INTEGER       NOT NULL,
  "month"              INTEGER       NOT NULL,
  "collectionStart"    TIMESTAMP(3)  NOT NULL,
  "collectionEnd"      TIMESTAMP(3)  NOT NULL,
  "moraGraceDays"      INTEGER       NOT NULL DEFAULT 7,
  "status"             TEXT          NOT NULL DEFAULT 'draft',
  "autoSuspendEnabled" BOOLEAN       NOT NULL DEFAULT false,
  "notes"              TEXT,
  "createdById"        TEXT,
  "createdAt"          TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "billing_cycles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_cycles_year_month_key" ON "billing_cycles"("year", "month");
CREATE INDEX "billing_cycles_status_year_month_idx" ON "billing_cycles"("status", "year", "month");

ALTER TABLE "billing_cycles"
  ADD CONSTRAINT "billing_cycles_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
