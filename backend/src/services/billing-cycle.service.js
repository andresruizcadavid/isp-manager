// BillingCycle — CRUD + clasificador de buckets de clientes.
//
// El clasificador NO muta nada. Solo devuelve los conteos y, si se pide,
// los clientId por bucket. Si quieren convertir "suspendible" en suspensión
// real, eso es una acción manual del operador desde el detalle del cliente.
//
// Buckets:
//   • alDia             — sin facturas abiertas en el período del ciclo
//   • dentroDeVentana   — tiene factura abierta y hoy ∈ [collectionStart, collectionEnd]
//   • vencido           — tiene factura abierta y hoy > collectionEnd
//                         pero ≤ collectionEnd + moraGraceDays
//   • mora              — tiene factura abierta y hoy > collectionEnd + moraGraceDays
//   • suspendible       — subconjunto de `mora` SI el ciclo tiene
//                         autoSuspendEnabled=true. Es una etiqueta, NO un
//                         estado mutado.
//
// "Factura abierta" = status ∈ {PENDING, OVERDUE, PARTIAL} con balanceDue > 0
// emitida para el período (year, month) del ciclo.

import { prisma } from '../config/database.js';
import { getValue, setValue } from './system-config.service.js';

const STATUS_DRAFT  = 'draft';
const STATUS_ACTIVE = 'active';
const STATUS_CLOSED = 'closed';

// ── Regla de ciclo recurrente ────────────────────────────────────────
// Una plantilla ÚNICA (guardada en SystemConfig como JSON) expresada en
// DÍAS del mes, que el sistema materializa a un BillingCycle concreto por
// cada mes. Evita crear cada ciclo a mano. Los ciclos manuales existentes
// mandan: la regla solo llena los meses que aún no tienen ciclo.
const RULE_KEY = 'billing_cycle_rule';
const DEFAULT_RULE = Object.freeze({
  enabled:            false,
  startDay:           25,               // día de inicio de cobro (1..31, se ajusta al mes)
  endMode:            'end-of-month',   // 'end-of-month' | 'day-of-month'
  endDay:            null,              // usado solo si endMode='day-of-month'
  moraGraceDays:      7,
  autoSuspendEnabled: false
});

/** @param {number} y @param {number} m 1..12 → días del mes */
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

/** Lee la regla (con defaults si nunca se guardó). */
export async function getRule() {
  const saved = await getValue(RULE_KEY);
  return { ...DEFAULT_RULE, ...(saved && typeof saved === 'object' ? saved : {}) };
}

/** Valida + guarda la regla. Devuelve la regla normalizada. */
export async function saveRule(input) {
  const clamp = (/** @type {number} */ n, /** @type {number} */ lo, /** @type {number} */ hi) =>
    Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));
  const endMode = input.endMode === 'day-of-month' ? 'day-of-month' : 'end-of-month';
  const rule = {
    enabled:            !!input.enabled,
    startDay:           clamp(input.startDay ?? 25, 1, 31),
    endMode,
    endDay:             endMode === 'day-of-month' ? clamp(input.endDay ?? 1, 1, 31) : null,
    moraGraceDays:      clamp(input.moraGraceDays ?? 7, 0, 60),
    autoSuspendEnabled: !!input.autoSuspendEnabled
  };
  await setValue(RULE_KEY, rule, 'json');
  return rule;
}

/** Calcula las fechas concretas de un mes a partir de la regla.
 *  Usa mediodía UTC para que la fecha mostrada sea el día correcto en
 *  cualquier zona horaria (Colombia UTC-5). @param {any} rule */
export function materializeRuleForMonth(rule, year, month) {
  const dim = daysInMonth(year, month);
  const startDay = Math.min(Math.max(1, rule.startDay), dim);
  const start = new Date(Date.UTC(year, month - 1, startDay, 12, 0, 0));

  let end;
  if (rule.endMode === 'day-of-month' && rule.endDay) {
    if (rule.endDay < startDay) {
      // El fin cae en el mes siguiente (ej. inicia 20, vence 5 del próximo).
      const nm = month === 12 ? 1 : month + 1;
      const ny = month === 12 ? year + 1 : year;
      const ed = Math.min(rule.endDay, daysInMonth(ny, nm));
      end = new Date(Date.UTC(ny, nm - 1, ed, 12, 0, 0));
    } else {
      end = new Date(Date.UTC(year, month - 1, Math.min(rule.endDay, dim), 12, 0, 0));
    }
  } else {
    // Fin de mes = último día real del mes.
    end = new Date(Date.UTC(year, month - 1, dim, 12, 0, 0));
  }
  return { collectionStart: start, collectionEnd: end, moraGraceDays: rule.moraGraceDays, autoSuspendEnabled: rule.autoSuspendEnabled };
}

/** Materializa la regla en ciclos concretos para el mes actual y los
 *  próximos `monthsAhead`. No pisa ciclos existentes. Si no hay ningún
 *  ciclo activo, activa el del mes en curso (para que "adopte" la regla
 *  sin trabajo manual). @param {{monthsAhead?:number, now?:Date, createdById?:string|null}} opts */
