-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "coordinates" TEXT,
ADD COLUMN     "cutoffDate" TIMESTAMP(3),
ADD COLUMN     "monthlyFee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pppoePassword" TEXT,
ADD COLUMN     "pppoeUsername" TEXT,
ADD COLUMN     "serviceIp" TEXT,
ADD COLUMN     "serviceLocalIp" TEXT,
ADD COLUMN     "vlan" TEXT,
ADD COLUMN     "wisphubId" TEXT,
ADD COLUMN     "wisphubRouterId" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "discount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "wisphubId" TEXT;

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "type" TEXT,
ADD COLUMN     "wisphubId" TEXT,
ALTER COLUMN "monthlyPrice" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "zones" ADD COLUMN     "wisphubId" TEXT;

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "wisphubId" TEXT,
    "invoiceId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_items_wisphubId_key" ON "invoice_items"("wisphubId");

-- CreateIndex
CREATE UNIQUE INDEX "clients_wisphubId_key" ON "clients"("wisphubId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_wisphubId_key" ON "invoices"("wisphubId");

-- CreateIndex
CREATE UNIQUE INDEX "plans_wisphubId_key" ON "plans"("wisphubId");

-- CreateIndex
CREATE UNIQUE INDEX "zones_wisphubId_key" ON "zones"("wisphubId");

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

