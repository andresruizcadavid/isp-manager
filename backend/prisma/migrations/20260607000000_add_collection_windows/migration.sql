-- Collection windows — date-bounded automatic reminder campaigns.
-- See backend/prisma/schema.prisma model CollectionWindow.

-- Extend NotificationType enum so the FASE 4 cron can tag its sends.
-- IF NOT EXISTS is safe across re-applies.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYMENT_REMINDER';

CREATE TABLE "collection_windows" (
  "id"                  TEXT          NOT NULL,
  "name"                TEXT          NOT NULL,
  "startDate"           TIMESTAMP(3)  NOT NULL,
  "endDate"             TIMESTAMP(3)  NOT NULL,
  "targetStatuses"      TEXT[]        NOT NULL DEFAULT ARRAY['PENDING','OVERDUE']::TEXT[],
  "channels"            TEXT[]        NOT NULL DEFAULT ARRAY['EMAIL']::TEXT[],
  "sendFrequencyHours"  INTEGER       NOT NULL DEFAULT 24,
  "messageTemplate"     TEXT          NOT NULL DEFAULT 'Hola {name}, tu factura por {amount} vence el {dueDate}. Realiza tu pago para evitar inconvenientes.',
  "isActive"            BOOLEAN       NOT NULL DEFAULT true,
  "createdById"         TEXT,
  "createdAt"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "collection_windows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "collection_windows_isActive_startDate_endDate_idx"
  ON "collection_windows"("isActive", "startDate", "endDate");

ALTER TABLE "collection_windows"
  ADD CONSTRAINT "collection_windows_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
