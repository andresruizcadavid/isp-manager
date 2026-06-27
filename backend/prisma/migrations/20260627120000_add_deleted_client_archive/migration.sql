-- Archivo de clientes eliminados: snapshot + resumen financiero antes del
-- borrado en cascada. Aditivo, no destructivo.
CREATE TABLE "deleted_client_archives" (
    "id" TEXT NOT NULL,
    "originalClientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentType" TEXT,
    "documentNumber" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "ip" TEXT,
    "planName" TEXT,
    "previousStatus" TEXT,
    "monthlyFee" INTEGER NOT NULL DEFAULT 0,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "outstandingDebt" INTEGER NOT NULL DEFAULT 0,
    "totalInvoiced" INTEGER NOT NULL DEFAULT 0,
    "totalPaid" INTEGER NOT NULL DEFAULT 0,
    "invoiceCount" INTEGER NOT NULL DEFAULT 0,
    "paymentCount" INTEGER NOT NULL DEFAULT 0,
    "detail" JSONB,
    "reasonCategory" TEXT,
    "reasonNote" TEXT,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedByUserId" TEXT,
    "deletedByUserName" TEXT,
    CONSTRAINT "deleted_client_archives_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deleted_client_archives_deletedAt_idx" ON "deleted_client_archives"("deletedAt");
CREATE INDEX "deleted_client_archives_reasonCategory_idx" ON "deleted_client_archives"("reasonCategory");
CREATE INDEX "deleted_client_archives_outstandingDebt_idx" ON "deleted_client_archives"("outstandingDebt");

ALTER TABLE "deleted_client_archives" ADD CONSTRAINT "deleted_client_archives_deletedByUserId_fkey"
    FOREIGN KEY ("deletedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