export async function ensureCyclesFromRule({ monthsAhead = 1, now = new Date(), createdById = null } = {}) {
  const rule = await getRule();
  if (!rule.enabled) return { enabled: false, created: [], skipped: [] };

  const created = [];
  const skipped = [];
  const base = new Date(now);
  for (let i = 0; i <= monthsAhead; i++) {
    const y = base.getFullYear();
    const m = base.getMonth() + 1 + i;               // 1-based, puede exceder 12
    const year  = y + Math.floor((m - 1) / 12);
    const month = ((m - 1) % 12) + 1;

    const existing = await prisma.billingCycle.findUnique({ where: { year_month: { year, month } } });
    if (existing) { skipped.push({ year, month, id: existing.id }); continue; }

    const dates = materializeRuleForMonth(rule, year, month);
    const row = await prisma.billingCycle.create({
      data: {
        year, month,
        collectionStart:    dates.collectionStart,
        collectionEnd:      dates.collectionEnd,
        moraGraceDays:      dates.moraGraceDays,
        status:             STATUS_DRAFT,
        autoSuspendEnabled: dates.autoSuspendEnabled,
        notes:              'Generado por la regla de ciclo recurrente',
        createdById
      }
    });
    created.push(row);
  }

  // Si no hay ciclo activo, activa el del mes en curso (recién creado o previo).
  const active = await findActive();
  if (!active) {
    const cy = base.getFullYear();
    const cm = base.getMonth() + 1;
    const current = await prisma.billingCycle.findUnique({ where: { year_month: { year: cy, month: cm } } });
    if (current && current.status === STATUS_DRAFT) {
      await prisma.billingCycle.update({ where: { id: current.id }, data: { status: STATUS_ACTIVE } });
    }
  }

  return { enabled: true, created, skipped };
}

export async function listCycles() {
  return prisma.billingCycle.findMany({
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    include: { createdBy: { select: { id: true, name: true, email: true } } }
  });
}

export async function getCycle(id) {
  return prisma.billingCycle.findUnique({
    where: { id },
    include: { createdBy: { select: { id: true, name: true, email: true } } }
  });
}

export async function findActive() {
  return prisma.billingCycle.findFirst({
    where: { status: STATUS_ACTIVE },
    orderBy: [{ year: 'desc' }, { month: 'desc' }]
  });
}

/**
 * Create a new cycle in draft. Refuses duplicates on (year, month).
 */
export async function createCycle(data, createdById = null) {
  return prisma.billingCycle.create({
    data: {
      year:               data.year,
      month:              data.month,
      collectionStart:    new Date(data.collectionStart),
      collectionEnd:      new Date(data.collectionEnd),
      moraGraceDays:      data.moraGraceDays ?? 7,
      status:             data.status || STATUS_DRAFT,
      autoSuspendEnabled: !!data.autoSuspendEnabled,
      notes:              data.notes || null,
      createdById
    }
  });
}

export async function updateCycle(id, patch) {
  // Closed cycles are read-only — surface a clean error rather than letting
  // the operator silently mutate history.
  const current = await prisma.billingCycle.findUnique({ where: { id } });
  if (!current) throw new Error('Ciclo no encontrado');
  if (current.status === STATUS_CLOSED) throw new Error('No se puede editar un ciclo cerrado');

  const data = {};
  if (patch.collectionStart    !== undefined) data.collectionStart    = new Date(patch.collectionStart);
  if (patch.collectionEnd      !== undefined) data.collectionEnd      = new Date(patch.collectionEnd);
  if (patch.moraGraceDays      !== undefined) data.moraGraceDays      = Number(patch.moraGraceDays);
  if (patch.autoSuspendEnabled !== undefined) data.autoSuspendEnabled = !!patch.autoSuspendEnabled;
  if (patch.notes              !== undefined) data.notes              = patch.notes;
  // status changes go through dedicated handlers below to enforce invariants.
  const updated = await prisma.billingCycle.update({ where: { id }, data });

  // Keep invoices in sync with the cycle: when the operator changes the
  // collection dates, the period's OPEN invoices (not PAID/CANCELLED) follow —
  // dueDate ← collectionEnd, issueDate ← collectionStart. This is what makes
  // "Próximo vencimiento" on every client match the Ciclos de cobro config.
  // Paid invoices are history and are never touched.
  if (data.collectionEnd || data.collectionStart) {
    const sync = {};
    if (data.collectionEnd)   sync.dueDate   = data.collectionEnd;
    if (data.collectionStart) sync.issueDate = data.collectionStart;
    const r = await prisma.invoice.updateMany({
      where: {
        periodYear:  updated.year,
        periodMonth: updated.month,
        status:      { in: ['PENDING', 'OVERDUE', 'PARTIAL'] }
      },
      data: sync
    });
    updated.syncedInvoices = r.count;
    console.log(`[billing-cycle ${updated.year}-${updated.month}] fechas propagadas a ${r.count} factura(s) abierta(s) del período`);
  }

  return updated;
}

