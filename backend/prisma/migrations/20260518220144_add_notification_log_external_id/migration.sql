-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'INCOMING';

-- AlterTable
ALTER TABLE "notification_logs" ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE INDEX "notification_logs_externalId_idx" ON "notification_logs"("externalId");
