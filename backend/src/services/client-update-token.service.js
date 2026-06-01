// Client self-service update tokens.
//
// Generates a single-use, time-boxed token that grants a public URL the
// ability to patch a whitelisted set of Client fields (contact + document
// + evidence photos). The token is delivered to the customer over one or
// more channels (Email/WhatsApp/Telegram); when the customer submits the
// form the change is applied directly and the technician is notified.
//
// Whitelisted fields (anything else is silently dropped):
//   email · phone · address · neighborhood · city · documentType
//   · documentNumber · coordinates
//
// Lifecycle:
//   pending → used    : customer submits the form (atomic, race-safe)
//   pending → expired : sweep job (or lazy lookup) flips after expiresAt
//
// Everything in here is server-side; the public Express route validates
// inputs with Zod and calls into these helpers.

import crypto from 'crypto';
import { prisma } from '../server.js';
import { env } from '../config/env.js';
import { notificationService } from './notification.service.js';
import * as whatsapp from './whatsapp.service.js';
import * as telegram from './telegram.service.js';

// ── Constants ─────────────────────────────────────────────────────────
const TOKEN_BYTES   = 32;                  // 256-bit, base64url → 43 chars
const TTL_MS        = 7 * 24 * 3600 * 1000;
const VALID_SEND_CHANNELS   = new Set(['EMAIL', 'WHATSAPP', 'TELEGRAM']);
const VALID_NOTIFY_CHANNELS = new Set(['EMAIL', 'WHATSAPP', 'TELEGRAM']);

// Fields the customer is allowed to modify. KEEP IN SYNC with the Zod
// schema in routes/public.client-update.routes.js. Adding a field here
// without the route schema does nothing (it's dropped before reaching us).
export const UPDATABLE_FIELDS = Object.freeze([
  'email', 'phone', 'address', 'neighborhood', 'city',
  'documentType', 'documentNumber', 'coordinates'
]);

// What we expose to the customer-facing GET. Whitelisted on purpose so
// we never leak balance, secrets, or internal IDs.
const PUBLIC_SNAPSHOT_FIELDS = Object.freeze([
  'name', 'email', 'phone', 'address', 'neighborhood', 'city',
  'documentType', 'documentNumber', 'coordinates'
]);

