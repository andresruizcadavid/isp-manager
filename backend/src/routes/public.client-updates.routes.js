// Public, auth-free routes for the customer self-service update flow.
//
// Three endpoints, all keyed by a single random `:token`:
//   GET    /api/v1/public/client-updates/:token            → load snapshot
//   PUT    /api/v1/public/client-updates/:token            → apply changes
//   POST   /api/v1/public/client-updates/:token/photos     → upload images
//
// SECURITY:
//   • Everything is keyed by the token — no session, no cookies, no JWT.
//   • The Zod whitelist mirrors UPDATABLE_FIELDS in the service. Anything
//     outside the schema is dropped before reaching the service layer.
//   • Per-token rate limit (in-memory leaky bucket) so a brute-force attempt
//     on the URL hits a wall fast. At single-instance scale that's enough;
//     if we ever scale out, swap for a Redis-backed limiter.
//   • Photo upload reuses the evidence multer config (5MB, image mime only).

import { Router } from 'express';
import multer    from 'multer';
import path      from 'path';
import fs        from 'fs';
import crypto    from 'crypto';
import { z }     from 'zod';
import { env }   from '../config/env.js';
import { prisma } from '../config/database.js';
import {
  lookupToken,
  applyUpdate,
  attachClientPhoto,
  notifyTechnician,
  getDebtPayLink,
  UPDATABLE_FIELDS
} from '../services/client-update-token.service.js';

const router = Router();

// ── Rate limit: 30 hits per minute per token ──────────────────────────
// In-memory map: token → { count, windowStart }. Cleared lazily when a
// new window starts. Pruned on insert if the map grows too big.
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
    return res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' }
    });
  }
  // Cheap pruning so the map doesn't grow unbounded if attacked.
  if (rateMap.size > 5000) {
    for (const [k, v] of rateMap) {
      if ((now - v.windowStart) > RL_WINDOW_MS) rateMap.delete(k);
    }
  }
  next();
}

// ── Token shape validation ────────────────────────────────────────────
// base64url of 32 bytes ≈ 43 chars, allowed alphabet: A-Z a-z 0-9 - _
const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;
function validateTokenParam(req, res, next) {
  if (!TOKEN_RE.test(req.params.token || '')) {
    return res.status(404).json({
      success: false,
      error: { code: 'TOKEN_NOT_FOUND', message: 'Enlace inválido o expirado.' }
    });
  }
  next();
}

// ── Payload schema (mirrors UPDATABLE_FIELDS) ─────────────────────────
const updatePayloadSchema = z.object({
  email:          z.string().email('Email inválido').max(120).optional().or(z.literal('')),
  phone:          z.string().max(40).optional().or(z.literal('')),
  address:        z.string().max(200).optional().or(z.literal('')),
  neighborhood:   z.string().max(120).optional().or(z.literal('')),
  city:           z.string().max(80).optional().or(z.literal('')),
  documentType:   z.enum(['CC', 'NIT', 'CE', 'TI', 'PAS']).optional(),
  documentNumber: z.string().max(40).optional().or(z.literal('')),
  coordinates:    z.string().max(80).optional().or(z.literal('')),
  // Aceptación del acta de servicios (obligatoria) + tratamiento de datos.
  acceptContract: z.boolean().optional(),
  acceptData:     z.boolean().optional(),
  contractVersion: z.string().max(40).optional()
}).strip(); // drop anything outside this shape

