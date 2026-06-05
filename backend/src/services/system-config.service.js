// Tiny helper over the SystemConfig KV table.
//
// SystemConfig is a single-row-per-key table:
//   key (unique), value (string), type ('boolean' | 'number' | 'string' | 'json')
//
// The legacy code reads env vars at boot for many settings. New runtime
// toggles (e.g., "auto-suspend overdue clients") belong here so the
// operator can flip them from the UI without a deploy.
//
// All methods are async + best-effort: a missing/malformed row returns
// the caller-supplied default instead of throwing.

import { prisma } from '../config/database.js';

const TYPES = new Set(['boolean', 'number', 'string', 'json']);

function decode(row) {
  if (!row) return undefined;
  switch (row.type) {
    case 'boolean': return row.value === 'true' || row.value === '1';
    case 'number':  { const n = Number(row.value); return Number.isFinite(n) ? n : undefined; }
    case 'json':    { try { return JSON.parse(row.value); } catch { return undefined; } }
    default:        return row.value;
  }
}

function encode(value, type) {
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number')  return String(value);
  if (type === 'json')    return JSON.stringify(value);
  return String(value);
}

export async function getValue(key, defaultValue = undefined) {
  const row = await prisma.systemConfig.findUnique({ where: { key } }).catch(() => null);
  const v = decode(row);
  return v === undefined ? defaultValue : v;
}

export async function getBoolean(key, defaultValue = false) {
  const v = await getValue(key);
  return typeof v === 'boolean' ? v : defaultValue;
}

export async function getNumber(key, defaultValue = 0) {
  const v = await getValue(key);
  return typeof v === 'number' ? v : defaultValue;
}

export async function setValue(key, value, type) {
  if (!TYPES.has(type)) throw new Error(`Unsupported type: ${type}`);
  const encoded = encode(value, type);
  // Upsert so callers don't need to know whether the row exists.
  await prisma.systemConfig.upsert({
    where:  { key },
    create: { key, value: encoded, type },
    update: { value: encoded, type }
  });
}

// Well-known keys live here so they don't drift across the codebase.
// Add a new key here BEFORE consuming it from a job/route.
//
// NOTE: the former AUTO_SUSPEND_* keys were removed when bulk auto-
// suspension was deleted per operator policy. If you ever add a feature
// flag that toggles destructive behavior, document the policy here.
export const KEYS = Object.freeze({
  // placeholder for future flags
});
