-- Control de cobranza por cliente: último recordatorio de cobro enviado.
ALTER TABLE "clients" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
ALTER TABLE "clients" ADD COLUMN "reminderChannel" TEXT;
