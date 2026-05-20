// ICMP monitor for Router routes (failover engine).
//
// Every sweep pings every RouterRoute, persists per-route status/latency, then
// derives the router-level status:
//
//   ONLINE   = primary route (priority=1) is up
//   DEGRADED = primary is down, at least one alternative is up
//   OFFLINE  = every route is down for ≥ probeDownCount consecutive sweeps
//   UNKNOWN  = no route probed yet
//
// activeRouteId always points at the first ONLINE route by priority (null if
// none) — that's what buildMikrotikService() uses to pick the dial-target.
//
// Telegram alerts are fired only when the router-level status flips fully to
// OFFLINE (gated by Router.alertSent so we don't re-page on every sweep) and
// when it recovers from OFFLINE (gated by alertSent so we don't send a
// "recuperado" if we never said it was down). Routes flipping between
// ONLINE/OFFLINE within a router that's still partially up don't notify —
// the operator sees them in the UI but the alarm is for service-impact only.
//
// Reuses the global TelegramConfig polling params (probeIntervalSec /
// probeTimeoutSec / probeDownCount) so the operator tunes everything from
// one place.
import ping from 'ping';
import { prisma } from '../server.js';
import { emit } from './socket.service.js';
import { sendMessage } from './telegram.service.js';

const DEFAULT_INTERVAL_SEC = 30;
const DEFAULT_TIMEOUT_SEC  = 5;
const DEFAULT_DOWN_COUNT   = 2;
const PING_PACKETS         = 2;

let timer = null;
let stopped = true;

/** Returns { alive, latency } from a single probe. */
async function probe(ip, timeoutSec) {
  try {
    const res = await ping.promise.probe(ip, {
      timeout:   timeoutSec,
      min_reply: 1,
      extra:     ['-c', String(PING_PACKETS)]
    });
    if (!res.alive) return { alive: false, latency: null };
    const lat = parseFloat(res.avg);
    return { alive: true, latency: Number.isFinite(lat) ? lat : null };
  } catch {
    return { alive: false, latency: null };
  }
}

async function loadSettings() {
  const cfg = await prisma.telegramConfig.findFirst();
  return {
    probeIntervalSec: cfg?.probeIntervalSec ?? DEFAULT_INTERVAL_SEC,
    probeTimeoutSec:  cfg?.probeTimeoutSec  ?? DEFAULT_TIMEOUT_SEC,
    probeDownCount:   cfg?.probeDownCount   ?? DEFAULT_DOWN_COUNT
  };
}

/**
 * Apply the failover state machine to a single router.
 * Pure function — no DB writes here. Returns the patch to apply.
 */
function deriveRouterPatch(router, probedRoutes, probeDownCount) {
  // probedRoutes = [{ route, alive, latency }] sorted by priority asc.
  const anyAlive    = probedRoutes.some(r => r.alive);
  const primary     = probedRoutes.find(r => r.route.priority === 1);
  const primaryUp   = !!primary?.alive;
  const firstAlive  = probedRoutes.find(r => r.alive);

  let newStatus;
  if (!anyAlive)        newStatus = 'OFFLINE';
  else if (primaryUp)   newStatus = 'ONLINE';
  else                  newStatus = 'DEGRADED';

  // Gate the OFFLINE flip + alert behind probeDownCount consecutive sweeps,
  // same shape as NetworkDevice. If at least one route is alive, reset.
  let newFailCount = router.failCount;
  let newAlertSent = router.alertSent;
  let effectiveStatus = newStatus;
  let fireDown = false;
  let fireRecovery = false;

  if (anyAlive) {
    newFailCount = 0;
    if (router.alertSent) {
      fireRecovery = true;
      newAlertSent = false;
    }
  } else {
    newFailCount = router.failCount + 1;
    if (newFailCount >= probeDownCount) {
      // Real OFFLINE — confirmed.
      if (!router.alertSent) {
        fireDown = true;
        newAlertSent = true;
      }
    } else {
      // Not enough consecutive failures yet — don't surface OFFLINE to the UI
      // or the failover resolver. Keep previous status to suppress flapping.
      effectiveStatus = router.status === 'OFFLINE' ? 'OFFLINE' : router.status;
    }
  }

  return {
    status:        effectiveStatus,
    activeRouteId: firstAlive ? firstAlive.route.id : null,
    failCount:     newFailCount,
    alertSent:     newAlertSent,
    fireDown,
    fireRecovery
  };
}

