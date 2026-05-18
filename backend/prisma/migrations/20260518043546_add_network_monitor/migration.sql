-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('ROUTER', 'ANTENNA', 'SWITCH', 'ONT', 'SERVER', 'OTHER');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ONLINE', 'OFFLINE', 'UNSTABLE', 'UNKNOWN');

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'TECHNICIAN';

-- CreateTable
CREATE TABLE "network_devices" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "type" "DeviceType" NOT NULL DEFAULT 'OTHER',
    "zoneId" INTEGER,
    "posX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "posY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "DeviceStatus" NOT NULL DEFAULT 'UNKNOWN',
    "latency" DOUBLE PRECISION,
    "lastSeen" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "network_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_connections" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_events" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL,
    "latency" DOUBLE PRECISION,
    "loss" DOUBLE PRECISION,
    "message" TEXT,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_configs" (
    "id" TEXT NOT NULL,
    "botToken" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "alertOnDown" BOOLEAN NOT NULL DEFAULT true,
    "alertOnRecovery" BOOLEAN NOT NULL DEFAULT true,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "network_devices_status_idx" ON "network_devices"("status");

-- CreateIndex
CREATE INDEX "network_devices_zoneId_idx" ON "network_devices"("zoneId");

-- CreateIndex
CREATE INDEX "network_connections_sourceId_idx" ON "network_connections"("sourceId");

-- CreateIndex
CREATE INDEX "network_connections_targetId_idx" ON "network_connections"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "network_connections_sourceId_targetId_key" ON "network_connections"("sourceId", "targetId");

-- CreateIndex
CREATE INDEX "network_events_deviceId_idx" ON "network_events"("deviceId");

-- CreateIndex
CREATE INDEX "network_events_createdAt_idx" ON "network_events"("createdAt");

-- AddForeignKey
ALTER TABLE "network_devices" ADD CONSTRAINT "network_devices_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_connections" ADD CONSTRAINT "network_connections_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "network_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_connections" ADD CONSTRAINT "network_connections_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "network_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_events" ADD CONSTRAINT "network_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "network_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
