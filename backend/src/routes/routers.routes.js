import { Router } from 'express';
import { prisma } from '../config/database.js';
import { requireAdmin } from '../middleware/auth.middleware.js';
import { buildMikrotikService, testRouterCredentials } from '../services/mikrotik.service.js';
import { probeRouter } from '../services/router-monitor.service.js';

const router = Router();

// Always load routes alongside the router so callers can pick a dial-target
// without a second round-trip. Sorted by priority so r.routes[0] is the primary.
const ROUTER_INCLUDE = {
  _count: { select: { mikrotikAccounts: true } },
  routes: { orderBy: { priority: 'asc' } }
};

// Backwards-compat helper. Old callers used to template `${r.ipAddress}` into
// notes / display strings; now that the column is gone we surface the primary
// route's IP (priority=1) for those messages.
const primaryIp = (r) =>
  r?.routes?.find(rt => rt.priority === 1)?.ip ?? r?.routes?.[0]?.ip ?? '?';

// Normalize the routes array submitted from the UI: trim, drop empty rows,
// re-key by 1..N priority so the form's row order becomes the failover order.
// Returns null when the payload omits routes (caller should ignore the field
// instead of wiping them).
function normalizeRoutesInput(routes) {
  if (!Array.isArray(routes)) return null;
  const cleaned = routes
    .map(r => ({
      ip:    String(r?.ip ?? '').trim(),
      label: r?.label ? String(r.label).trim() : null
    }))
    .filter(r => r.ip);
  if (cleaned.length === 0) {
    throw new Error('Al menos una IP es requerida');
  }
  if (cleaned.length > 3) {
    throw new Error('Máximo 3 rutas por router');
  }
  const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
  for (const r of cleaned) {
    if (!ipRe.test(r.ip)) throw new Error(`IP inválida: ${r.ip}`);
  }
  return cleaned.map((r, idx) => ({
    ip:       r.ip,
    label:    r.label || (idx === 0 ? 'Enlace principal' : `Alternativa ${idx}`),
    priority: idx + 1
  }));
}

// Replace the router's routes set with `desired` (deleteMany+createMany inside
// a transaction). Doing a wholesale replace is simpler than diffing — at most
// 3 rows so the cost is negligible.
async function syncRoutes(routerId, desired) {
  return prisma.$transaction(async (tx) => {
    await tx.routerRoute.deleteMany({ where: { routerId } });
    for (const r of desired) {
      await tx.routerRoute.create({
        data: { routerId, ip: r.ip, label: r.label, priority: r.priority }
      });
    }
  });
}

