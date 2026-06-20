-- Tecnología del plan (FIBER por default). Aditivo, no destructivo.
ALTER TABLE "plans" ADD COLUMN "connectionType" TEXT NOT NULL DEFAULT 'FIBER';
