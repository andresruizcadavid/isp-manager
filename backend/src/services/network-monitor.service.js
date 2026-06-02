// Background ICMP monitor for Network Devices.
//
// Polling cadence, ping timeout and the "down count" threshold all come from
// the single TelegramConfig row — that row doubles as MonitorSettings (style:
// MikroTik The Dude → Probe Interval / Timeout / Down Count). Settings are
// re-read every tick so changes from the UI take effect within one cycle, no
// restart required.
//
// State machine per device:
//   ping success  → status = ONLINE | UNSTABLE; failCount = 0;
//                   if alertSent → send recovery, alertSent = false
//   ping failure  → failCount++
//                   once failCount ≥ probeDownCount:
//                     status = OFFLINE
//                     if !alertSent → send down-alert, alertSent = true
//                   otherwise status stays as it was (silent flap)
//
// NetworkEvent rows are written only on *effective* status transitions, so a
// momentary 1-of-2 failed ping leaves no trace.
//
// Single in-process instance is enough for the project scale (≤30 nodes).
import ping from 'ping';
import { prisma } from '../config/database.js';
import { emit } from './socket.service.js';
import { alertDown, alertRecovery } from './telegram.service.js';

// Fallback values used when no TelegramConfig row exists yet.
const DEFAULT_INTERVAL_SEC   = 30;
const DEFAULT_TIMEOUT_SEC    = 5;
const DEFAULT_DOWN_COUNT     = 2;

const PING_PACKETS           = 2;
// Latency above this (ms) flips a successful probe to UNSTABLE.
const UNSTABLE_LATENCY_MS    = 200;
// Packet loss above this (%) flips a successful probe to UNSTABLE.
const UNSTABLE_LOSS_PCT      = 50;

let timer = null;
let stopped = true;

/** Returns { reachable, status, latency, loss } from a single probe. */
async function probe(ip, timeoutSec) {
  let res;
  try {
    res = await ping.promise.probe(ip, {
      timeout: timeoutSec,
      min_reply: 1,
      extra: ['-c', String(PING_PACKETS)]
    });
  } catch {
    return { reachable: false, status: 'OFFLINE', latency: null, loss: 100 };
  }

  const loss = parseFloat(res.packetLoss);
  const lossPct = Number.isFinite(loss) ? loss : (res.alive ? 0 : 100);

  if (!res.alive || lossPct >= 100) {
    return { reachable: false, status: 'OFFLINE', latency: null, loss: 100 };
  }

  const latency = parseFloat(res.avg);
  const lat = Number.isFinite(latency) ? latency : null;

  if (lossPct >= UNSTABLE_LOSS_PCT || (lat !== null && lat >= UNSTABLE_LATENCY_MS)) {
    return { reachable: true, status: 'UNSTABLE', latency: lat, loss: lossPct };
  }
  return { reachable: true, status: 'ONLINE', latency: lat, loss: lossPct };
}

/** Pull the live monitor settings (single-row TelegramConfig). Null-safe. */
async function loadSettings() {
  const cfg = await prisma.telegramConfig.findFirst();
  return {
    probeIntervalSec: cfg?.probeIntervalSec ?? DEFAULT_INTERVAL_SEC,
    probeTimeoutSec:  cfg?.probeTimeoutSec  ?? DEFAULT_TIMEOUT_SEC,
    probeDownCount:   cfg?.probeDownCount   ?? DEFAULT_DOWN_COUNT
  };
}

/**
 * Run one full sweep. Exported so tests / the manual-probe API can fire it on
 * demand without waiting for the scheduler.
 */
