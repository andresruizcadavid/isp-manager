-- AlterTable
ALTER TABLE "notification_logs" ADD COLUMN "campaignId" TEXT;

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateId" TEXT,
    "channel" TEXT NOT NULL,
    "audienceJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_logs_campaignId_idx" ON "notification_logs"("campaignId");
CREATE INDEX "notification_logs_clientId_idx" ON "notification_logs"("clientId");
CREATE INDEX "notification_templates_channel_idx" ON "notification_templates"("channel");
CREATE INDEX "notification_campaigns_status_idx" ON "notification_campaigns"("status");
CREATE INDEX "notification_campaigns_createdAt_idx" ON "notification_campaigns"("createdAt");

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "notification_campaigns"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "notification_campaigns" ADD CONSTRAINT "notification_campaigns_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "notification_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