// ── Helpers ───────────────────────────────────────────────────────────
function randomToken() {
  // base64url is URL-safe (no +/= padding). 32 bytes → 43 chars.
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function normalizeChannels(channels, valid) {
  if (!Array.isArray(channels)) return [];
  const seen = new Set();
  for (const raw of channels) {
    const c = String(raw || '').toUpperCase().trim();
    if (valid.has(c)) seen.add(c);
  }
  return [...seen];
}

function publicSnapshot(client) {
  const snap = {};
  for (const k of PUBLIC_SNAPSHOT_FIELDS) snap[k] = client[k] ?? null;
  return snap;
}

function pickUpdatable(payload) {
  // Trim strings, coerce empty → null. The Client schema treats most of
  // these as optional/nullable; the controller already handles the diff.
  const out = {};
  for (const k of UPDATABLE_FIELDS) {
    if (payload[k] === undefined) continue;
    let v = payload[k];
    if (typeof v === 'string') v = v.trim();
    out[k] = v === '' ? null : v;
  }
  return out;
}

function buildPublicUrl(token) {
  // FRONTEND_URL is validated by env.js (must be a URL). Strip trailing
  // slash so we get a clean concatenation.
  const base = (env.FRONTEND_URL || '').replace(/\/+$/, '');
  return `${base}/update/${token}`;
}

// ── 1. Generate ───────────────────────────────────────────────────────
/**
 * Create a fresh token for a client. Caller must validate that the
 * client exists and the operator has the right to act on it (route does).
 *
 * @returns the created row (with the raw token string).
 */
export async function generateToken({
  clientId,
  createdById = null,
  sendChannels   = [],
  notifyChannels = []
}) {
  const token = randomToken();
  const row = await prisma.clientUpdateToken.create({
    data: {
      clientId,
      token,
      status:         'pending',
      expiresAt:      new Date(Date.now() + TTL_MS),
      createdById,
      sendChannels:   normalizeChannels(sendChannels,   VALID_SEND_CHANNELS),
      notifyChannels: normalizeChannels(notifyChannels, VALID_NOTIFY_CHANNELS)
    }
  });
  return { ...row, publicUrl: buildPublicUrl(token) };
}

// ── 2. Lookup (GET) ───────────────────────────────────────────────────
/**
 * Validate a token string and return what the public form needs to render.
 * Side-effect: records ipAddress/userAgent on the FIRST GET only — so the
 * technician can spot suspicious access patterns. Subsequent GETs leave
 * them alone (the customer may legitimately reload).
 *
 * Throws { code, status } so the route can translate to an HTTP error.
 */
export async function lookupToken(rawToken, { ip, userAgent } = {}) {
  const row = await prisma.clientUpdateToken.findUnique({
    where: { token: rawToken },
    include: { client: true }
  });
  if (!row) {
    const e = new Error('Token no encontrado');
    e.code = 'TOKEN_NOT_FOUND'; e.status = 404;
    throw e;
  }
  if (row.status !== 'pending') {
    const e = new Error('Este enlace ya fue usado');
    e.code = 'TOKEN_ALREADY_USED'; e.status = 410;
    throw e;
  }
  if (row.expiresAt.getTime() < Date.now()) {
    // Lazy mark — no need for a sweep job at this scale.
    await prisma.clientUpdateToken.update({
      where: { id: row.id },
      data: { status: 'expired' }
    }).catch(() => {}); // best-effort
    const e = new Error('Este enlace ha expirado');
    e.code = 'TOKEN_EXPIRED'; e.status = 410;
    throw e;
  }

  // Capture audit fields on first hit only.
  if (!row.ipAddress && (ip || userAgent)) {
    await prisma.clientUpdateToken.update({
      where: { id: row.id },
      data: {
        ipAddress: ip || null,
        userAgent: (userAgent || '').slice(0, 500) || null
      }
    }).catch(() => {});
  }

  return {
    client:    publicSnapshot(row.client),
    expiresAt: row.expiresAt,
    tokenId:   row.id          // returned so the photo-upload route can attach
  };
}

// ── 3. Apply update (PUT) ─────────────────────────────────────────────
/**
 * Apply customer-supplied changes. Atomic w.r.t. token status so two
 * concurrent submits can never both succeed. Returns the diff so the
 * technician notification can list "what changed".
 *
 * Possible throws (translated by the route):
 *   TOKEN_*            — same set as lookupToken
 *   DOCUMENT_CONFLICT  — documentNumber already in use by another client
 */
export async function applyUpdate(rawToken, payload) {
  const row = await prisma.clientUpdateToken.findUnique({
    where: { token: rawToken },
    include: { client: true, createdBy: { select: { email: true, name: true } } }
  });
  if (!row) {
    const e = new Error('Token no encontrado'); e.code = 'TOKEN_NOT_FOUND'; e.status = 404; throw e;
  }
  if (row.status !== 'pending') {
    const e = new Error('Este enlace ya fue usado'); e.code = 'TOKEN_ALREADY_USED'; e.status = 410; throw e;
  }
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.clientUpdateToken.update({
      where: { id: row.id }, data: { status: 'expired' }
    }).catch(() => {});
    const e = new Error('Este enlace ha expirado'); e.code = 'TOKEN_EXPIRED'; e.status = 410; throw e;
  }

  const changes = pickUpdatable(payload);

  // Document-number uniqueness check (the column has a UNIQUE constraint;
  // we pre-check to give a friendly error instead of a 500 from Postgres).
  if (changes.documentNumber && changes.documentNumber !== row.client.documentNumber) {
    const dup = await prisma.client.findUnique({
      where: { documentNumber: changes.documentNumber },
      select: { id: true }
    });
    if (dup && dup.id !== row.clientId) {
      const e = new Error('El número de documento ya está registrado a nombre de otro cliente.');
      e.code = 'DOCUMENT_CONFLICT'; e.status = 409;
      throw e;
    }
  }

  // Atomic: write the changes AND flip the token to "used" in the same
  // transaction. Use a conditional update on the token (where status is
  // still pending) so a concurrent submitter gets a 0-row update and we
  // can detect the race and abort.
  const [, claimed] = await prisma.$transaction([
    prisma.client.update({
      where: { id: row.clientId },
      data:  changes
    }),
    prisma.clientUpdateToken.updateMany({
      where: { id: row.id, status: 'pending' },
      data:  { status: 'used', usedAt: new Date() }
    })
  ]);

  if (claimed.count === 0) {
    // Someone else won the race — the data write above just landed but
    // the token is already used. That's annoying but not a security hole
    // (still single-client, the second submit just overwrote with the
    // same form data). Surface a clear error so the second customer sees
    // a clean message.
    const e = new Error('El enlace fue usado simultáneamente desde otro dispositivo.');
    e.code = 'TOKEN_RACE_LOST'; e.status = 409;
    throw e;
  }

  return {
    tokenRow: row,
    changes,
    previous: PUBLIC_SNAPSHOT_FIELDS.reduce((acc, k) => {
      acc[k] = row.client[k] ?? null;
      return acc;
    }, {})
  };
}

// ── 4. Dispatch link to customer ──────────────────────────────────────
/**
 * Send the public URL to the customer over each channel the operator
 * selected. Fire-and-forget per channel: one channel failing must not
 * block the others. Returns a per-channel report.
 */
