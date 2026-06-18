-- Mapeo evento→plantilla aprobada de Meta para envíos transaccionales de WhatsApp.
-- Aditivo, no destructivo. NULL = sin mapeo (cae a texto libre, solo ventana 24h).
ALTER TABLE "whatsapp_configs" ADD COLUMN "templateMap" JSONB;
