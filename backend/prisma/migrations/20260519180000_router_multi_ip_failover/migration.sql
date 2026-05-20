-- Multi-IP failover for Routers (style: NOC con rutas redundantes).
-- Reemplaza el único campo routers.ipAddress por la tabla router_routes
-- (prioridad 1/2/3) y agrega el estado derivado del monitor ICMP.

-- 1) Enums
CREATE TYPE "RouterStatus" AS ENUM ('ONLINE', 'DEGRADED', 'OFFLINE', 'UNKNOWN');
CREATE TYPE "RouteStatus"  AS ENUM ('ONLINE', 'OFFLINE', 'UNKNOWN');

-- 2) Nueva tabla router_routes
CREATE TABLE "router_routes" (
  "id"         SERIAL PRIMARY KEY,
  "routerId"   INTEGER NOT NULL,
  "ip"         TEXT    NOT NULL,
  "priority"   INTEGER NOT NULL,
  "label"      TEXT,
  "status"     "RouteStatus" NOT NULL DEFAULT 'UNKNOWN',
  "latency"    DOUBLE PRECISION,
  "lastPingAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "router_routes_routerId_fkey"
    FOREIGN KEY ("routerId") REFERENCES "routers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "router_routes_routerId_priority_key"
  ON "router_routes"("routerId", "priority");
CREATE INDEX "router_routes_routerId_idx"  ON "router_routes"("routerId");
CREATE INDEX "router_routes_status_idx"    ON "router_routes"("status");

-- 3) Data migration: cada router existente conserva su IP como ruta principal
INSERT INTO "router_routes" ("routerId", "ip", "priority", "label", "updatedAt")
SELECT id, "ipAddress", 1, 'Enlace principal', NOW()
FROM "routers"
WHERE "ipAddress" IS NOT NULL AND TRIM("ipAddress") <> '';

-- 4) Columnas de failover en routers
ALTER TABLE "routers"
  ADD COLUMN "status"        "RouterStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "activeRouteId" INTEGER,
  ADD COLUMN "failCount"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "alertSent"     BOOLEAN NOT NULL DEFAULT false;

-- 5) Drop del campo único de IP (ahora vive en router_routes)
ALTER TABLE "routers" DROP COLUMN "ipAddress";