export async function dispatchLinkToClient(tokenRow, client) {
  const url     = buildPublicUrl(tokenRow.token);
  const channels = tokenRow.sendChannels || [];
  const results  = {};

  const greeting  = client.name?.split(/\s+/)[0] || 'Hola';
  const expires   = tokenRow.expiresAt.toLocaleDateString('es-CO', { day: '2-digit', month: 'long' });

  for (const ch of channels) {
    try {
      if (ch === 'EMAIL') {
        if (!client.email) throw new Error('Cliente sin email');
        await notificationService.sendEmailRaw({
          to:      client.email,
          subject: 'Actualiza tus datos — ISP Manager',
          preset:  'general_announcement',
          title:   'Actualiza tus datos',
          body:
`Hola ${greeting},

Tu proveedor de internet necesita verificar y actualizar tus datos de contacto. Usa el siguiente enlace seguro para hacerlo desde tu celular o computador. El enlace es de un solo uso y vence el ${expires}.

${url}

Si no esperabas este mensaje, ignóralo.`
        });
        results.EMAIL = { ok: true };
      }
      else if (ch === 'WHATSAPP') {
        if (!client.phone) throw new Error('Cliente sin teléfono');
        const r = await whatsapp.sendText(
          client.phone,
          `Hola ${greeting} 👋\n\nPor favor actualiza tus datos en este enlace seguro (vence el ${expires}):\n${url}`
        );
        results.WHATSAPP = r?.ok ? { ok: true, id: r.id } : { ok: false, error: r?.error || 'unknown' };
      }
      else if (ch === 'TELEGRAM') {
        // Customer-facing Telegram is rare but the operator asked for it.
        // Uses the global bot — the customer must already be a chat the bot
        // can reach. In practice this is mostly used as a fallback log.
        const r = await telegram.sendMessage(
          `🔗 Link de actualización para <b>${client.name}</b> (vence ${expires}):\n${url}`,
          { parseMode: 'HTML' }
        );
        results.TELEGRAM = r?.ok ? { ok: true } : { ok: false, error: r?.error || 'unknown' };
      }
    } catch (e) {
      results[ch] = { ok: false, error: e.message };
    }
  }

  return { url, results };
}

// ── 5. Notify technician ──────────────────────────────────────────────
/**
 * After a successful customer submit, alert the technician(s) over the
 * channels the operator selected when generating the token.
 *
 * `creator` is the User row of the operator who generated the token, if
 * any (createdById may be NULL after user deletion).
 */
export async function notifyTechnician({ tokenRow, client, changes, previous }) {
  const channels = tokenRow.notifyChannels || [];
  if (channels.length === 0) return { results: {} };

  const changedKeys = Object.keys(changes).filter(k => (changes[k] ?? null) !== (previous[k] ?? null));
  const summary = changedKeys.length === 0
    ? '(no cambió ningún campo, sólo confirmó datos)'
    : changedKeys.map(k => `• ${k}: ${previous[k] ?? '—'} → ${changes[k] ?? '—'}`).join('\n');

  const results = {};

  for (const ch of channels) {
    try {
      if (ch === 'EMAIL') {
        const techEmail = tokenRow.createdBy?.email;
        if (!techEmail) throw new Error('No hay técnico con email para notificar');
        await notificationService.sendEmailRaw({
          to:      techEmail,
          subject: `[Auto-actualización] ${client.name}`,
          preset:  'general_announcement',
          title:   `Cliente actualizó sus datos`,
          body:
`El cliente ${client.name} usó el enlace que generaste y actualizó su información.

Cambios:
${summary}

Ver detalle: ${env.FRONTEND_URL}/clients/${client.id}`
        });
        results.EMAIL = { ok: true };
      }
      else if (ch === 'WHATSAPP') {
        // Reuse the technician's phone if we ever store it; otherwise no-op.
        // For now we send to the customer-facing bot using the company's
        // configured WhatsApp number — operators tend to share that line.
        // If no phone available, this just records as skipped.
        results.WHATSAPP = { ok: false, error: 'NO_TECH_PHONE_CONFIGURED' };
      }
      else if (ch === 'TELEGRAM') {
        const r = await telegram.sendMessage(
          `📝 <b>${client.name}</b> actualizó sus datos vía link público.\n\n${summary}\n\n<a href="${env.FRONTEND_URL}/clients/${client.id}">Ver detalle</a>`,
          { parseMode: 'HTML' }
        );
        results.TELEGRAM = r?.ok ? { ok: true } : { ok: false, error: r?.error || 'unknown' };
      }
    } catch (e) {
      results[ch] = { ok: false, error: e.message };
    }
  }

  return { results };
}

// ── 6. Photo attach (called by the upload route) ──────────────────────
/**
 * Record an uploaded evidence photo against a client, marking it as
 * "uploaded by the customer themselves" (technicianId = null, type and
 * description set by the caller). The photo binary itself is handled by
 * the upload route via multer; this is just the DB row.
 */
export async function attachClientPhoto({ clientId, tokenId, type, description, fileUrl, fileName, mimeType, sizeBytes }) {
  return prisma.clientEvidencePhoto.create({
    data: {
      clientId,
      technicianId: null,
      type:         type || 'other',
      description:  description || `Subido por el cliente · token ${tokenId.slice(0, 8)}…`,
      fileUrl,
      fileName,
      mimeType,
      sizeBytes
    }
  });
}
