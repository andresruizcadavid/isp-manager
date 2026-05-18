-- CreateTable
CREATE TABLE "client_evidence_photos" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "technicianId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'other',
    "description" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_evidence_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_evidence_photos_clientId_idx" ON "client_evidence_photos"("clientId");

-- CreateIndex
CREATE INDEX "client_evidence_photos_technicianId_idx" ON "client_evidence_photos"("technicianId");

-- AddForeignKey
ALTER TABLE "client_evidence_photos" ADD CONSTRAINT "client_evidence_photos_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