function fmtTime(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function alertRouterDown(router, probedRoutes) {
  const lines = [
    '🔴 <b>ROUTER CAÍDO</b> — todas las rutas sin respuesta',
    `Router: <b>${router.name}</b>`,
    ...probedRoutes.map(r =>
      `  • <code>${r.route.ip}</code> (P${r.route.priority}) ❌`
    ),
    `Hora: ${fmtTime()}`
  ];
  if (router.location) lines.splice(2, 0, `Ubicación: ${router.location}`);
  return sendMessage(lines.join('\n'));
}

async function alertRouterRecovered(router, probedRoutes) {
  const lines = [
    '✅ <b>ROUTER RECUPERADO</b>',
    `Router: <b>${router.name}</b>`,
    ...probedRoutes
      .filter(r => r.alive)
      .map(r => `  • <code>${r.route.ip}</code> (P${r.route.priority}) ✓ ${r.latency?.toFixed(1) ?? '?'} ms`),
    `Hora: ${fmtTime()}`
  ];
  return sendMessage(lines.join('\n'));
}

/**
 * Probe every route of a single router in parallel and persist the result.
 * Exported so the manual "Probar rutas" button can reuse the exact same code
 * path (and benefit from the same Telegram gating).
 */
export async function probeRouter(routerId) {
  const router = await prisma.router.findUnique({
    where:   { id: Number(routerId) },
    include: { routes: { orderBy: { priority: 'asc' } } }
  });
  if (!router) throw new Error(`Router ${routerId} no existe`);
  if (router.routes.length === 0) {
    return { router, routes: [], patch: null };
  }

  const { probeTimeoutSec, probeDownCount } = await loadSettings();

  const probedRoutes = await Promise.all(
    router.routes.map(async (route) => {
      const r = await probe(route.ip, probeTimeoutSec);
      return { route, alive: r.alive, latency: r.latency };
    })
  );

  // Persist per-route status.
  const now = new Date();
  await Promise.all(probedRoutes.map(p => prisma.routerRoute.update({
    where: { id: p.route.id },
    data: {
      status:     p.alive ? 'ONLINE' : 'OFFLINE',
      latency:    p.latency,
      lastPingAt: now
    }
  })));

  const patch = deriveRouterPatch(router, probedRoutes, probeDownCount);
  const updated = await prisma.router.update({
    where: { id: router.id },
    data: {
      status:        patch.status,
      activeRouteId: patch.activeRouteId,
      failCount:     patch.failCount,
      alertSent:     patch.alertSent
    }
  });

  // Live push so the NOC list/edit pages update without polling.
  emit('router:update', {
    id:            updated.id,
    status:        updated.status,
    activeRouteId: updated.activeRouteId,
    routes: probedRoutes.map(p => ({
      id:        p.route.id,
      ip:        p.route.ip,
      priority:  p.route.priority,
      status:    p.alive ? 'ONLINE' : 'OFFLINE',
      latency:   p.latency,
      lastPingAt: now
    }))
  });

  // Telegram alerts — fire-and-forget. We pass the post-update probedRoutes
  // so the message includes fresh latency info.
  if (patch.fireDown) {
    alertRouterDown(updated, probedRoutes).catch(() => {});
  } else if (patch.fireRecovery) {
    alertRouterRecovered(updated, probedRoutes).catch(() => {});
  }

  return { router: updated, routes: probedRoutes, patch };
}

/** Full sweep across every router. Skips disabled routers. */
export async function runRouterSweep() {
  const routers = await prisma.router.findMany({
    where: { isActive: true },
    select: { id: true }
  });
  if (routers.length === 0) return { swept: 0 };

  // Per-router serial inside the sweep is fine for project scale (≤10 routers).
  for (const r of routers) {
    try {
      await probeRouter(r.id);
    } catch (e) {
      console.error(`[router-monitor] router=${r.id} sweep failed:`, e.message);
    }
  }
  return { swept: routers.length };
}

async function tick() {
  if (stopped) return;
  let nextDelayMs = DEFAULT_INTERVAL_SEC * 1000;
  try {
    const { probeIntervalSec } = await loadSettings();
    nextDelayMs = Math.max(1, probeIntervalSec) * 1000;
    await runRouterSweep();
  } catch (e) {
    console.error('[router-monitor] sweep failed:', e.message);
  } finally {
    if (!stopped) timer = setTimeout(tick, nextDelayMs);
  }
}

export function startRouterMonitor() {
  if (timer || !stopped) return;
  stopped = false;
  // First sweep after a short delay so the API can finish booting.
  timer = setTimeout(tick, 4_000);
  console.log('🛰️  Router monitor scheduled (interval driven by TelegramConfig.probeIntervalSec)');
}

export function stopRouterMonitor() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
