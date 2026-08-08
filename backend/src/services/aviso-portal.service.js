// Aviso (recordatorio de pago) — portal interstitial.
//
// A diferencia de /suspendido (Moroso, servicio cortado), el Aviso es un
// recordatorio: el cliente TIENE servicio y, tras ver la página con la cuenta
// regresiva, puede "Continuar" y seguir navegando. El "Continuar" agrega su IP
// a la address-list `AvisoOK` con timeout en el router (RouterOS la vence sola)
// → nag diario hasta que pague, sin cron.
//
// Reusa el mismo token HMAC por cliente que /suspendido (verifyToken).

import { env } from '../config/env.js';
import { prisma } from '../config/database.js';
import { BRAND } from '../config/brand.js';
import { verifyToken } from './suspended-portal.service.js';
import { debtPayLinkForClient } from './client-update-token.service.js';
import { getMikrotikServiceForClient, collectionLists } from './mikrotik.service.js';

export const AVISO_OK_TIMEOUT = '1d'; // navegación libre tras reconocer el aviso

function brandBlock() {
  return {
    name: BRAND.name,
    tagline: BRAND.tagline,
    phone: BRAND.phone,
    phoneRaw: BRAND.phoneRaw,
    whatsapp: BRAND.whatsapp,
    whatsappRaw: BRAND.whatsappRaw,
    nequi: BRAND.nequi,
    nequiRaw: BRAND.nequiRaw,
    web: BRAND.web,
    navy: BRAND.colors?.navy || '#16357E',
    gold: '#FDB913'
  };
}

/**
 * Datos que la página de aviso necesita: nombre, monto, fecha de vencimiento y
 * checkout WOMPI. Si no hay deuda devuelve { noDebt:true }.
 * @param {string} token
 */
export async function getAvisoInfo(token) {
  const clientId = verifyToken(token);
  if (!clientId) { const e = new Error('Enlace inválido'); e.code = 'TOKEN_NOT_FOUND'; e.status = 404; throw e; }

  const client = await prisma.client.findUnique({
    where: { id: clientId }, select: { id: true, name: true, status: true }
  });
  if (!client) { const e = new Error('Cliente no encontrado'); e.code = 'CLIENT_NOT_FOUND'; e.status = 404; throw e; }

  // Trazabilidad: registrar la vista de la página de aviso (best-effort).
  prisma.client.update({ where: { id: clientId }, data: { avisoViews: { increment: 1 }, avisoViewedAt: new Date() } }).catch(() => {});

  // Vencimiento de la factura abierta más antigua (informativo).
  const oldest = await prisma.invoice.findFirst({
    where: { clientId, status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] }, balanceDue: { gt: 0 } },
    orderBy: { dueDate: 'asc' },
    select: { dueDate: true }
  });

  try {
    const pay = await debtPayLinkForClient(clientId, {
      redirectUrl: `${(env.FRONTEND_URL || '').replace(/\/+$/, '')}/aviso/${token}?pago=ok`
    });
    return {
      name: client.name,
      noDebt: false,
      amountCop: pay.amountCop,
      invoiceNumber: pay.invoiceNumber,
      dueDate: oldest?.dueDate || null,
      checkoutUrl: pay.checkoutUrl,
      brand: brandBlock()
    };
  } catch (e) {
    if (e.code === 'NO_DEBT') return { name: client.name, noDebt: true, brand: brandBlock() };
    throw e;
  }
}

/**
 * "Continuar": habilita al cliente a navegar por AVISO_OK_TIMEOUT agregando su
 * IP a `AvisoOK` (con timeout) en el router. Best-effort: si el router no
 * responde, igual devolvemos ok para no atrapar al cliente en la página.
 * @param {string} token
 */
export async function grantAvisoAccess(token) {
  const clientId = verifyToken(token);
  if (!clientId) { const e = new Error('Enlace inválido'); e.code = 'TOKEN_NOT_FOUND'; e.status = 404; throw e; }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: { mikrotikAccount: { select: { username: true, remoteAddress: true } } }
  });
  if (!client) { const e = new Error('Cliente no encontrado'); e.code = 'CLIENT_NOT_FOUND'; e.status = 404; throw e; }

  const ip = (client.mikrotikAccount?.remoteAddress || '').split('/')[0];
  if (!ip) return { granted: false, reason: 'no_ip' };

  try {
    const { service, router } = await getMikrotikServiceForClient(clientId);
    // #3: recurrencia configurable (default 1d). Menor timeout = nag más seguido.
    const { getValue } = await import('./system-config.service.js');
    let timeout = await getValue('aviso_recurrence', AVISO_OK_TIMEOUT).catch(() => AVISO_OK_TIMEOUT);
    if (!['1d', '12h', '8h', '6h', '4h', '2h', '1h'].includes(timeout)) timeout = AVISO_OK_TIMEOUT;
    await service.addToAddressList({
      list: collectionLists(router).avisoOk,
      address: ip,
      comment: client.mikrotikAccount?.username || client.name,
      timeout
    });
    return { granted: true, timeout };
  } catch (e) {
    console.error('[aviso] grant failed:', e.message);
    return { granted: false, reason: 'router_unreachable' };
  }
}

/**
 * #5: al registrar un pago, levantar cobranza. SIEMPRE quita al cliente del
 * aviso; si además ya NO tiene deuda abierta, lo reactiva (quita de la lista de
 * corte, habilita PPPoE, status ACTIVE). Best-effort: nunca rompe el pago.
 * @param {string} clientId
 */
export async function liftCollectionOnPayment(clientId) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: { mikrotikAccount: { select: { username: true, remoteAddress: true } } }
  });
  const ip = (client?.mikrotikAccount?.remoteAddress || '').split('/')[0];
  if (!ip) return { skipped: true };

  const agg = await prisma.invoice.aggregate({
    where: { clientId, status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] }, balanceDue: { gt: 0 } },
    _sum: { balanceDue: true }
  });
  const debt = agg._sum.balanceDue || 0;
  const out = { debt, avisoCleared: false, reactivated: false };

  try {
    const { service, collectionService, collectionRouter } = await getMikrotikServiceForClient(clientId);
    const lists = collectionLists(collectionRouter);
    // Siempre: quitar del aviso EN EL ROUTER DE COBRANZA (ya pagó algo).
    await collectionService.removeFromAddressList({ list: lists.aviso, address: ip }).catch(() => {});
    await collectionService.removeFromAddressList({ list: lists.avisoOk, address: ip }).catch(() => {});
    out.avisoCleared = true;
    // Sin deuda → reactivar del todo (corte en cobranza, PPPoE en su router).
    if (debt === 0) {
      await collectionService.removeFromAddressList({ list: lists.moroso, address: ip }).catch(() => {});
      try { if (client.mikrotikAccount.username) await service.enablePPPoESecret(client.mikrotikAccount.username); } catch {}
      if (client.status === 'SUSPENDED') {
        await prisma.client.update({ where: { id: clientId }, data: { status: 'ACTIVE' } }).catch(() => {});
      }
      out.reactivated = true;
    }
  } catch (e) {
    out.error = e.message;
  }
  return out;
}