// ── Multer (reuse the same dir/limits as evidence routes) ─────────────
const evidenceDir = path.resolve(env.UPLOADS_PATH, 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
]);
const MAX_BYTES = 5 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, evidenceDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const id = crypto.randomBytes(12).toString('hex');
    cb(null, `${Date.now()}_${id}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 5 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('INVALID_MIME'));
    cb(null, true);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────
function clientIp(req) {
  // Behind a reverse proxy we'd trust X-Forwarded-For; standalone Express
  // exposes req.ip which already considers `trust proxy` setting. Keep
  // both fallbacks so it works locally and on the deployed box.
  return (req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
       || req.ip
       || req.socket?.remoteAddress
       || null);
}

function sendServiceError(res, e) {
  // Errors thrown by the service carry { code, status } we can forward.
  // Anything without status is a bug → 500.
  const status  = Number.isInteger(e.status) ? e.status : 500;
  const code    = e.code || 'UNEXPECTED';
  const message = e.message || 'Error inesperado';
  if (status >= 500) console.error('[public.client-updates]', e);
  return res.status(status).json({
    success: false,
    error: { code, message }
  });
}

// ── Routes ────────────────────────────────────────────────────────────

// GET /:token — public, returns the snapshot the form needs to render.
router.get('/:token', validateTokenParam, rateLimit, async (req, res) => {
  try {
    const data = await lookupToken(req.params.token, {
      ip:        clientIp(req),
      userAgent: req.headers['user-agent']
    });
    res.json({ success: true, data });
  } catch (e) {
    sendServiceError(res, e);
  }
});

// PUT /:token — public, customer submits updated fields. Single-use.
router.put('/:token', validateTokenParam, rateLimit, async (req, res) => {
  const parsed = updatePayloadSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION',
        message: 'Datos inválidos',
        details: parsed.error.flatten().fieldErrors
      }
    });
  }
  try {
    const { tokenRow, changes, previous } = await applyUpdate(req.params.token, parsed.data, {
      ip:        clientIp(req),
      userAgent: req.headers['user-agent']
    });

    // Reload the client so the notification has the post-update state and
    // any relations the technician notification might want.
    const fullClient = await prisma.client.findUnique({
      where: { id: tokenRow.clientId }
    });

    // Notify technician in background — don't block the customer's response
    // on a Telegram blip.
    notifyTechnician({
      tokenRow,
      client:   fullClient,
      changes,
      previous
    }).catch(err => console.error('[public.client-updates] notify failed:', err.message));

    res.json({
      success: true,
      data: {
        message: 'Datos actualizados correctamente',
        updated: Object.keys(changes)
      }
    });
  } catch (e) {
    sendServiceError(res, e);
  }
});

// POST /:token/pay — generate (idempotently) a Wompi payment link for the
// client's current debt so the customer can pay online. Creates an invoice
// from client.balance if none is open. No body needed.
router.post('/:token/pay', validateTokenParam, rateLimit, async (req, res) => {
  try {
    const data = await getDebtPayLink(req.params.token);
    res.json({ success: true, data });
  } catch (e) {
    sendServiceError(res, e);
  }
});

// POST /:token/photos — upload up to 5 images attached to the client.
// `type` field in the form switches between 'identity' (foto de cédula)
// and 'other' (cualquier otra). description is free-form, 200 chars max.
router.post('/:token/photos',
  validateTokenParam,
  rateLimit,
  (req, res) => {
    upload.array('files', 5)(req, res, async (mErr) => {
      if (mErr) {
        const msg = mErr.message === 'INVALID_MIME'
          ? 'Solo se aceptan imágenes (JPG, PNG, WEBP, HEIC).'
          : mErr.code === 'LIMIT_FILE_SIZE'
            ? 'Cada imagen debe pesar menos de 5 MB.'
            : 'No se pudo subir la imagen.';
        return res.status(400).json({ success: false, error: { code: 'UPLOAD_FAILED', message: msg } });
      }

      try {
        // We need the token to be still valid and the clientId behind it.
        const { tokenId } = await lookupToken(req.params.token, {
          ip:        clientIp(req),
          userAgent: req.headers['user-agent']
        });
        const tokenRow = await prisma.clientUpdateToken.findUnique({
          where: { id: tokenId },
          select: { clientId: true }
        });

        const type        = ['identity', 'other'].includes(req.body.type) ? req.body.type : 'other';
        const description = (req.body.description || '').slice(0, 200) || null;
        const files       = req.files || [];

        if (files.length === 0) {
          return res.status(400).json({
            success: false,
            error: { code: 'NO_FILES', message: 'Adjunta al menos una imagen.' }
          });
        }

        const rows = await Promise.all(files.map(f => attachClientPhoto({
          clientId:    tokenRow.clientId,
          tokenId,
          type,
          description,
          fileUrl:     `/uploads/evidence/${f.filename}`,
          fileName:    f.originalname,
          mimeType:    f.mimetype,
          sizeBytes:   f.size
        })));

        res.json({ success: true, data: { uploaded: rows.length, photos: rows } });
      } catch (e) {
        // If multer wrote files but the DB insert failed, clean them up so
        // we don't leak orphan files on disk.
        try {
          for (const f of req.files || []) {
            fs.unlink(path.join(evidenceDir, f.filename), () => {});
          }
        } catch { /* best-effort */ }
        sendServiceError(res, e);
      }
    });
  }
);

export default router;
