-- One-shot data fix: any client currently assigned to a free plan
-- (plans.isFree = true) shouldn't owe money. Cancel their open
-- invoices and zero out balanceDue.
--
-- Why this lives in a migration: it brings the existing DB into the
-- invariant the application code (clients.controller.updateClient now
-- enforces on every save). Idempotent — runs again do nothing because
-- the WHERE filters out non-open statuses.

UPDATE "invoices" i
SET    "status" = 'CANCELLED',
       "balanceDue" = 0
FROM   "clients" c
JOIN   "plans" p ON p."id" = c."planId"
WHERE  i."clientId" = c."id"
  AND  p."isFree" = true
  AND  i."status" IN ('PENDING', 'OVERDUE', 'PARTIAL');
