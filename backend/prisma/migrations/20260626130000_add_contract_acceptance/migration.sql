-- Aceptación digital del acta de servicios (ON-F-01). Snapshot inmutable + hash
-- para valor probatorio (Ley 527/1999, art. 422 CGP). Aditivo, no destructivo.
CREATE TABLE "contract_acceptances" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "documentType" TEXT,
    "documentNumber" TEXT,
    "version" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "contentText" TEXT NOT NULL,
    "planName" TEXT,
    "equipmentMode" TEXT,
    "acceptedTerms" BOOLEAN NOT NULL DEFAULT true,
    "acceptedData" BOOLEAN NOT NULL DEFAULT true,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "tokenId" TEXT,
    "pdfUrl" TEXT,
    CONSTRAINT "contract_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contract_acceptances_clientId_idx" ON "contract_acceptances"("clientId");

ALTER TABLE "contract_acceptances" ADD CONSTRAINT "contract_acceptances_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
