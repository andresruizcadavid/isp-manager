-- AlterTable
ALTER TABLE "zones" ADD COLUMN "routerId" INTEGER;

-- CreateIndex
CREATE INDEX "zones_routerId_idx" ON "zones"("routerId");

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_routerId_fkey"
  FOREIGN KEY ("routerId") REFERENCES "routers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
