// Suspended-client captive portal — token + info service.
//
// The MikroTik web-proxy (port 999) redirects a suspended client's HTTP
// traffic to app.internetonline.co/suspendido/<token>. The token must be
// STABLE because it lives baked into the router's /ip/proxy/access rules, so
// we derive it deterministically from the clientId with an HMAC (no DB column,
// no migration, non-forgeable, stable forever).
//
//   token = <clientId>_<hmacHex16>
//
// verifyToken() recomputes the signature and compares in constant time.

import crypto from 'crypto';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';
import { BRAND } from '../config/brand.js';
import { debtPayLinkForClient } from './client-update-token.service.js';

const SECRET = env.JWT_SECRET;

/** @param {string} clientId */
function sign(clientId) {
  return crypto.createHmac('sha256', SECRET).update(`suspended:${clientId}`).digest('hex').slice(0, 16);
}

/** Stable per-client captive-portal token. @param {string} clientId */
export function makeToken(clientId) {
  return `${clientId}_${sign(clientId)}`;
}

/** Returns the clientId if the token is valid, else null. @param {string} token */
export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const i = token.lastIndexOf('_');
  if (i <= 0) return null;
  const clientId = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = sign(clientId);
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  return clientId;
}

/**
 * Everything the captive page needs: client name, current debt amount and a
 * (reused/created) Wompi checkout link. Throws { code, status } on bad token /
 * missing client. If the client has NO debt, returns { noDebt: true } instead
 * of throwing so the page can show a friendly "estás al día" message.
 * @param {string} token
 */
export async function getSuspendedInfo(token) {
  const clientId = verifyToken(token);
  if (!clientId) { const e = new Error('Enlace inválido'); e.code = 'TOKEN_NOT_FOUND'; e.status = 404; throw e; }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, status: true }
  });
  if (!client) { const e = new Error('Cliente no encontrado'); e.code = 'CLIENT_NOT_FOUND'; e.status = 404; throw e; }

  // Trazabilidad: registrar la vista de la página de suspensión (best-effort).
  prisma.client.update({ where: { id: clientId }, data: { suspendedViews: { increment: 1 }, suspendedViewedAt: new Date() } }).catch(() => {});

  const brand = {
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

  try {
    const pay = await debtPayLinkForClient(clientId, {
      redirectUrl: `${(env.FRONTEND_URL || '').replace(/\/+$/, '')}/suspendido/${token}?pago=ok`
    });
    return {
      name: client.name,
      status: client.status,
      suspended: client.status === 'SUSPENDED',
      noDebt: false,
      amountCop: pay.amountCop,
      invoiceNumber: pay.invoiceNumber,
      checkoutUrl: pay.checkoutUrl,
      brand
    };
  } catch (e) {
    // NO_DEBT is not an error for this page — the client is up to date.
    if (e.code === 'NO_DEBT') {
      return { name: client.name, status: client.status, suspended: client.status === 'SUSPENDED', noDebt: true, brand };
    }
    throw e;
  }
}
