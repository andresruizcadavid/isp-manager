// Public, auth-free route for the payment-reminder (Aviso) interstitial.
//
//   GET  /api/v1/public/aviso/:token           → { name, amountCop, dueDate, checkoutUrl, brand, noDebt }
//   POST /api/v1/public/aviso/:token/continuar  → grants temporary browsing (AvisoOK, timeout)
//
// Same stable HMAC token as /suspendido. Per-token in-memory rate limit.

import { Router } from 'express';
import { getAvisoInfo, grantAvisoAccess } from '../services/aviso-portal.service.js';

const router = Router();

const RL_WINDOW_MS = 60_000;
const RL_MAX_HITS  = 30;
const rateMap = new Map();
function rateLimit(req, res, next) {
  const tok = req.params.token;
  if (!tok) return next();
  const now = Date.now();
  let bucket = rateMap.get(tok);
  if (!bucket || (now - bucket.windowStart) > RL_WINDOW_MS) { bucket = { count: 0, windowStart: now }; rateMap.set(tok, bucket); }
  bucket.count += 1;
  if (bucket.count > RL_MAX_HITS) return res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' } });
  if (rateMap.size > 5000) { for (const [k, v] of rateMap) { if ((now - v.windowStart) > RL_WINDOW_MS) rateMap.delete(k); } }
  next();
}

const TOKEN_RE = /^[A-Za-z0-9]+_[a-f0-9]{16}$/;
function validateTokenParam(req, res, next) {
  if (!TOKEN_RE.test(req.params.token || '')) return res.status(404).json({ success: false, error: { code: 'TOKEN_NOT_FOUND', message: 'Enlace inválido.' } });
  next();
}

function sendErr(res, e) {
  const status = Number.isInteger(e.status) ? e.status : 500;
  if (status >= 500) console.error('[public.aviso]', e);
  res.status(status).json({ success: false, error: { code: e.code || 'UNEXPECTED', message: e.message || 'Error inesperado' } });
}

router.get('/:token', validateTokenParam, rateLimit, async (req, res) => {
  try { res.json({ success: true, data: await getAvisoInfo(req.params.token) }); }
  catch (e) { sendErr(res, e); }
});

router.post('/:token/continuar', validateTokenParam, rateLimit, async (req, res) => {
  try { res.json({ success: true, data: await grantAvisoAccess(req.params.token) }); }
  catch (e) { sendErr(res, e); }
});

export default router;
