// Background ICMP monitor for Network Devices.
//
// Loops every POLL_INTERVAL_MS, pings every device, derives the new status
// from latency+packet-loss, persists a NetworkEvent only on transitions
// (up→down, down→up, up→unstable, etc.) and pushes the new state to all
// connected clients via socket.io. On down/recovery transitions also fires
// the Telegram alert.
//
// Single in-process instance is enough for the project scale (≤30 nodes).
import ping from 'ping';
import { prisma } from '../server.js';
import { emit } from './socket.service.js';
import { alertDown, alertRecovery } from './telegram.service.js';

const POLL_INTERVAL_MS = 30_000;
const PING_TIMEOUT_SEC = 2;
const PING_PACKETS     = 2;

// Latency above this (ms) flips ONLINE → UNSTABLE.
const UNSTABLE_LATENCY_MS = 200;
// Packet loss above this (%) flips ONLINE → UNSTABLE.
const UNSTABLE_LOSS_PCT   = 50;

let timer = null;

/** Returns { status, latency, loss }. */
async function probe(ip) {
  let res;
  try {
    res = await ping.promise.probe(ip, {
      timeout: PING_TIMEOUT_SEC,
      min_reply: 1,
      extra: ['-c', String(PING_PACKETS)]
    });
  } catch {
    return { status: 'OFFLINE', latency: null, loss: 100 };
  }

  const loss = parseFloat(res.packetLoss);
  const lossPct = Number.isFinite(loss) ? loss : (res.alive ? 0 : 100);

  if (!res.alive || lossPct >= 100) {
    return { status: 'OFFLINE', latency: null, loss: 100 };
  }

  const latency = parseFloat(res.avg);
  const lat = Number.isFinite(latency) ? latency : null;

  if (lossPct >= UNSTABLE_LOSS_PCT || (lat !== null && lat >= UNSTABLE_LATENCY_MS)) {
    return { status: 'UNSTABLE', latency: lat, loss: lossPct };
  }
  return { status: 'ONLINE', latency: lat, loss: lossPct };
}

/** Run one full sweep. Exported so tests / the API can trigger it on demand. */
export async function runSweep() {
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
      const probed = await probe(dev.ip);
      const oldStatus = dev.status;
      const newStatus = probed.status;
      const transitioned = oldStatus !== newStatus;

      const updated = await prisma.networkDevice.update({
        where: { id: dev.id },
        data: {
          status:   newStatus,
          latency:  probed.latency,
          lastSeen: probed.status === 'OFFLINE' ? dev.lastSeen : new Date()
        }
      });

      // Push the live state to the UI regardless (so latency updates show up).
      emit('device:update', {
        id: updated.id,
        status: updated.status,
        latency: updated.latency,
        loss: probed.loss,
        lastSeen: updated.lastSeen
      });

      if (!transitioned) return;
      transitions++;

      const message = `Estado cambió de ${oldStatus} a ${newStatus}`;
      const event = await prisma.networkEvent.create({
        data: {
          deviceId: dev.id,
          status:   newStatus,
          latency:  probed.latency,
          loss:     probed.loss,
          message
        }
      });

      emit('device:event', {
        id: event.id,
        deviceId: dev.id,
        status: newStatus,
        latency: probed.latency,
        loss: probed.loss,
        message,
        createdAt: event.createdAt
      });

      // Telegram alerts — fire-and-forget so a bad bot config never stalls
      // the sweep. We mark notified=true only if the send returns ok.
      const zoneName = dev.zone?.name;
      const shouldAlertDown     = newStatus === 'OFFLINE';
      const shouldAlertRecovery = oldStatus === 'OFFLINE' && newStatus !== 'OFFLINE';

      if (shouldAlertDown) {
        alertDown(dev, zoneName).then(async (r) => {
          if (r.ok) await prisma.networkEvent.update({ where: { id: event.id }, data: { notified: true } });
        }).catch(() => {});
      } else if (shouldAlertRecovery) {
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

export function startMonitor() {
  if (timer) return;
  // First sweep after a short delay so the API can finish booting cleanly.
  setTimeout(() => {
    runSweep().catch(e => console.error('[monitor] sweep failed:', e.message));
    timer = setInterval(() => {
      runSweep().catch(e => console.error('[monitor] sweep failed:', e.message));
    }, POLL_INTERVAL_MS);
  }, 3_000);
  console.log(`📡 Network monitor scheduled (every ${POLL_INTERVAL_MS / 1000}s)`);
}

export function stopMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
}
