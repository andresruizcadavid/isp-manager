// ACTA ÚNICA DE ACTIVACIÓN, COMODATO Y PRESTACIÓN DE SERVICIOS DIGITALES (ON-F-01).
//
// Texto legal versionado. La aceptación digital del cliente (Ley 527/1999 +
// Decreto 2364/2012) se registra en ContractAcceptance con un SNAPSHOT INMUTABLE
// del texto renderizado y su hash SHA-256 — así, aunque luego se edite el acta,
// lo que el cliente aceptó queda congelado y conserva mérito ejecutivo.
//
// Si cambias el texto, SUBE la versión (CONTRACT_VERSION) para no mezclar
// aceptaciones de versiones distintas.
import crypto from 'crypto';

export const CONTRACT_CODE    = 'ON-F-01';
export const CONTRACT_VERSION = 'ON-F-01 v1';

// Datos fijos del proveedor (enseña comercial ONLINE).
const PROVIDER = {
  name: 'MAURICIO RUIZ CADAVID',
  cc:   '16.844.291',
  brand: 'ONLINE (Internet Online)'
};

/**
 * Renderiza el acta con los datos del suscriptor. Determinista: el mismo input
 * produce el mismo texto (y por ende el mismo hash), de modo que lo que ve el
 * cliente en pantalla y lo que se guarda al aceptar coinciden byte a byte.
 *
 * @param {{ clientName?:string, documentType?:string, documentNumber?:string, planName?:string, planPriceCop?:number, city?:string, date?:Date }} d
 * @returns {string}
 */
