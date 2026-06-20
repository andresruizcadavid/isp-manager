import { prisma } from '../config/database.js';

/**
 * Ajustes de notificaciones a clientes — el ÚNICO gobernador de los envíos
 * cliente-facing. Todo envío a un cliente (cron, transaccional o manual) debe
 * pasar por isEnabled(type, channel). Si el tipo está deshabilitado o su canal
 * apagado, el envío se omite.
 *
 * Filosofía de seed: replicar el comportamiento ACTUAL (todo habilitado, ambos
 * canales) para no romper nada al desplegar. El operador ajusta luego desde la
 * UI. seedDefaults() es idempotente y NUNCA sobreescribe lo que el operador
 * haya cambiado (create-only).
 */

// Catálogo de tipos + valores por defecto (= comportamiento actual). `schedule`
// es la periodicidad para los tipos basados en cron; null = disparado por evento.
export const NOTIFY_DEFAULTS = {
  WELCOME:              { enabled: true, email: true, whatsapp: true, schedule: null,
                          label: 'Bienvenida', desc: 'Al crear un cliente nuevo.' },
  INVOICE_GENERATED:    { enabled: true, email: true, whatsapp: true, schedule: null,
                          label: 'Factura generada', desc: 'Cuando se emite una factura.' },
  PAYMENT_REMINDER:     { enabled: true, email: true, whatsapp: true, schedule: { times: ['09:00', '18:00'] },
                          label: 'Recordatorio de pago', desc: 'Recordatorios de factura por vencer/vencida.' },
  DEBTOR:               { enabled: true, email: true, whatsapp: true, schedule: { times: ['10:00', '18:00'], dayOfMonthFrom: 25 },
                          label: 'Aviso de mora (día 25→fin de mes)', desc: 'Campaña de morosos al cierre del ciclo.' },
  OVERDUE_WARNING:      { enabled: true, email: true, whatsapp: true, schedule: { times: ['18:00'] },
                          label: 'Aviso de vencimiento', desc: 'Avisos finales de servicio por vencimiento.' },
  PAYMENT_CONFIRMATION: { enabled: true, email: true, whatsapp: true, schedule: null,
                          label: 'Confirmación de pago', desc: 'Al registrarse un pago.' },
  SERVICE_SUSPENSION:   { enabled: true, email: true, whatsapp: true, schedule: null,
                          label: 'Servicio suspendido', desc: 'Al suspender el servicio.' },
  SERVICE_ACTIVATION:   { enabled: true, email: true, whatsapp: true, schedule: null,
                          label: 'Servicio reactivado', desc: 'Al reactivar el servicio.' },
  PASSWORD_RESET:       { enabled: true, email: true, whatsapp: false, schedule: null, security: true,
                          label: 'Restablecer contraseña (portal)', desc: '⚠️ Si lo apagas, los clientes no podrán recuperar su contraseña.' },
  SELF_SERVICE_LINK:    { enabled: true, email: true, whatsapp: true, schedule: null, security: true,
                          label: 'Link de actualización de datos', desc: '⚠️ Si lo apagas, no podrás enviar links de autoservicio.' },
};

const TTL_MS = 30_000;
let _cache = null;        // Map<type, row>
let _cacheAt = 0;

function invalidate() { _cache = null; _cacheAt = 0; }

async function loadAll() {
  if (_cache && Date.now() - _cacheAt < TTL_MS) return _cache;
  const rows = await prisma.notificationSetting.findMany();
  _cache = new Map(rows.map(r => [r.type, r]));
  _cacheAt = Date.now();
  return _cache;
}

/** Devuelve la fila de ajustes (o el default si aún no se ha sembrado). */
async function getSetting(type) {
  const map = await loadAll();
  if (map.has(type)) return map.get(type);
  const d = NOTIFY_DEFAULTS[type];
  return d ? { type, enabled: d.enabled, email: d.email, whatsapp: d.whatsapp, schedule: d.schedule } : null;
}

/**
 * Gate central. ¿Se puede enviar este tipo por este canal?
 * Falla "abierto" hacia el default del catálogo si el tipo no existe en DB
 * (para no bloquear silenciosamente algo aún no sembrado). Un tipo DESCONOCIDO
 * (no catalogado) se permite (no es cliente-facing gobernado).
 */
async function isEnabled(type, channel = 'EMAIL') {
  if (!type) return true;
  const s = await getSetting(type);
  if (!s) return true; // tipo no gobernado
  if (!s.enabled) return false;
  if (channel === 'EMAIL')    return s.email !== false;
  if (channel === 'WHATSAPP') return s.whatsapp !== false;
  return true;
}

/** Periodicidad (schedule JSON) de un tipo, con fallback al default. */
async function getSchedule(type) {
  const s = await getSetting(type);
  return s?.schedule ?? NOTIFY_DEFAULTS[type]?.schedule ?? null;
}

/**
 * Crea las filas faltantes con los defaults (= comportamiento actual). NO
 * sobreescribe filas existentes (respeta lo que el operador haya cambiado).
 */
async function seedDefaults() {
  for (const [type, d] of Object.entries(NOTIFY_DEFAULTS)) {
    await prisma.notificationSetting.upsert({
      where: { type },
      update: {}, // create-only
      create: { type, enabled: d.enabled, email: d.email, whatsapp: d.whatsapp, schedule: d.schedule ?? undefined }
    }).catch(err => console.error(`[notif-settings] seed ${type} falló: ${err.message}`));
  }
  invalidate();
}

/** Lista para la UI: merge de defaults (label/desc/security) + valores en DB. */
async function listForUi() {
  const map = await loadAll();
  return Object.entries(NOTIFY_DEFAULTS).map(([type, d]) => {
    const row = map.get(type);
    return {
      type,
      label: d.label,
      desc: d.desc,
      security: !!d.security,
      hasSchedule: d.schedule !== null,
      enabled:  row ? row.enabled  : d.enabled,
      email:    row ? row.email    : d.email,
      whatsapp: row ? row.whatsapp : d.whatsapp,
      schedule: row ? (row.schedule ?? d.schedule) : d.schedule,
    };
  });
}

export const notificationSettings = {
  isEnabled, getSchedule, getSetting, seedDefaults, listForUi, invalidate,
};
