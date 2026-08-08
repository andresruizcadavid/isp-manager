-- Nombres de address-list de cobranza por router (defaults = comportamiento actual).
ALTER TABLE "routers" ADD COLUMN "listMoroso"  TEXT NOT NULL DEFAULT 'Moroso';
ALTER TABLE "routers" ADD COLUMN "listAviso"   TEXT NOT NULL DEFAULT 'Aviso';
ALTER TABLE "routers" ADD COLUMN "listAvisoOk" TEXT NOT NULL DEFAULT 'AvisoOK';