// GET all routers
router.get('/', async (req, res) => {
  try {
    const routers = await prisma.router.findMany({
      include: ROUTER_INCLUDE,
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: routers });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST test credentials (no id required — used by the create flow).
// Accepts either `ip` (preferred) or `ipAddress` (legacy frontends).
router.post('/test', async (req, res) => {
  try {
    const { ip, ipAddress, apiPort = 80, username = 'admin', password = '' } = req.body || {};
    const dial = ip || ipAddress;
    if (!dial) {
      return res.status(400).json({ success: false, error: 'ip es requerido' });
    }
    const result = await testRouterCredentials({
      ip: dial,
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
      include: ROUTER_INCLUDE
    });
    res.json({ success: true, data: r });
  } catch (e) {
    res.status(404).json({ success: false, error: 'Router no encontrado' });
  }
});

// POST create router. `routes` is required (1..3 IPs). All other fields are
// passed through to the Router row.
router.post('/', async (req, res) => {
  try {
    const { routes: routesIn, _count, ...routerFields } = req.body || {};
    const desired = normalizeRoutesInput(routesIn);
    if (!desired) {
      return res.status(400).json({ success: false, error: 'routes es requerido' });
    }
    const created = await prisma.router.create({
      data: {
        ...routerFields,
        routes: { create: desired }
      },
      include: ROUTER_INCLUDE
    });
    res.status(201).json({ success: true, data: created });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// PUT update router. If `routes` is present, the route set is replaced; if
// absent, only scalar fields are updated.
router.put('/:id', async (req, res) => {
  try {
    const {
      id, createdAt, updatedAt, lastSyncAt, _count,
      routes: routesIn,
      status, activeRouteId, failCount, alertSent,    // monitor-managed; never trusted from the client
      ...data
    } = req.body || {};
    const routerId = Number(req.params.id);

    if (routesIn !== undefined) {
      const desired = normalizeRoutesInput(routesIn);
      if (desired) await syncRoutes(routerId, desired);
    }
    const updated = await prisma.router.update({
      where:   { id: routerId },
      data,
      include: ROUTER_INCLUDE
    });
    res.json({ success: true, data: updated });
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

// POST test connection — dials the router via the active route resolver.
router.post('/:id/test', async (req, res) => {
  try {
    const r = await prisma.router.findUniqueOrThrow({
      where:   { id: Number(req.params.id) },
      include: ROUTER_INCLUDE
    });
    const mk     = buildMikrotikService(r);
    const result = await mk.testConnection();
    res.json({ success: true, data: { ...result, dialIp: mk.ip } });
  } catch (e) {
    res.status(400).json({
      success: false,
      error: e.message || 'No se pudo conectar al router'
    });
  }
});

// POST probe all routes now (UI "Probar rutas"). Runs the same code path as
// the periodic sweep so per-route status + router-level status get persisted
// and the Telegram gating logic applies consistently.
router.post('/:id/test-routes', async (req, res) => {
  try {
    const result = await probeRouter(Number(req.params.id));
    const summary = {
      router:        { id: result.router.id, name: result.router.name, status: result.router.status },
      activeRouteId: result.router.activeRouteId,
      routes:        result.routes
        .sort((a, b) => a.route.priority - b.route.priority)
        .map(p => ({
          id:        p.route.id,
          ip:        p.route.ip,
          priority:  p.route.priority,
          label:     p.route.label,
          status:    p.alive ? 'ONLINE' : 'OFFLINE',
          latency:   p.latency
        }))
    };
    res.json({ success: true, data: summary });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// POST sync PPPoE secrets from MikroTik
router.post('/:id/sync', async (req, res) => {
  try {
    const r  = await prisma.router.findUniqueOrThrow({
      where:   { id: Number(req.params.id) },
      include: ROUTER_INCLUDE
    });
    const mk      = buildMikrotikService(r);
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
      where:   { id: Number(req.params.id) },
      include: ROUTER_INCLUDE
    });
    const mk   = buildMikrotikService(r);
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
      where:   { id: Number(req.params.id) },
      include: ROUTER_INCLUDE
    });
    const mk       = buildMikrotikService(r);
    const profiles = await mk.getPPPoEProfiles();
    res.json({ success: true, data: profiles });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// GET PPP profiles from MikroTik, normalized with sync metadata.
// Returns profiles enriched with:
//   - isBuiltin  (default / default-encryption are protected)
//   - inUse      (at least one MikrotikAccount references it)
//   - linkedToPlan (at least one Plan references it by mikrotikProfile or name)
router.get('/:id/ppp-profiles', async (req, res) => {
  try {
    const r = await prisma.router.findUniqueOrThrow({
      where:   { id: Number(req.params.id) },
      include: ROUTER_INCLUDE
    });
    if (!r.isActive) {
      return res.status(409).json({ success: false, error: `Router "${r.name}" está desactivado.` });
    }
    const mk = buildMikrotikService(r);

    const [rawProfiles, accounts, plans] = await Promise.all([
      mk.getPPPoEProfiles().catch(() => []),
      prisma.mikrotikAccount.findMany({ select: { profileName: true } }),
      prisma.plan.findMany({ select: { name: true, mikrotikProfile: true } })
    ]);

    const profileNamesInUse = new Set(accounts.map(a => a.profileName).filter(Boolean));
    const profileNamesReferenced = new Set();
    for (const p of plans) {
      if (p.mikrotikProfile) profileNamesReferenced.add(p.mikrotikProfile);
      else if (p.name) profileNamesReferenced.add(p.name);
    }
    const BUILTIN = new Set(['default', 'default-encryption']);

    const profiles = (Array.isArray(rawProfiles) ? rawProfiles : []).map(p => ({
      id:           p['.id'] || null,
      name:         p.name || p['name'] || '',
      rateLimit:    p['rate-limit'] || null,
      localAddress: p['local-address'] || null,
      remoteAddress: p['remote-address'] || null,
      onlyOne:      p['only-one'] || null,
      comment:      p.comment || null,
      isBuiltin:    BUILTIN.has(p.name || p['name']),
      inUse:        profileNamesInUse.has(p.name || p['name']),
      linkedToPlan: profileNamesReferenced.has(p.name || p['name']),
    }));

    res.json({ success: true, data: { profiles, totals: {
      total:    profiles.length,
      builtin:  profiles.filter(p => p.isBuiltin).length,
      inUse:    profiles.filter(p => p.inUse).length,
      linked:   profiles.filter(p => p.linkedToPlan).length,
      free:     profiles.filter(p => !p.isBuiltin && !p.inUse && !p.linkedToPlan).length,
    } } });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// POST create a PPP profile on the router. Optionally link it to a local plan
// by setting the plan's mikrotikProfile field afterward.
router.post('/:id/ppp-profiles', async (req, res) => {
  try {
    const r = await prisma.router.findUniqueOrThrow({
      where:   { id: Number(req.params.id) },
      include: ROUTER_INCLUDE
    });
    if (!r.isActive) {
      return res.status(409).json({ success: false, error: `Router "${r.name}" está desactivado.` });
    }
    const mk = buildMikrotikService(r);
    const { name, rateLimit, localAddress, remoteAddress, onlyOne, parentQueue } = req.body || {};
    if (!name) {
      return res.status(400).json({ success: false, error: 'name es requerido' });
    }
    const result = await mk.createPPPoEProfile({ name, rateLimit, localAddress, remoteAddress, onlyOne, parentQueue });
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// GET unlinked PPP profiles — profiles that exist on the router but
// NO local Plan references them (by mikrotikProfile or name).
// Returns two lists:
//   - orphans:  safe to delete (not referenced by any plan AND no secret uses them)
//   - inUse:    has active PPPoE secrets but no local plan (informational)
router.get('/:id/ppp-profiles/orphans', async (req, res) => {
  try {
    const r = await prisma.router.findUniqueOrThrow({
      where:   { id: Number(req.params.id) },
      include: ROUTER_INCLUDE
    });
    if (!r.isActive) {
      return res.status(409).json({ success: false, error: `Router "${r.name}" está desactivado.` });
    }
    const mk = buildMikrotikService(r);

    const [profiles, secrets, plans] = await Promise.all([
      mk.getPPPoEProfiles().catch(() => []),
      mk.getPPPoESecrets().catch(() => []),
      prisma.plan.findMany({ select: { name: true, mikrotikProfile: true } })
    ]);

    const secretProfiles = new Set(
      (Array.isArray(secrets) ? secrets : [])
        .map(s => s.profile || s['profile'])
        .filter(Boolean)
    );
    const referenced = new Set();
    for (const p of plans) {
      if (p.mikrotikProfile) referenced.add(p.mikrotikProfile);
      else if (p.name)       referenced.add(p.name);
    }
    const BUILTIN = new Set(['default', 'default-encryption']);

    const all = (Array.isArray(profiles) ? profiles : []).map(p => ({
      name:      p.name || p['name'],
      rateLimit: p['rate-limit'] || null,
      comment:   p.comment || null,
      builtin:   BUILTIN.has(p.name || p['name']),
    }));

    const orphans = all.filter(p => p.name && !p.builtin && !secretProfiles.has(p.name) && !referenced.has(p.name));
    const inUseUnlinked = all.filter(p => p.name && !p.builtin && secretProfiles.has(p.name) && !referenced.has(p.name));

    res.json({ success: true, data: { orphans, inUseUnlinked, totals: {
      profiles:       profiles.length,
      builtin:        all.filter(p => p.builtin).length,
      referenced:     referenced.size,
      orphans:        orphans.length,
      inUseUnlinked:  inUseUnlinked.length,
    } } });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// DELETE a PPP profile by name on the device. Refuses to delete built-in
// profiles. Caller decides whether to also delete the matching local Plan.
router.delete('/:id/ppp-profiles/:profileName', async (req, res) => {
  try {
    const r = await prisma.router.findUniqueOrThrow({
      where:   { id: Number(req.params.id) },
      include: ROUTER_INCLUDE
    });
    if (!r.isActive) {
      return res.status(409).json({ success: false, error: `Router "${r.name}" está desactivado.` });
    }
    const mk = buildMikrotikService(r);
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
    const r = await prisma.router.findUniqueOrThrow({
      where:   { id: Number(req.params.id) },
      include: ROUTER_INCLUDE
    });
    if (!r.isActive) {
      return res.status(409).json({ success: false, error: `Router "${r.name}" está desactivado.` });
    }

    const mk = buildMikrotikService(r);

    // Connectivity pre-check: a cheap ping (1.5s, 1 retry) so we fail fast
    // with a clean message when the router is simply unreachable, instead of
    // bubbling a generic "fetch failed".
    try {
      await mk.request('/system/identity', 'GET', null, { retries: 1, timeoutMs: 2500 });
    } catch (e) {
      const reachableHint = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|Timeout/i.test(e.message)
        ? `Verifica que el router "${r.name}" (${mk.ip}) esté encendido, en la red y con la REST API habilitada.`
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
            notes:          `Importado desde MikroTik "${r.name}" (${primaryIp(r)}) el ${new Date().toISOString().slice(0,10)}.`,
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
      where:   { id: Number(req.params.id) },
      include: ROUTER_INCLUDE
    });
    const mk = buildMikrotikService(r);

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
      where:   { id: Number(req.params.id) },
      include: ROUTER_INCLUDE
    });
    const mk     = buildMikrotikService(r);
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
      where:   { id: Number(req.params.id) },
      include: ROUTER_INCLUDE
    });
    const mk = buildMikrotikService(r);

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
        router:   { id: r.id, name: r.name, ip: primaryIp(r) },
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
      where:   { id: routerId },
      include: ROUTER_INCLUDE
    });
    const mk = buildMikrotikService(r);

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
              notes: `Importado desde MikroTik "${r.name}" (${primaryIp(r)}) ` +
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
