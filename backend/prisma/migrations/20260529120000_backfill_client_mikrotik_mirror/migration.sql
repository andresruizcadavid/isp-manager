-- Backfill the duplicated columns on `clients` from `mikrotik_accounts`.
--
-- Context: `Client.pppoeUsername / pppoePassword / serviceIp / serviceLocalIp
-- / coordinates` mirror fields that also live on `MikrotikAccount`. New
-- clients created via the API now keep both sides in sync, but rows created
-- BEFORE this fix have NULLs on the Client side for everything except
-- `serviceIp` (which the create flow happened to set).
--
-- This migration copies the MikrotikAccount values onto the Client row only
-- where the Client column is still NULL — we never overwrite an operator
-- edit. Idempotent: running it twice is a no-op.
--
-- Once Client.* and MikrotikAccount.* are confirmed to match across the
-- board, a future migration may drop the duplicated columns on `clients`.

UPDATE "clients" c
SET
  "pppoeUsername"  = COALESCE(c."pppoeUsername",  m."username"),
  "pppoePassword"  = COALESCE(c."pppoePassword",  m."password"),
  "serviceIp"      = COALESCE(c."serviceIp",      split_part(m."remoteAddress", '/', 1)),
  "serviceLocalIp" = COALESCE(c."serviceLocalIp", m."localAddress"),
  "coordinates"    = COALESCE(c."coordinates",    m."coordinates")
FROM "mikrotik_accounts" m
WHERE m."clientId" = c."id"
  AND (
    c."pppoeUsername"  IS NULL OR
    c."pppoePassword"  IS NULL OR
    c."serviceIp"      IS NULL OR
    c."serviceLocalIp" IS NULL OR
    c."coordinates"    IS NULL
  );
