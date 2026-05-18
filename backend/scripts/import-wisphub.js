/**
 * import-wisphub.js — Idempotent importer from WispHub API → local Prisma DB.
 *
 * Usage:
 *   WISPHUB_TOKEN=xxx node import-wisphub.js [--dry-run] [--only=zones,plans,clients,invoices] [--limit=N]
 *
 * Order: zones → plans → clients → invoices (+ items + derived payments).
 * Strategy: upsert by `wisphubId` so re-runs are safe.
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const TOKEN   = process.env.WISPHUB_TOKEN;
const API_URL = process.env.WISPHUB_API_URL || 'https://api.wisphub.app';
if (!TOKEN) { console.error('Missing WISPHUB_TOKEN'); process.exit(1); }

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT   = Number((args.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || null;
const ONLY    = ((args.find(a => a.startsWith('--only=')) || '').split('=')[1] || '').split(',').filter(Boolean);
const wants   = (k) => ONLY.length === 0 || ONLY.includes(k);

const BASE    = API_URL.replace(/\/$/, '') + '/api';
const headers = { 'Authorization': `Api-Key ${TOKEN}`, 'Content-Type': 'application/json' };

// ── HTTP helpers ─────────────────────────────────────────
async function get(path, attempt = 1) {
  const MAX_ATTEMPTS = 4;
  try {
    const ac = new AbortController();
    const t  = setTimeout(() => ac.abort(), 60_000);
    const res = await fetch(`${BASE}${path}`, { headers, signal: ac.signal }).finally(() => clearTimeout(t));
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
    if (!(res.headers.get('content-type') || '').includes('application/json')) {
      throw new Error(`GET ${path} → non-JSON response`);
    }
    return await res.json();
  } catch (e) {
    const transient = /ECONNRESET|ETIMEDOUT|terminated|aborted|fetch failed|HTTP 5\d\d/i.test(e.message);
    if (transient && attempt < MAX_ATTEMPTS) {
      const wait = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      console.log(`   ⚠️  ${e.message} — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
      return get(path, attempt + 1);
    }
    throw e;
  }
}

async function fetchAll(path) {
  const all = [];
  let offset = 0, pageSize = 100;
  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await get(`${path}${sep}limit=${pageSize}&offset=${offset}`);
    const results = data.results || (Array.isArray(data) ? data : []);
    all.push(...results);
    if (LIMIT && all.length >= LIMIT) return all.slice(0, LIMIT);
    if (!data.next || results.length === 0) break;
    offset += pageSize;
  }
  return all;
}

// ── Mapping helpers ──────────────────────────────────────

// "65000.00" or 65000 → 6500000 (cents)
const toCents = (v) => {
  if (v == null || v === '') return 0;
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
};

// "30/04/2026 11:07:00" or "30/04/2026" or "2026-04-25" → Date | null
const parseDate = (s) => {
  if (!s) return null;
  if (typeof s !== 'string') return new Date(s);
  // ISO 8601 (e.g., "2026-04-25" or "2026-05-01T00:00:00-05:00")
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // DD/MM/YYYY [HH:mm:ss]
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, dd, mm, yyyy, h = '0', mi = '0', se = '0'] = m;
    const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +h, +mi, +se));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const mapClientStatus = (s) => {
  const x = (s || '').toLowerCase();
  if (x.includes('activo'))     return 'ACTIVE';
  if (x.includes('suspend'))    return 'SUSPENDED';
  if (x.includes('inactiv') ||
      x.includes('cancel') ||
      x.includes('retir'))      return 'INACTIVE';
  return 'PENDING';
};

const mapInvoiceStatus = (s) => {
  const x = (s || '').toLowerCase();
  if (x.includes('pagada'))     return 'PAID';
  if (x.includes('pendiente'))  return 'PENDING';
  if (x.includes('vencid'))     return 'OVERDUE';
  if (x.includes('cancel'))     return 'CANCELLED';
  if (x.includes('reembols'))   return 'REFUNDED';
  return 'DRAFT';
};

const mapDocumentType = (tipo_persona) => {
  const x = (tipo_persona || '').toLowerCase();
  if (x.includes('jur') || x.includes('moral')) return 'NIT';
  return 'CC';
};

const mapPaymentMethod = (forma_pago) => {
  if (!forma_pago) return 'OTHER';
  const x = String(forma_pago).toLowerCase();
  if (x.includes('efectivo') || x.includes('cash'))         return 'CASH';
  if (x.includes('transfer') || x.includes('consignacion')) return 'BANK_TRANSFER';
  if (x.includes('tarjeta') || x.includes('credit'))        return 'CREDIT_CARD';
  if (x.includes('wompi') || x.includes('mercadopago') ||
      x.includes('payu') || x.includes('openpay') ||
      x.includes('pasarela') || x.includes('oxxo'))         return 'WOMPI';
  return 'OTHER';
};

// ── Logging ──────────────────────────────────────────────
const stats = { zones: 0, plans: 0, clients: 0, invoices: 0, invoiceItems: 0, payments: 0, errors: [] };
const tag = DRY_RUN ? '[dry-run]' : '[apply]';
const log = (...a) => console.log(tag, ...a);

// ── Importers ────────────────────────────────────────────

async function importZones() {
  if (!wants('zones')) return;
  log('🗺️  Fetching zones…');
  const zones = await fetchAll('/zonas/');
  log(`   got ${zones.length} zones`);
  for (const z of zones) {
    const data = { wisphubId: String(z.id), name: z.nombre };
    if (DRY_RUN) { log(`   would upsert zone: ${z.nombre}`); continue; }
    await prisma.zone.upsert({
      where:  { wisphubId: data.wisphubId },
      update: { name: data.name },
      // create has to handle the "name already exists from manual seed" case
      create: data,
    }).catch(async (e) => {
      // Name unique conflict → patch existing zone with wisphubId
      if (String(e.message).includes('name')) {
        return prisma.zone.update({ where: { name: z.nombre }, data: { wisphubId: data.wisphubId } });
      }
      throw e;
    });
    stats.zones++;
  }
}

async function importPlans() {
  if (!wants('plans')) return;
  log('📦 Fetching plans…');
  const plans = await fetchAll('/plan-internet/');
  log(`   got ${plans.length} plans`);
  for (const p of plans) {
    const data = {
      wisphubId:     String(p.id),
      name:          p.nombre,
      type:          p.tipo || null,
      price:         0,
      monthlyPrice:  0,
      downloadSpeed: 0,
      uploadSpeed:   0,
      isActive:      true,
    };
    if (DRY_RUN) { log(`   would upsert plan: ${p.nombre}`); continue; }
    await prisma.plan.upsert({
      where:  { wisphubId: data.wisphubId },
      update: { name: data.name, type: data.type },
      create: data,
    }).catch(async (e) => {
      if (String(e.message).includes('name')) {
        const existing = await prisma.plan.findFirst({ where: { name: p.nombre } });
        if (existing) {
          return prisma.plan.update({ where: { id: existing.id }, data: { wisphubId: data.wisphubId, type: data.type } });
        }
      }
      throw e;
    });
    stats.plans++;
  }
}

// Returns map: pppoeUsername (== `usuario`) → wisphubId — used later by invoices
async function importClients() {
  const userToWisphubId = new Map();
  if (!wants('clients')) {
    // Even if skipping, we still need the lookup map for invoices
    const all = await prisma.client.findMany({ where: { wisphubId: { not: null } }, select: { wisphubId: true, pppoeUsername: true } });
    for (const c of all) { if (c.pppoeUsername) userToWisphubId.set(c.pppoeUsername, c.wisphubId); }
    return userToWisphubId;
  }

  log('📋 Fetching clients…');
  const clients = await fetchAll('/clientes/');
  log(`   got ${clients.length} clients`);

  // Pre-load FK lookups
  const planLookup = new Map((await prisma.plan.findMany({ where: { wisphubId: { not: null } }, select: { id: true, wisphubId: true } }))
    .map(p => [p.wisphubId, p.id]));
  const zoneLookup = new Map((await prisma.zone.findMany({ where: { wisphubId: { not: null } }, select: { id: true, wisphubId: true } }))
    .map(z => [z.wisphubId, z.id]));

  for (const c of clients) {
    const wisphubId = String(c.id_servicio);
    const planId   = c.plan_internet?.id ? planLookup.get(String(c.plan_internet.id)) : null;
    const zoneId   = c.zona?.id ? zoneLookup.get(String(c.zona.id)) : null;
    const usuario  = c.usuario || null;
    if (usuario) userToWisphubId.set(usuario, wisphubId);

    const data = {
      wisphubId,
      name:            c.nombre || usuario || `cliente_${wisphubId}`,
      email:           c.email && c.email.trim() !== '' ? c.email.trim() : null,
      phone:           c.telefono || '',
      address:         c.direccion || '',
      neighborhood:    c.localidad || null,
      city:            c.ciudad || '',
      documentType:    mapDocumentType(c.tipo_persona),
      documentNumber:  c.cedula && c.cedula.trim() !== '' ? c.cedula.trim() : null,
      status:          mapClientStatus(c.estado),
      planId:          planId || null,
      zoneId:          zoneId || null,
      balance:         toCents(c.saldo),
      monthlyFee:      toCents(c.precio_plan),
      installationDate: parseDate(c.fecha_instalacion),
      cutoffDate:      parseDate(c.fecha_corte),
      coordinates:     c.coordenadas || null,
      pppoeUsername:   usuario,
      pppoePassword:   c.password_servicio || null,
      serviceIp:       c.ip || null,
      serviceLocalIp:  c.ip_local || null,
      vlan:            c.interfaz_lan || null,
      wisphubRouterId: c.router?.id ? String(c.router.id) : null,
      notes:           c.comentarios || null,
    };

    if (DRY_RUN) { log(`   would upsert client[${wisphubId}]: ${data.name} | plan=${planId} zone=${zoneId} status=${data.status}`); continue; }

    // Strip null email if it would collide with NULL semantics; Prisma handles null OK
    const upserted = await prisma.client.upsert({
      where:  { wisphubId },
      update: data,
      create: data,
    }).catch(async (e) => {
      // Email or documentNumber collision with seed data — drop those and retry
      if (/email|documentNumber|nit/i.test(e.message)) {
        const safeData = { ...data, email: null };
        return prisma.client.upsert({ where: { wisphubId }, update: safeData, create: safeData });
      }
      throw e;
    });
    stats.clients++;

    // Devices (CPE + WiFi router) — only create if there's any non-empty data
    const cpeData = {
      mac:   (c.mac_cpe || '').trim(),
      model: (c.modelo_antena || '').trim(),
      type:  'cpe',
    };
    if (cpeData.mac || cpeData.model) {
      try {
        await prisma.device.upsert({
          where:  { mac: cpeData.mac || `cpe-placeholder-${wisphubId}` },
          update: { clientId: upserted.id, model: cpeData.model || null, type: 'cpe' },
          create: { clientId: upserted.id, mac: cpeData.mac || `cpe-placeholder-${wisphubId}`, model: cpeData.model || null, type: 'cpe' },
        });
      } catch (e) { stats.errors.push(`device cpe[${wisphubId}]: ${e.message}`); }
    }
    const wifiData = {
      mac:   (c.mac_router_wifi || '').trim(),
      model: (c.modelo_router_wifi || '').trim(),
      type:  'router_wifi',
    };
    if (wifiData.mac || wifiData.model) {
      try {
        await prisma.device.upsert({
          where:  { mac: wifiData.mac || `wifi-placeholder-${wisphubId}` },
          update: { clientId: upserted.id, model: wifiData.model || null, type: 'router_wifi' },
          create: { clientId: upserted.id, mac: wifiData.mac || `wifi-placeholder-${wisphubId}`, model: wifiData.model || null, type: 'router_wifi' },
        });
      } catch (e) { stats.errors.push(`device wifi[${wisphubId}]: ${e.message}`); }
    }
  }
  return userToWisphubId;
}

async function importInvoices(userToWisphubId) {
  if (!wants('invoices')) return;
  log('💰 Fetching invoices…');
  const invoices = await fetchAll('/facturas/');
  log(`   got ${invoices.length} invoices`);

  // Pre-load client lookup by wisphubId
  const clientLookup = new Map((await prisma.client.findMany({ where: { wisphubId: { not: null } }, select: { id: true, wisphubId: true } }))
    .map(c => [c.wisphubId, c.id]));

  for (const inv of invoices) {
    const wisphubId = String(inv.id_factura);
    const usuario   = inv.cliente?.usuario || null;
    const clientWisphubId = usuario ? userToWisphubId.get(usuario) : null;
    const clientId  = clientWisphubId ? clientLookup.get(clientWisphubId) : null;

    if (!clientId) {
      stats.errors.push(`invoice[${wisphubId}]: no client (usuario=${usuario})`);
      continue;
    }

    const status   = mapInvoiceStatus(inv.estado);
    const total    = toCents(inv.total);
    const subTotal = toCents(inv.sub_total);
    const number   = inv.folio && String(inv.folio).trim() !== '' ? String(inv.folio).trim() : `WHF-${wisphubId}`;

    const invoiceData = {
      wisphubId,
      number,
      clientId,
      amount:    subTotal,
      tax:       toCents(inv.impuestos_total),
      discount:  toCents(inv.descuento),
      total,
      status,
      issueDate: parseDate(inv.fecha_emision) || new Date(),
      dueDate:   parseDate(inv.fecha_vencimiento) || new Date(),
      paidDate:  parseDate(inv.fecha_pago),
    };

    if (DRY_RUN) {
      log(`   would upsert invoice[${wisphubId}] ${number} → client=${clientWisphubId} total=${total} status=${status} items=${inv.articulos?.length || 0}`);
      continue;
    }

    const upserted = await prisma.invoice.upsert({
      where:  { wisphubId },
      update: invoiceData,
      create: invoiceData,
    }).catch(async (e) => {
      if (/number/i.test(e.message)) {
        const safe = { ...invoiceData, number: `WHF-${wisphubId}` };
        return prisma.invoice.upsert({ where: { wisphubId }, update: safe, create: safe });
      }
      throw e;
    });
    stats.invoices++;

    // Items — wipe and reinsert (idempotent)
    if (Array.isArray(inv.articulos)) {
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: upserted.id } });
      for (const a of inv.articulos) {
        const itemData = {
          wisphubId:   a.id ? String(a.id) : null,
          invoiceId:   upserted.id,
          quantity:    Number(a.cantidad) || 1,
          description: (a.descripcion || '').trim().slice(0, 1000) || '(sin descripción)',
          price:       toCents(a.precio),
          total:       toCents(a.precio) * (Number(a.cantidad) || 1),
        };
        try {
          await prisma.invoiceItem.create({ data: itemData });
          stats.invoiceItems++;
        } catch (e) {
          // wisphubId collision (article id reused on another invoice already imported) → null it
          await prisma.invoiceItem.create({ data: { ...itemData, wisphubId: null } });
          stats.invoiceItems++;
        }
      }
    }

    // Derived payment — only if invoice is paid AND total_cobrado > 0
    const cobrado = toCents(inv.total_cobrado);
    if (cobrado > 0 && (status === 'PAID' || invoiceData.paidDate)) {
      const paymentData = {
        invoiceId: upserted.id,
        clientId,
        amount:    cobrado,
        method:    mapPaymentMethod(inv.forma_pago),
        status:    'COMPLETED',
        transactionId: (inv.id_mercadopago || inv.id_payu || inv.referencia || '').trim() || null,
        notes:     `Imported from WispHub invoice ${wisphubId}` + (inv.forma_pago ? ` (${inv.forma_pago})` : ''),
      };
      // No `wisphubId` on Payment, so we re-create from scratch each time.
      // Strategy: delete previous "imported" payments for this invoice, then insert.
      await prisma.payment.deleteMany({
        where: { invoiceId: upserted.id, notes: { startsWith: 'Imported from WispHub invoice' } },
      });
      try {
        await prisma.payment.create({ data: paymentData });
        stats.payments++;
      } catch (e) {
        // transactionId unique collision — re-try without it
        if (/transactionId/i.test(e.message)) {
          await prisma.payment.create({ data: { ...paymentData, transactionId: null } });
          stats.payments++;
        } else { throw e; }
      }
    }
  }
}

// ── Main ─────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 WispHub Importer — ${DRY_RUN ? 'DRY RUN' : 'APPLYING CHANGES'}`);
  console.log(`   API: ${BASE}`);
  if (LIMIT) console.log(`   --limit=${LIMIT}`);
  if (ONLY.length) console.log(`   --only=${ONLY.join(',')}`);
  console.log();

  await importZones();
  await importPlans();
  const userMap = await importClients();
  await importInvoices(userMap);

  console.log('\n📊 Summary:');
  console.log(`   Zones:         ${stats.zones}`);
  console.log(`   Plans:         ${stats.plans}`);
  console.log(`   Clients:       ${stats.clients}`);
  console.log(`   Invoices:      ${stats.invoices}`);
  console.log(`   Invoice items: ${stats.invoiceItems}`);
  console.log(`   Payments:      ${stats.payments}`);
  if (stats.errors.length) {
    console.log(`\n⚠️  ${stats.errors.length} errors:`);
    stats.errors.slice(0, 20).forEach(e => console.log('   - ' + e));
    if (stats.errors.length > 20) console.log(`   …and ${stats.errors.length - 20} more`);
  }
  console.log(DRY_RUN ? '\n💡 Re-run without --dry-run to apply.' : '\n✅ Done.');
}

main()
  .catch(e => { console.error('❌ Fatal:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