export function renderContract(d = {}) {
  const name = (d.clientName || 'EL SUSCRIPTOR').trim();
  const doc  = [d.documentType, d.documentNumber].filter(Boolean).join(' ') || '____________';
  const plan = (d.planName || 'el plan contratado').trim();
  const price = Number.isFinite(d.planPriceCop)
    ? `$${Math.round(d.planPriceCop).toLocaleString('es-CO')}`
    : '$____________';
  const city = (d.city || 'Jamundí').trim();
  const dt   = d.date instanceof Date ? d.date : new Date();
  const fecha = dt.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });

  return `ACTA ÚNICA DE ACTIVACIÓN, COMODATO Y PRESTACIÓN DE SERVICIOS DIGITALES
Código: ${CONTRACT_CODE} — Versión: 1

Entre los suscritos a saber, ${PROVIDER.name}, identificado con C.C. ${PROVIDER.cc}, actuando en nombre propio y bajo la enseña comercial ${PROVIDER.brand} (en adelante EL PROVEEDOR), y ${name}, identificado con ${doc} (en adelante EL SUSCRIPTOR), han convenido celebrar el presente acuerdo que se regirá por las siguientes cláusulas:

1. DEFINICIONES TÉCNICAS (REGULACIÓN VIGENTE)
1.1 ACCESO A INTERNET: Acceso físico que incluye todas las funcionalidades y conexiones nacionales y/o internacionales necesarias para permitir a un usuario establecer comunicación con un nodo de internet.
1.2 BANDA ANCHA: Es la capacidad de transmisión con ancho de banda suficiente para permitir de manera combinada la provisión de voz, datos y video, de manera inalámbrica o cableada.
1.3 TECNOLOGÍA: ONLINE se compromete a brindar internet con tecnología FTTH (Fibra hasta el hogar), Inalámbricas o UTP, según disponibilidad técnica en San Vicente y La Estrella.

2. PLANES Y CALIDAD DEL SERVICIO
Plan contratado por EL SUSCRIPTOR: ${plan} — Mensualidad: ${price}.
Planes disponibles: PLAN BÁSICO (Hasta 100 MB, descargas sin límites y conexión estable) $65.000; PLAN FULL (Hasta 100 MB, multimedia digital y videojuegos sin cortes) $85.000.
• CALIDAD: EL PROVEEDOR garantiza que la velocidad efectiva del servicio corresponde a la contratada con una calidad del servicio del 70%. La calidad se calculará por día.
• VELOCIDAD DE CARGA: La conexión en sentido SUSCRIPTOR – PROVEEDOR (Subida) corresponde al 20% de la velocidad de descarga contratada.
• COMPENSACIÓN: Ante indisponibilidad o suspensión del servicio por causas propias de la empresa, se compensará en la próxima factura según las obligaciones de calidad definidas por la CRC.

3. MODALIDAD DE EQUIPOS Y PRECIOS DE FOMENTO
La modalidad de equipos (MODALIDAD A – COMPRA, o MODALIDAD B – COMODATO) se acuerda por separado entre las partes y no se define en esta aceptación digital.
Para referencia: MODALIDAD A (COMPRA): el SUSCRIPTOR adquiere la propiedad de los equipos a Precio de Fomento exclusivo: Módem ONU ($69.900) y/o TV BOX ($79.900); no genera permanencia mínima. MODALIDAD B (COMODATO): equipos en préstamo propiedad de ${PROVIDER.name}; requiere permanencia mínima de 12 meses; en caso de retiro anticipado, el cargo es de $200.000 (proporcional).

4. PRINCIPALES OBLIGACIONES DEL USUARIO
4.1 Pagar oportunamente los servicios e intereses de mora en caso de incumplimiento.
4.2 Suministrar información verdadera y veraz para el registro.
4.3 Hacer uso adecuado de los equipos y los servicios.
4.4 No divulgar ni acceder a pornografía infantil (Ley 679 de 2001).
4.5 Avisar a las autoridades y al PROVEEDOR sobre robo o hurto de elementos de la red (cables, antenas, etc.).
4.6 No cometer ni ser parte de actividades de fraude o reventa del servicio.

5. CESIÓN, MODIFICACIÓN Y SUSPENSIÓN VOLUNTARIA
• CESIÓN: Para ceder el contrato, presente solicitud por escrito con la aceptación del nuevo titular. Respuesta en 15 días hábiles.
• MODIFICACIÓN: No se cobrarán servicios no aceptados expresamente. Solicitudes de cambio de plan con 3 días hábiles de antelación al corte.
• SUSPENSIÓN VOLUNTARIA: Derecho a suspender el servicio por máximo 2 meses al año. Si hay permanencia mínima, su vigencia se prorrogará por el tiempo de la suspensión.

6. PAGO, FACTURACIÓN Y REPORTE A CENTRALES
6.1 FACTURA: Llegará mínimo 5 días hábiles antes del pago. Si no llega, solicítela por nuestros canales.
6.2 MORA Y RECONEXIÓN: Suspensión al 5.º día de retraso. Costo de reconexión: $10.000. Reactivación en máximo 3 días hábiles tras el pago.
6.3 HABEAS DATA: Notificación de reporte negativo con 20 días calendario de anticipación (Leyes 1266 de 2008 y 2157 de 2021).
6.4 RECLAMACIONES: Quejas sobre la factura antes de la fecha de pago suspenden el cobro de la suma reclamada. PQR generales se resuelven en 15 días hábiles.

AUTORIZACIÓN DE TRATAMIENTO DE DATOS PERSONALES (Ley 1581 de 2008 y Decreto 1377 de 2013): EL SUSCRIPTOR autoriza a EL PROVEEDOR a recolectar, almacenar y usar sus datos personales para la prestación, facturación y gestión del servicio, así como para el reporte a centrales de información conforme a las Leyes 1266 de 2008 y 2157 de 2021, previa notificación cuando corresponda.

Este documento presta MÉRITO EJECUTIVO para el cobro de todas las obligaciones aquí contraídas (art. 422 del Código General del Proceso).

ACEPTACIÓN ELECTRÓNICA: De conformidad con la Ley 527 de 1999 y el Decreto 2364 de 2012, la aceptación digital de la presente acta por parte de EL SUSCRIPTOR tiene plena validez jurídica y equivale a su firma. Se deja constancia de la fecha, hora, dirección IP y dispositivo desde el cual se otorga la aceptación.

Aceptado en ${city}, el ${fecha}.
EL SUSCRIPTOR: ${name} — ${doc}.
Documento propiedad de ${PROVIDER.name}, enseña ${PROVIDER.brand}. Prohibida su alteración o modificación por cualquier medio.`;
}

/** SHA-256 hex del texto exacto aceptado. */
export function hashContent(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export default { CONTRACT_CODE, CONTRACT_VERSION, renderContract, hashContent };
