-- Trazabilidad de vistas del portal cautivo (suspensión / aviso) por cliente.
ALTER TABLE "clients" ADD COLUMN "suspendedViews"    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "clients" ADD COLUMN "suspendedViewedAt" TIMESTAMP(3);
ALTER TABLE "clients" ADD COLUMN "avisoViews"        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "clients" ADD COLUMN "avisoViewedAt"     TIMESTAMP(3);