/** Activate a cycle. Demotes any other 'active' cycle to 'closed' first. */
export async function activateCycle(id) {
  const cycle = await prisma.billingCycle.findUnique({ where: { id } });
  if (!cycle) throw new Error('Ciclo no encontrado');
  if (cycle.status === STATUS_ACTIVE) return cycle;
  if (cycle.status === STATUS_CLOSED) throw new Error('No se puede reactivar un ciclo cerrado');

  return prisma.$transaction(async (tx) => {
    // At most one active cycle — demote previous ones.
    await tx.billingCycle.updateMany({
      where: { status: STATUS_ACTIVE, NOT: { id } },
      data:  { status: STATUS_CLOSED }
    });
    return tx.billingCycle.update({
      where: { id },
      data:  { status: STATUS_ACTIVE }
    });
  });
}

export async function closeCycle(id) {
  return prisma.billingCycle.update({
    where: { id },
    data:  { status: STATUS_CLOSED }
  });
}

export async function deleteCycle(id) {
  const cycle = await prisma.billingCycle.findUnique({ where: { id } });
  if (!cycle) return null;
  if (cycle.status !== STATUS_DRAFT) throw new Error('Solo se pueden eliminar ciclos en borrador');
  return prisma.billingCycle.delete({ where: { id } });
}

/**
 * Classify clients into buckets for the given cycle.
 *
 *   • Solo cuenta clientes con plan NO gratuito (plan.isFree=false / null).
 *   • Solo considera invoices del período (year, month) del ciclo.
 *   • now = Date inyectable para tests; default Date.now()
 *
 * Returns:
 *   {
 *     cycleId, period: { year, month },
 *     totals: { alDia, dentroDeVentana, vencido, mora, suspendible, totalConsiderados },
 *     phase:  'before' | 'window' | 'overdue' | 'mora' | 'after'
 *   }
 */
export async function classifyClients(cycleId, { now = new Date() } = {}) {
  const cycle = await prisma.billingCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) return null;

  // Drop the hour component for date-arithmetic predictability.
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const start = new Date(cycle.collectionStart); start.setHours(0, 0, 0, 0);
  const end   = new Date(cycle.collectionEnd);   end.setHours(23, 59, 59, 999);
  const moraStart = new Date(end);
  moraStart.setDate(moraStart.getDate() + cycle.moraGraceDays);

  // Phase = where "today" sits on the cycle timeline. Useful for UI.
  let phase;
  if      (today < start)     phase = 'before';
  else if (today <= end)      phase = 'window';
  else if (today <= moraStart) phase = 'overdue';
  else                        phase = 'mora';

  // Clients NOT on a free plan. The ones on free plans are excluded by spec.
  const clients = await prisma.client.findMany({
    where: {
      OR: [{ planId: null }, { plan: { isFree: false } }]
    },
    select: {
      id: true, name: true,
      invoices: {
        where: {
          periodYear: cycle.year,
          periodMonth: cycle.month,
          status:     { in: ['PENDING', 'OVERDUE', 'PARTIAL'] },
          balanceDue: { gt: 0 }
        },
        select: { id: true, balanceDue: true, dueDate: true, status: true }
      }
    }
  });

  const buckets = {
    alDia:           [],
    dentroDeVentana: [],
    vencido:         [],
    mora:            [],
    suspendible:     []
  };

  for (const c of clients) {
    const hasOpenInvoice = c.invoices.length > 0;
    if (!hasOpenInvoice) {
      buckets.alDia.push(c);
      continue;
    }
    if (today >= start && today <= end) {
      buckets.dentroDeVentana.push(c);
    } else if (today > end && today <= moraStart) {
      buckets.vencido.push(c);
    } else if (today > moraStart) {
      buckets.mora.push(c);
      // Suspendible es una ETIQUETA derivada: la mora del ciclo +
      // el toggle del operador. NO mutamos el cliente.
      if (cycle.autoSuspendEnabled) buckets.suspendible.push(c);
    } else {
      // today < start AND tiene factura abierta — la factura quedó
      // pendiente de un período anterior. Lo dejamos en "vencido" para
      // que el operador lo vea, sin mezclarlo con mora del ciclo actual.
      buckets.vencido.push(c);
    }
  }

  return {
    cycleId: cycle.id,
    period:  { year: cycle.year, month: cycle.month },
    phase,
    autoSuspendEnabled: cycle.autoSuspendEnabled,
    totals: {
      alDia:             buckets.alDia.length,
      dentroDeVentana:   buckets.dentroDeVentana.length,
      vencido:           buckets.vencido.length,
      mora:              buckets.mora.length,
      suspendible:       buckets.suspendible.length,
      totalConsiderados: clients.length
    },
    // El detalle se devuelve solo cuando se pide explícitamente para
    // mantener la respuesta liviana en el listado.
    buckets
  };
}
