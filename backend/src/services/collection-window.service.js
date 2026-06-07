// Collection windows — CRUD + helpers used by the FASE 4 cron.
//
// `findActiveNow()` returns the single window currently in flight
// (isActive=true AND now ∈ [startDate, endDate]). The cron only acts
// when this returns a non-null row, so disabling auto-collection is
// just flipping `isActive` from the UI.

import { prisma } from '../config/database.js';

export async function listWindows() {
  return prisma.collectionWindow.findMany({
    orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
    include: { createdBy: { select: { id: true, name: true, email: true } } }
  });
}

export async function getWindow(id) {
  return prisma.collectionWindow.findUnique({
    where: { id },
    include: { createdBy: { select: { id: true, name: true, email: true } } }
  });
}

export async function createWindow(data, createdById = null) {
  return prisma.collectionWindow.create({
    data: {
      name:               data.name,
      startDate:          new Date(data.startDate),
      endDate:            new Date(data.endDate),
      targetStatuses:     data.targetStatuses || ['PENDING','OVERDUE'],
      channels:           data.channels       || ['EMAIL'],
      sendFrequencyHours: data.sendFrequencyHours ?? 24,
      messageTemplate:    data.messageTemplate || undefined,
      isActive:           data.isActive ?? true,
      createdById
    },
    include: { createdBy: { select: { id: true, name: true, email: true } } }
  });
}

export async function updateWindow(id, data) {
  const patch = {};
  if (data.name              !== undefined) patch.name               = data.name;
  if (data.startDate         !== undefined) patch.startDate          = new Date(data.startDate);
  if (data.endDate           !== undefined) patch.endDate            = new Date(data.endDate);
  if (data.targetStatuses    !== undefined) patch.targetStatuses     = data.targetStatuses;
  if (data.channels          !== undefined) patch.channels           = data.channels;
  if (data.sendFrequencyHours!== undefined) patch.sendFrequencyHours = data.sendFrequencyHours;
  if (data.messageTemplate   !== undefined) patch.messageTemplate    = data.messageTemplate;
  if (data.isActive          !== undefined) patch.isActive           = data.isActive;
  return prisma.collectionWindow.update({ where: { id }, data: patch });
}

export async function deleteWindow(id) {
  return prisma.collectionWindow.delete({ where: { id } });
}

/** Find the active window covering `now`. Returns null if none. */
export async function findActiveNow(now = new Date()) {
  return prisma.collectionWindow.findFirst({
    where: {
      isActive:  true,
      startDate: { lte: now },
      endDate:   { gte: now }
    },
    orderBy: { startDate: 'desc' }
  });
}

/**
 * Compute metrics for one window:
 *   • invitedCount   — distinct debtors that received at least one
 *                      notification during the window (proxy for "in scope")
 *   • sentCount      — total successful sends within the window
 *   • sentByChannel  — breakdown
 *   • failedCount    — failed sends
 *   • paidCount      — distinct clients that made a COMPLETED payment
 *                      between window.startDate and min(now, window.endDate)
 *                      AND who appeared in invitedCount (true conversions)
 *   • paidAmount     — sum of those payments (cents)
 *   • conversionPct  — paidCount / invitedCount * 100, rounded
 */
export async function getWindowMetrics(id) {
  const w = await prisma.collectionWindow.findUnique({ where: { id } });
  if (!w) return null;

  const now = new Date();
  const upper = w.endDate < now ? w.endDate : now;

  // Sent log within the window for THIS campaign.
  const logs = await prisma.notificationLog.findMany({
    where: {
      campaignId: id,
      createdAt:  { gte: w.startDate, lte: upper }
    },
    select: { clientId: true, status: true, channel: true }
  });
  const invitedSet = new Set(logs.map(l => l.clientId).filter(Boolean));
  const sentByChannel = {};
  let sentCount = 0, failedCount = 0;
  for (const l of logs) {
    if (l.status === 'sent') {
      sentCount++;
      sentByChannel[l.channel] = (sentByChannel[l.channel] || 0) + 1;
    } else {
      failedCount++;
    }
  }

  // Payments during the window from invited clients.
  let paidCount = 0, paidAmount = 0;
  if (invitedSet.size > 0) {
    const payments = await prisma.payment.findMany({
      where: {
        status:    'COMPLETED',
        clientId:  { in: [...invitedSet] },
        createdAt: { gte: w.startDate, lte: upper }
      },
      select: { clientId: true, amount: true }
    });
    const payersSet = new Set();
    for (const p of payments) {
      payersSet.add(p.clientId);
      paidAmount += (p.amount || 0);
    }
    paidCount = payersSet.size;
  }

  return {
    invitedCount: invitedSet.size,
    sentCount,
    sentByChannel,
    failedCount,
    paidCount,
    paidAmount,
    conversionPct: invitedSet.size > 0 ? Math.round((paidCount / invitedSet.size) * 100) : 0
  };
}
