-- Tecnología de conexión por cliente. Aditivo y no destructivo: nueva columna
-- con DEFAULT 'FIBER', por lo que los clientes existentes (todos de fibra)
-- quedan correctamente etiquetados sin tocar sus datos.
ALTER TABLE "clients" ADD COLUMN "connectionType" TEXT NOT NULL DEFAULT 'FIBER';
