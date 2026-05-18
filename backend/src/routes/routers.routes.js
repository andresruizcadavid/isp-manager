import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { MikrotikService, testRouterCredentials } from '../services/mikrotik.service.js';

const router = Router();
const prisma = new PrismaClient();

// GET all routers
router.get('/', async (req, res) => {
  try {
    const routers = await prisma.router.findMany({
      include: { _count: { select: { mikrotikAccounts: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: routers });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST test credentials (no id required — used by the create flow)
router.post('/test', async (req, res) => {
  try {
    const { ipAddress, apiPort = 80, username = 'admin', password = '' } = req.body || {};
    if (!ipAddress) {
      return res.status(400).json({ success: false, error: 'ipAddress es requerido' });
    }
    const result = await testRouterCredentials({
      ipAddress,
      apiPort: Number(apiPort) || 80,
      username,
      password
    });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(400).json({
      success: false,
      error: e.message || 'No se pudo conectar al router'
    });
  }
});

// GET single router
router.get('/:id', async (req, res) => {
  try {
    const r = await prisma.router.findUniqueOrThrow({
      where: { id: Number(req.params.id) },
      include: { _count: { select: { mikrotikAccounts: true } } }
    });
    res.json({ success: true, data: r });
  } catch (e) {
    res.status(404).json({ success: false, error: 'Router no encontrado' });
  }
});

// POST create router
router.post('/', async (req, res) => {
  try {
    const r = await prisma.router.create({ data: req.body });
    res.status(201).json({ success: true, data: r });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// PUT update router
router.put('/:id', async (req, res) => {
  try {
    const { id, createdAt, updatedAt, lastSyncAt, _count, ...data } = req.body;
    const r = await prisma.router.update({
      where: { id: Number(req.params.id) },
      data
    });
    res.json({ success: true, data: r });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// DELETE router
router.delete('/:id', async (req, res) => {
  try {
    await prisma.router.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// POST test connection
router.post('/:id/test', async (req, res) => {
  try {
    const r = await prisma.router.findUniqueOrThrow({
      where: { id: Number(req.params.id) }
    });
    const mk     = new MikrotikService(r);
    const result = await mk.testConnection();
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(400).json({ 
      success: false, 
      error: e.message || 'No se pudo conectar al router' 
    });
  }
});

// POST sync PPPoE secrets from MikroTik
router.post('/:id/sync', async (req, res) => {
  try {
    const r  = await prisma.router.findUniqueOrThrow({
      where: { id: Number(req.params.id) }
    });
    const mk      = new MikrotikService(r);
    const secrets = await mk.getPPPoESecrets();
    const active  = await mk.getActivePPPoE();

    await prisma.router.update({
      where: { id: r.id },
      data:  { lastSyncAt: new Date() }
    });

    res.json({ 
      success: true, 
      data: { 
        secrets: secrets?.length || 0, 
        active:  active?.length  || 0 
      } 
    });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// GET system info from MikroTik
router.get('/:id/sysinfo', async (req, res) => {
  try {
    const r  = await prisma.router.findUniqueOrThrow({
      where: { id: Number(req.params.id) }
    });
    const mk   = new MikrotikService(r);
    const info = await mk.getSystemInfo();
    res.json({ success: true, data: info });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// GET PPPoE profiles from MikroTik
router.get('/:id/profiles', async (req, res) => {
  try {
    const r        = await prisma.router.findUniqueOrThrow({
      where: { id: Number(req.params.id) }
    });
    const mk       = new MikrotikService(r);
    const profiles = await mk.getPPPoEProfiles();
    res.json({ success: true, data: profiles });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// Alias used by /plans sync flow — same payload, semantic URL.
router.get('/:id/ppp-profiles', async (req, res) => {
  try {
    const r = await prisma.router.findUniqueOrThrow({ where: { id: Number(req.params.id) } });
    if (!r.isActive) {
      return res.status(409).json({ success: false, error: `Router "${r.name}" está desactivado.` });
    }
    const mk = new MikrotikService(r);
    const profiles = await mk.getPPPoEProfiles();
    res.json({ success: true, data: profiles });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// GET orphan PPP profiles — profiles that exist on the router but:
//   1. No local Plan references them (by mikrotikProfile or name), AND
//   2. No /ppp/secret on the device uses them.
// These are safe-to-delete candidates surfaced in the /plans cleanup tool.
router.get('/:id/ppp-profiles/orphans', async (req, res) => {
  try {
    const r = await prisma.router.findUniqueOrThrow({ where: { id: Number(req.params.id) } });
    if (!r.isActive) {
      return res.status(409).json({ success: false, error: `Router "${r.name}" está desactivado.` });
    }
    const mk = new MikrotikService(r);

    const [profiles, secrets, plans] = await Promise.all([
      mk.getPPPoEProfiles().catch(() => []),
      mk.getPPPoESecrets().catch(() => []),
      prisma.plan.findMany({ select: { name: true, mikrotikProfile: true } })
    ]);

    const inUse = new Set(
      (Array.isArray(secrets) ? secrets : [])
        .map(s => s.profile || s['profile'])
        .filter(Boolean)
    );
    const referenced = new Set();
    for (const p of plans) {
      if (p.mikrotikProfile) referenced.add(p.mikrotikProfile);
      else if (p.name)       referenced.add(p.name);
    }
    // System defaults are never "orphan" — they're protected anyway.
    const BUILTIN = new Set(['default', 'default-encryption']);

    const orphans = (Array.isArray(profiles) ? profiles : [])
      .map(p => ({
        name: p.name || p['name'],
        rateLimit: p['rate-limit'] || p.rateLimit || null,
        builtin: BUILTIN.has(p.name || p['name'])
      }))
      .filter(p => p.name && !BUILTIN.has(p.name) && !inUse.has(p.name) && !referenced.has(p.name));

    res.json({ success: true, data: { orphans, totals: {
      profiles:   profiles.length,
      inUse:      inUse.size,
      referenced: referenced.size,
      orphans:    orphans.length
    } } });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// DELETE a PPP profile by name on the device. Refuses to delete built-in
// profiles. Caller decides whether to also delete the matching local Plan.
router.delete('/:id/ppp-profiles/:profileName', async (req, res) => {
  try {
    const r = await prisma.router.findUniqueOrThrow({ where: { id: Number(req.params.id) } });
    if (!r.isActive) {
      return res.status(409).json({ success: false, error: `Router "${r.name}" está desactivado.` });
    }
    const mk = new MikrotikService(r);
    const result = await mk.deletePPPoEProfileByName(req.params.profileName);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// POST import PPPoE clients from MikroTik into the local DB.
// Dedupe is by username (MikrotikAccount.username @unique). Returns a
// summary { imported, skipped, errors } the caller can show in the UI.
router.post('/:id/import-pppoe-clients', async (req, res) => {
  try {
    const r = await prisma.router.findUniqueOrThrow({ where: { id: Number(req.params.id) } });
    if (!r.isActive) {
      return res.status(409).json({ success: false, error: `Router "${r.name}" está desactivado.` });
    }

    const mk = new MikrotikService(r);

    // Connectivity pre-check: a cheap ping (1.5s, 1 retry) so we fail fast
    // with a clean message when the router is simply unreachable, instead of
    // bubbling a generic "fetch failed".
    try {
      await mk.request('/system/identity', 'GET', null, { retries: 1, timeoutMs: 2500 });
    } catch (e) {
      const reachableHint = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|Timeout/i.test(e.message)
        ? `Verifica que el router "${r.name}" (${r.ipAddress}) esté encendido, en la red y con la REST API habilitada.`
        : e.message;
      return res.status(502).json({
        success: false,
        error: `No se pudo conectar al router. ${reachableHint}`
      });
    }

    // Read /ppp/secret with retries (3 attempts: 0.4s, 0.8s backoff).
    let secrets = [];
    try {
      secrets = await mk.request('/ppp/secret', 'GET', null, { retries: 2, timeoutMs: 12000 });
      if (!Array.isArray(secrets)) secrets = [];
    } catch (e) {
      return res.status(502).json({
        success: false,
        error: /fetch failed|Timeout|ECONNRESET/i.test(e.message)
          ? `No se pudo leer /ppp/secret tras varios intentos. Verifica la conexión al router e intenta nuevamente. (${e.message})`
          : `No se pudo leer /ppp/secret: ${e.message}`
      });
    }

    // Empty list isn't an error — but call it out so the operator knows.
    if (secrets.length === 0) {
      return res.json({
        success: true,
        data: { total: 0, imported: 0, skipped: 0, errors: 0, linkedToPlan: 0, details: [],
                note: 'El router no tiene usuarios PPPoE configurados.' }
      });
    }

    // Index existing usernames so we don't query per row.
    const existingAccounts = await prisma.mikrotikAccount.findMany({
      select: { username: true }
    });
    const existingUsernames = new Set(existingAccounts.map(a => a.username));

    // Orphan-by-name index. A "huérfano" is a Client row without a
    // MikrotikAccount whose name matches an incoming PPPoE username. Past
    // imports created these as separate rows, causing visible duplicates
    // in /clients. We now ADOPT them — attach the new account to the
    // existing client instead of inserting a twin.
    const orphanClients = await prisma.client.findMany({
      where: { mikrotikAccount: { is: null } },
      select: { id: true, name: true }
    });
    const orphansByName = new Map();
    for (const c of orphanClients) {
      const key = (c.name || '').toLowerCase().trim();
      if (key) orphansByName.set(key, c.id);
    }

    // Profile → Plan map. We prefer a match by Plan.mikrotikProfile (technical
    // name) and fall back to Plan.name. Built once per import for speed.
    const plans = await prisma.plan.findMany({
      select: { id: true, name: true, mikrotikProfile: true }
    });
    const planByProfile = new Map();
    for (const p of plans) {
      if (p.mikrotikProfile) planByProfile.set(p.mikrotikProfile, p.id);
    }
    // Fallback: legacy plans without mikrotikProfile — match on name.
    const planByName = new Map();
    for (const p of plans) {
      if (!p.mikrotikProfile && p.name) planByName.set(p.name, p.id);
    }

    const summary = {
      total: secrets.length,
      imported: 0, skipped: 0, errors: 0, adopted: 0,
      linkedToPlan: 0,   // how many imported clients got a Plan auto-linked
      details: []
    };

    for (const s of secrets) {
      const username = s.name || s['name'];
      if (!username) {
        summary.errors++;
        summary.details.push({ username: '(sin nombre)', status: 'error', reason: 'secret sin name' });
        continue;
      }
      if (existingUsernames.has(username)) {
        summary.skipped++;
        summary.details.push({ username, status: 'skipped', reason: 'ya existe en el sistema' });
        continue;
      }

      const remoteAddress = (s['remote-address'] || s.remoteAddress || '').split('/')[0] || null;
      const profileName   = s.profile || s['profile'] || null;
      const password      = s.password || ''; // RouterOS REST often masks this

      // Resolve linked Plan: technical name first, fall back to plan.name.
      const resolvedPlanId = profileName
        ? (planByProfile.get(profileName) || planByName.get(profileName) || null)
        : null;

      try {
        const orphanId = orphansByName.get(username.toLowerCase().trim());
        const mkStatus = s.disabled === 'true' || s.disabled === true ? 'SUSPENDED' : 'ACTIVE';

        if (orphanId) {
          // Adoption path: attach new MikrotikAccount to the orphan
          // client and patch its serviceIp/planId if missing. Keeps
          // historical invoices/payments intact (they already point
          // at orphanId).
          await prisma.mikrotikAccount.create({
            data: {
              routerId: r.id, username, password, remoteAddress, profileName,
              status: mkStatus, clientId: orphanId
            }
          });
          await prisma.client.update({
            where: { id: orphanId },
            data: {
              serviceIp: remoteAddress ?? undefined,
              planId:    resolvedPlanId ?? undefined
            }
          });
          existingUsernames.add(username);
          orphansByName.delete(username.toLowerCase().trim());
          summary.adopted++;
          if (resolvedPlanId) summary.linkedToPlan++;
          summary.details.push({
            username, status: 'adopted',
            clientId: orphanId,
            planLinked: !!resolvedPlanId,
            profile: profileName,
            reason: 'cliente huérfano con el mismo nombre — se vinculó la cuenta PPPoE'
          });
          continue;
        }

        const created = await prisma.client.create({
          data: {
            name:           username,
            phone:          '',
            address:        '',
            city:           'Cali',
            documentType:   null,
            documentNumber: null,
            email:          null,
            status:         'ACTIVE',
            serviceIp:      remoteAddress,
            planId:         resolvedPlanId,
            notes:          `Importado desde MikroTik "${r.name}" (${r.ipAddress}) el ${new Date().toISOString().slice(0,10)}.`,
            mikrotikAccount: {
              create: {
                routerId:      r.id,
                username,
                password,
                remoteAddress,
                profileName,
                status:        mkStatus,
              }
            }
          },
          select: { id: true, name: true, planId: true }
        });
        existingUsernames.add(username);
        summary.imported++;
        if (resolvedPlanId) summary.linkedToPlan++;
        summary.details.push({
          username, status: 'imported',
          clientId: created.id,
          planLinked: !!resolvedPlanId,
          profile: profileName
        });
      } catch (e) {
        summary.errors++;
        summary.details.push({ username, status: 'error', reason: e.message });
      }
    }

    console.log(`[import.pppoe] router=${r.id} total=${summary.total} imported=${summary.imported} adopted=${summary.adopted} linked=${summary.linkedToPlan} skipped=${summary.skipped} errors=${summary.errors}`);
    res.json({ success: true, data: summary });
  } catch (e) {
    console.error('[import.pppoe] failed:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET available IPs (pool ranges minus already-assigned PPPoE remote-addresses)
// READ-ONLY: only issues GET requests to MikroTik (/ip/pool, /ppp/secret, /ppp/active)
router.get('/:id/available-ips', async (req, res) => {
  try {
    const r = await prisma.router.findUniqueOrThrow({
      where: { id: Number(req.params.id) }
    });
    const mk = new MikrotikService(r);

    // 1) Read all IP pools (read-only)
    let pools = [];
    try {
      pools = await mk.request('/ip/pool');
      if (!Array.isArray(pools)) pools = [];
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: `No se pudo leer /ip/pool: ${e.message}`
      });
    }

    // 2) Read PPPoE secrets to know which remote-addresses are taken
    let secrets = [];
    try {
      secrets = await mk.request('/ppp/secret');
      if (!Array.isArray(secrets)) secrets = [];
    } catch { secrets = []; }

    // 3) Active sessions — ips currently in use even if no secret claims them
    let active = [];
    try {
      active = await mk.request('/ppp/active');
      if (!Array.isArray(active)) active = [];
    } catch { active = []; }

    // Helpers ── IPv4 ↔ uint32, accept "1.2.3.4" or "1.2.3.4-1.2.3.10" or "1.2.3.4/30"
    const ipToInt = (ip) => ip.split('.').reduce((a, o) => (a << 8 >>> 0) + Number(o), 0) >>> 0;
    const intToIp = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
    const isIp = (s) => /^(\d{1,3}\.){3}\d{1,3}$/.test(s);

    // Expand a pool's "ranges" string into a Set of integers (capped per pool to avoid mega ranges)
    const RANGE_CAP = 4096; // safety: don't expand /16 or larger
    function expandRanges(rangesStr, set) {
      if (!rangesStr) return;
      const parts = String(rangesStr).split(',').map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        if (part.includes('-')) {
          const [a, b] = part.split('-').map(s => s.trim());
          if (!isIp(a) || !isIp(b)) continue;
          const from = ipToInt(a), to = ipToInt(b);
          const span = Math.min(to - from + 1, RANGE_CAP);
          for (let i = 0; i < span; i++) set.add(from + i);
        } else if (part.includes('/')) {
          const [base, prefix] = part.split('/');
          if (!isIp(base) || !prefix) continue;
          const p = Number(prefix);
          if (!Number.isFinite(p) || p < 0 || p > 32) continue;
          const baseInt = ipToInt(base);
          const size = Math.pow(2, 32 - p);
          const span = Math.min(size, RANGE_CAP);
          // skip network and broadcast for /<31 prefixes
          const start = p < 31 ? 1 : 0;
          const end   = p < 31 ? span - 1 : span;
          for (let i = start; i < end; i++) set.add(baseInt + i);
        } else if (isIp(part)) {
          set.add(ipToInt(part));
        }
      }
    }

    // Build full pool set (and per-pool breakdown)
    const allPoolIps = new Set();
    const perPool = pools.map(p => {
      const set = new Set();
      expandRanges(p.ranges || p['ranges'], set);
      set.forEach(v => allPoolIps.add(v));
      return {
        name: p.name || p['name'] || '',
        ranges: p.ranges || p['ranges'] || '',
        size: set.size
      };
    });

    // Build used set
    const used = new Set();
    for (const s of secrets) {
      const ip = (s['remote-address'] || s.remoteAddress || '').split('/')[0];
      if (isIp(ip)) used.add(ipToInt(ip));
    }
    for (const a of active) {
      const ip = (a['address'] || '').split('/')[0];
      if (isIp(ip)) used.add(ipToInt(ip));
    }

    // Available = pool minus used
    const RESPONSE_CAP = 512;
    const availableInts = [...allPoolIps].filter(n => !used.has(n)).sort((a, b) => a - b);
    const truncated = availableInts.length > RESPONSE_CAP;
    const available = availableInts.slice(0, RESPONSE_CAP).map(intToIp);

    res.json({
      success: true,
      data: {
        router: { id: r.id, name: r.name },
        pools: perPool,
        totals: {
          pool: allPoolIps.size,
          used: used.size,
          available: availableInts.length
        },
        truncated,
        available
      }
    });
  } catch (e) {
    console.error('available-ips error:', e);
    res.status(400).json({ success: false, error: e.message });
  }
});

// GET active PPPoE connections
router.get('/:id/active', async (req, res) => {
  try {
    const r      = await prisma.router.findUniqueOrThrow({
      where: { id: Number(req.params.id) }
    });
    const mk     = new MikrotikService(r);
    const active = await mk.getActivePPPoE();
    res.json({ success: true, data: active });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// GET: Preview PPPoE secrets from MikroTik (no DB write)
router.get('/:id/pppoe-preview', async (req, res) => {
  try {
    const r = await prisma.router.findUniqueOrThrow({
      where: { id: Number(req.params.id) }
    });
    const mk = new MikrotikService(r);

    // Fetch secrets first — if this fails, return error immediately
    let secrets = [];
    try {
      secrets = await mk.request('/ppp/secret');
      if (!Array.isArray(secrets)) secrets = [];
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: `Error leyendo /ppp/secret: ${e.message}` 
      });
    }

    // Fetch active connections — non-critical, ignore if fails
    let active = [];
    try {
      active = await mk.request('/ppp/active');
      if (!Array.isArray(active)) active = [];
    } catch { active = []; }

    // Fetch profiles — non-critical
    let profiles = [];
    try {
      profiles = await mk.request('/ppp/profile');
      if (!Array.isArray(profiles)) profiles = [];
    } catch { profiles = []; }

    // Build active map
    const activeMap = {};
    active.forEach(a => {
      const key = a.name || a['name'];
      if (key) activeMap[key] = a;
    });

    // Get already imported usernames for this router
    const existingAccounts = await prisma.mikrotikAccount.findMany({
      where:  { routerId: r.id },
      select: { username: true }
    });
    const existingSet = new Set(existingAccounts.map(a => a.username));

    // Map secrets — handle varied MikroTik field names
    const mapped = secrets.map(s => ({
      mikrotikId:    s['.id']             || s['id']    || null,
      username:      s['name']            || s['user']  || '',
      profile:       s['profile']         || 'default',
      remoteAddress: s['remote-address']  || s['remote-address'] || null,
      localAddress:  s['local-address']   || null,
      comment:       s['comment']         || null,
      disabled:      s['disabled'] === 'true' || s['disabled'] === true,
      isOnline:      !!activeMap[s['name'] || s['user']],
      activeSession: activeMap[s['name']] ? {
        uptime:    activeMap[s['name']]['uptime'],
        address:   activeMap[s['name']]['address'],
        macAddr:   activeMap[s['name']]['mac-address'],
      } : null,
      alreadyImported: existingSet.has(s['name'] || s['user'] || '')
    })).filter(s => s.username !== ''); // remove entries without username

    res.json({
      success: true,
      data: {
        router:   { id: r.id, name: r.name, ip: r.ipAddress },
        profiles: profiles.map(p => p.name || p['name']).filter(Boolean),
        total:    mapped.length,
        online:   mapped.filter(s => s.isOnline).length,
        pending:  mapped.filter(s => !s.alreadyImported).length,
        secrets:  mapped
      }
    });

  } catch (e) {
    console.error('PPPoE preview error:', e);
    res.status(400).json({ success: false, error: e.message });
  }
});

// POST: Import selected PPPoE secrets INTO our DB
//       (writes to OUR database only, NOT to MikroTik)
router.post('/:id/import', async (req, res) => {
  try {
    const routerId  = Number(req.params.id);
    const { usernames } = req.body;

    if (!Array.isArray(usernames) || usernames.length === 0) {
      return res.status(400).json({
        success: false, error: 'No se enviaron usuarios a importar'
      });
    }

    const r  = await prisma.router.findUniqueOrThrow({
      where: { id: routerId }
    });
    const mk = new MikrotikService(r);

    // Read from MikroTik (GET only)
    let secrets = [];
    try {
      secrets = await mk.request('/ppp/secret');
      if (!Array.isArray(secrets)) secrets = [];
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: `No se pudo leer MikroTik: ${e.message}` 
      });
    }

    // Filter only selected
    const toImport = secrets.filter(s =>
      usernames.includes(s['name'] || s['user'] || '')
    );

    const results = { imported: 0, skipped: 0, errors: [] };

    for (const secret of toImport) {
      const username = secret['name'] || secret['user'] || '';
      if (!username) continue;

      try {
        // Skip if already exists
        const exists = await prisma.mikrotikAccount.findUnique({
          where: { username }
        });
        if (exists) { results.skipped++; continue; }

        // Derive a display name from comment or username
        const rawComment  = (secret['comment'] || '').trim();
        const displayName = rawComment || 
          username.replace(/^\d+/, '').replace(/_/g, ' ').trim() || 
          username;

        await prisma.$transaction(async (tx) => {
          // Create client record
          const client = await tx.client.create({
            data: {
              name:           displayName,
              email:          `${username}@imported.local`,
              phone:          '0000000000',
              address:        'Importado desde MikroTik',
              city:           'N/A',
              documentType:   'CC',
              documentNumber: username,  // placeholder — edit later
              status: (secret['disabled'] === 'true' || 
                       secret['disabled'] === true)
                        ? 'SUSPENDED' : 'ACTIVE',
              notes: `Importado desde MikroTik "${r.name}" (${r.ipAddress}) ` +
                     `el ${new Date().toLocaleDateString('es-CO')}` 
            }
          });

          // Create MikroTik account linked to client
          await tx.mikrotikAccount.create({
            data: {
              username,
              password:      secret['password']        || '',
              remoteAddress: secret['remote-address']  || null,
              localAddress:  secret['local-address']   || null,
              profileName:   secret['profile']         || 'default',
              status: (secret['disabled'] === 'true' || 
                       secret['disabled'] === true)
                        ? 'SUSPENDED' : 'ACTIVE',
              routerId: routerId,
              clientId: client.id
            }
          });
        });

        results.imported++;
      } catch (e) {
        console.error(`Import error for ${username}:`, e.message);
        results.errors.push({ username, error: e.message });
      }
    }

    // Update sync timestamp
    await prisma.router.update({
      where: { id: routerId },
      data:  { lastSyncAt: new Date() }
    });

    res.json({ success: true, data: results });

  } catch (e) {
    console.error('Import error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
