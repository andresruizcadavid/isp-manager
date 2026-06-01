-- Client self-service update tokens.
--
-- Single-use, time-boxed tokens that grant a public URL the ability to
-- patch a whitelisted subset of a Client's fields. Created by a
-- technician/admin from /clients/[id]; consumed by the customer over a
-- channel-selected link (Email/WhatsApp/Telegram).
--
-- See backend/prisma/schema.prisma model ClientUpdateToken for the full
-- field list and the README for the operation runbook.

CREATE TABLE "client_update_tokens" (
  "id"             TEXT          NOT NULL,
  "clientId"       TEXT          NOT NULL,
  "token"          TEXT          NOT NULL,
  "status"         TEXT          NOT NULL DEFAULT 'pending',
  "expiresAt"      TIMESTAMP(3)  NOT NULL,
  "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt"         TIMESTAMP(3),
  "createdById"    TEXT,
  "sendChannels"   TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notifyChannels" TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "ipAddress"      TEXT,
  "userAgent"      TEXT,

  CONSTRAINT "client_update_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "client_update_tokens_token_key"
  ON "client_update_tokens"("token");

CREATE INDEX "client_update_tokens_clientId_idx"
  ON "client_update_tokens"("clientId");

CREATE INDEX "client_update_tokens_status_expiresAt_idx"
  ON "client_update_tokens"("status", "expiresAt");

ALTER TABLE "client_update_tokens"
  ADD CONSTRAINT "client_update_tokens_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_update_tokens"
  ADD CONSTRAINT "client_update_tokens_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
