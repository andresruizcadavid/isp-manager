-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_planId_fkey";

-- AlterTable
ALTER TABLE "clients" ALTER COLUMN "planId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
