-- Ajustes de notificaciones a clientes. Puramente ADITIVO: crea una tabla
-- nueva, no toca ni una sola fila/columna existente. Las filas por defecto
-- (una por tipo) se siembran desde la app (notification-settings.service.js)
-- replicando el comportamiento actual (todo habilitado).

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp" BOOLEAN NOT NULL DEFAULT true,
    "schedule" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_type_key" ON "notification_settings"("type");
