-- Router de cobranza (dónde se enforza el corte cuando difiere del router del cliente).
ALTER TABLE "routers" ADD COLUMN "collectionRouterId" INTEGER;
