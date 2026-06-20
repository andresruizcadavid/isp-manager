-- Remove the "Ventanas de cobranza" feature (CollectionWindow). The whole
-- auto-collection campaign system was removed in favor of a single billing
-- model (Ciclos de cobro + recordatorios del billing.job). No other table
-- references collection_windows, so this drop is self-contained.
DROP TABLE IF EXISTS "collection_windows";
