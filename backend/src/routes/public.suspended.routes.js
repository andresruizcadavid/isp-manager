// Public, auth-free route for the suspended-client captive portal.
//
//   GET /api/v1/public/suspended/:token → { name, amountCop, invoiceNumber,
//                                            checkoutUrl, brand, suspended, noDebt }
//
// Keyed by a stable HMAC token (see suspended-portal.service.js). No session,
// no cookies. Per-token in-memory rate limit mirrors the client-updates route.

import { Router } from 'express';
import { getSuspendedInfo } from '../services/suspended-portal.service.js';

const router = Router();

// ── Rate limit: 30 hits / minute / token (in-memory leaky bucket) ──────
const RL_WINDOW_MS = 60_000;
const RL_MAX_HITS  = 30;
const rateMap = new Map();
function rateLimit(req, res, next) {
  const tok = req.params.token;
  if (!tok) return next();
  const now = Date.now();
  let bucket = rateMap.get(tok);
  if (!bucket || (now - bucket.windowStart) > RL_WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    rateMap.set(tok, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RL_MAX_HITS) {
    return res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' } });
  }
  if (rateMap.size > 5000) {
    for (const [k, v] of rateMap) { if ((now - v.windowStart) > RL_WINDOW_MS) rateMap.delete(k); }
  }
  next();
}

// Token shape: <cuid>_<hex16> → alnum + single underscore.
const TOKEN_RE = /^[A-Za-z0-9]+_[a-f0-9]{16}$/;
function validateTokenParam(req, res, next) {
  if (!TOKEN_RE.test(req.params.token || '')) {
    return res.status(404).json({ success: false, error: { code: 'TOKEN_NOT_FOUND', message: 'Enlace inválido.' } });
  }
  next();
}

router.get('/:token', validateTokenParam, rateLimit, async (req, res) => {
  try {
    const data = await getSuspendedInfo(req.params.token);
    res.json({ success: true, data });
  } catch (e) {
    const status  = Number.isInteger(e.status) ? e.status : 500;
    if (status >= 500) console.error('[public.suspended]', e);
    res.status(status).json({ success: false, error: { code: e.code || 'UNEXPECTED', message: e.message || 'Error inesperado' } });
  }
});

export default router;