export async function runSweep() {
  const settings = await loadSettings();
  const { probeTimeoutSec, probeDownCount } = settings;

  const devices = await prisma.networkDevice.findMany({
    include: { zone: { select: { name: true } } }
  });
  if (devices.length === 0) return { swept: 0, transitions: 0 };

  let transitions = 0;

  // Limit concurrency to avoid hammering the box if someone adds many nodes.
  const BATCH = 8;
  for (let i = 0; i < devices.length; i += BATCH) {
    const batch = devices.slice(i, i + BATCH);
    await Promise.all(batch.map(async (dev) => {
      const probed = await probe(dev.ip, probeTimeoutSec);

      // Apply the state machine. effectiveStatus is what the UI sees and what
      // we persist; it may differ from probed.status during the silent
      // "still ringing the doorbell" window before probeDownCount is hit.
      const oldStatus = dev.status;
      const wasAlerted = dev.alertSent;
      let newFailCount = dev.failCount;
      let newAlertSent = dev.alertSent;
      let effectiveStatus = oldStatus;
      let willAlertDown = false;
      let willAlertRecovery = false;

      if (probed.reachable) {
        effectiveStatus = probed.status; // ONLINE or UNSTABLE
        newFailCount = 0;
        if (wasAlerted) {
          willAlertRecovery = true;
          newAlertSent = false;
        }
      } else {
        newFailCount = dev.failCount + 1;
        if (newFailCount >= probeDownCount) {
          effectiveStatus = 'OFFLINE';
          if (!wasAlerted) {
            willAlertDown = true;
            newAlertSent = true;
          }
        }
        // else: not enough consecutive failures yet — keep prior status,
        // suppress UI flips and Telegram noise.
      }

      const transitioned = oldStatus !== effectiveStatus;

      const updated = await prisma.networkDevice.update({
        where: { id: dev.id },
        data: {
          status:    effectiveStatus,
          latency:   probed.latency,
          lastSeen:  probed.reachable ? new Date() : dev.lastSeen,
          failCount: newFailCount,
          alertSent: newAlertSent
        }
      });

      // Always push the live state so latency/last-seen refresh on the UI.
      emit('device:update', {
        id: updated.id,
        status: updated.status,
        latency: updated.latency,
        loss: probed.loss,
        lastSeen: updated.lastSeen
      });

      if (!transitioned) return;
      transitions++;

      const message = `Estado cambió de ${oldStatus} a ${effectiveStatus}`;
      const event = await prisma.networkEvent.create({
        data: {
          deviceId: dev.id,
          status:   effectiveStatus,
          latency:  probed.latency,
          loss:     probed.loss,
          message
        }
      });

      emit('device:event', {
        id: event.id,
        deviceId: dev.id,
        status: effectiveStatus,
        latency: probed.latency,
        loss: probed.loss,
        message,
        createdAt: event.createdAt
      });

      // Telegram alerts — fire-and-forget so a bad bot config never stalls
      // the sweep. We mark notified=true only if the send returns ok. The
      // alertOnDown/alertOnRecovery flags are checked inside telegram.service
      // via the active config row, so respecting them here is implicit.
      const zoneName = dev.zone?.name;

      if (willAlertDown) {
        alertDown(dev, zoneName).then(async (r) => {
          if (r.ok) await prisma.networkEvent.update({ where: { id: event.id }, data: { notified: true } });
        }).catch(() => {});
      } else if (willAlertRecovery) {
        // Find when it went down: most recent OFFLINE event for this device.
        const lastDown = await prisma.networkEvent.findFirst({
          where: { deviceId: dev.id, status: 'OFFLINE' },
          orderBy: { createdAt: 'desc' }
        });
        alertRecovery(dev, lastDown?.createdAt).then(async (r) => {
          if (r.ok) await prisma.networkEvent.update({ where: { id: event.id }, data: { notified: true } });
        }).catch(() => {});
      }
    }));
  }

  return { swept: devices.length, transitions };
}

// Self-rescheduling tick. We use recursive setTimeout (not setInterval) so the
// next delay is read fresh from settings every cycle — any change made in the
// UI applies on the very next tick, no restart needed.
async function tick() {
  if (stopped) return;
  let nextDelayMs = DEFAULT_INTERVAL_SEC * 1000;
  try {
    const { probeIntervalSec } = await loadSettings();
    nextDelayMs = Math.max(1, probeIntervalSec) * 1000;
    await runSweep();
  } catch (e) {
    console.error('[monitor] sweep failed:', e.message);
  } finally {
    if (!stopped) timer = setTimeout(tick, nextDelayMs);
  }
}

export function startMonitor() {
  if (timer || !stopped) return;
  stopped = false;
  // First sweep after a short delay so the API can finish booting cleanly.
  timer = setTimeout(tick, 3_000);
  console.log('📡 Network monitor scheduled (interval driven by TelegramConfig.probeIntervalSec)');
}

export function stopMonitor() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
