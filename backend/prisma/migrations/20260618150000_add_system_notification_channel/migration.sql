-- Canal SYSTEM para logs de auditoría internos (suspensión/reactivación).
-- Aditivo, no destructivo.
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'SYSTEM';
