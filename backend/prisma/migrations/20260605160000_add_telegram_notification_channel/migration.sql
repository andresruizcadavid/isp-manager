-- Add TELEGRAM to the NotificationChannel enum so the notification
-- orchestrator can log Telegram dispatches without a Prisma validation
-- error. No existing rows use this value yet, so the ADD is safe.

ALTER TYPE "NotificationChannel" ADD VALUE 'TELEGRAM';
