-- PaymentAttempt — registra cada intento de link de pago Wompi
-- Ver backend/prisma/schema.prisma para semántica completa.

CREATE TABLE "payment_attempts" (
  "id"              TEXT          NOT NULL,
  "invoiceId"       TEXT          NOT NULL,
  "clientId"        TEXT          NOT NULL,
  "provider"        TEXT          NOT NULL DEFAULT 'WOMPI',
  "reference"       TEXT          NOT NULL,
  "amount"          INTEGER       NOT NULL,
  "status"          TEXT          NOT NULL DEFAULT 'PENDING',
  "checkoutUrl"     TEXT,
  "externalId"      TEXT,
  "webhookPayload"  JSONB,
  "expiresAt"       TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_attempts_reference_key" ON "payment_attempts"("reference");
CREATE INDEX "payment_attempts_invoiceId_idx" ON "payment_attempts"("invoiceId");
CREATE INDEX "payment_attempts_clientId_idx" ON "payment_attempts"("clientId");

ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
