-- Polling engine parameters on the single TelegramConfig row.
ALTER TABLE "telegram_configs"
  ADD COLUMN "probeIntervalSec" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "probeTimeoutSec"  INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "probeDownCount"   INTEGER NOT NULL DEFAULT 2;

-- Per-device counters used by the new alert-gating state machine.
ALTER TABLE "network_devices"
  ADD COLUMN "failCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "alertSent" BOOLEAN NOT NULL DEFAULT false;
