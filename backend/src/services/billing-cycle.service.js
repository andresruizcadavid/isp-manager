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

const STATUS_DRAFT  = 'draft';
const STATUS_ACTIVE = 'active';
const STATUS_CLOSED = 'closed';

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
