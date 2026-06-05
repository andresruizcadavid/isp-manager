-- FASE 5 dedup: drop the Client.* columns that duplicated MikrotikAccount.
--
-- Background: pppoeUsername / pppoePassword / serviceIp / serviceLocalIp
-- lived on BOTH `clients` and `mikrotik_accounts`. The previous backfill
-- migration (20260529120000_backfill_client_mikrotik_mirror) copied the
-- canonical values from MikrotikAccount onto Client.* where the latter
-- was NULL. With all production callers now reading exclusively from
-- MikrotikAccount (see frontend sweep + backend controllers + importer),
-- the Client.* columns are safe to drop.
--
-- Operational checklist before running this in prod:
--   1. Run a backup of the clients table.
--   2. Confirm `mikrotik_accounts.username` is populated for every active
--      client that had `clients.pppoeUsername` set:
--
--        SELECT c.id, c."pppoeUsername", ma.username
--        FROM clients c LEFT JOIN mikrotik_accounts ma ON ma."clientId" = c.id
--        WHERE c."pppoeUsername" IS NOT NULL AND ma.username IS NULL;
--
--      Any row returned means the dedup is incomplete — fix BEFORE dropping.
--   3. After deploy, monitor /api/v1/clients responses to confirm
--      mikrotikAccount.username is present where expected.

ALTER TABLE "clients" DROP COLUMN IF EXISTS "pppoeUsername";
ALTER TABLE "clients" DROP COLUMN IF EXISTS "pppoePassword";
ALTER TABLE "clients" DROP COLUMN IF EXISTS "serviceIp";
ALTER TABLE "clients" DROP COLUMN IF EXISTS "serviceLocalIp";
