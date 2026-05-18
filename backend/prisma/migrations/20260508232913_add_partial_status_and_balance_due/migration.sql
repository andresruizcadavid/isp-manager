-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'PARTIAL';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "balanceDue" INTEGER NOT NULL DEFAULT 0;
