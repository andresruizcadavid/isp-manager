// BullMQ scaffolding.
//
// Why this file exists: today the only "background work" in the API
// (campañas de notificaciones, sweeps de ICMP) corre en proceso del web
// server. Para ≤200 clientes esto está bien, pero impide escalar
// horizontalmente y deja huérfanos al reiniciar.
//
// Esta capa expone una conexión Redis compartida y dos helpers
// (`createQueue` / `createWorker`) para empezar a mover esos jobs sin
// reescribir cada llamado. No activa ningún worker por sí sola — la idea
// es que cada job decida cuándo registrarse (ver `jobs/queue.bootstrap.js`).
//
// Reglas de operación:
//   • Una sola instancia de IORedis para Queues y Workers (BullMQ exige
//     `maxRetriesPerRequest: null` en el cliente que se le pasa).
//   • Si REDIS_URL apunta a un Redis caído, fail loud — la cola no debe
//     "funcionar a medias".
//   • Las colas no se inicializan eagerly; quien las necesite las pide
//     vía `createQueue()`, que cachea por nombre.

import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env.js';

// BullMQ requires `maxRetriesPerRequest: null` to avoid the client
// retrying long-blocking commands like BLPOP. A separate connection from
// the cache redis client (which uses retries) is intentional.
const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

connection.on('error', (err) => {
  // Don't crash the API on a transient Redis blip — the workers themselves
  // will retry their jobs. Just log so it's visible in ops.
  console.error('[queue] redis error:', err.message);
});

const queues   = new Map();   // name → Queue
const workers  = new Map();   // name → Worker
const eventBus = new Map();   // name → QueueEvents

/**
 * Get-or-create a named Queue. Idempotent: returns the same instance
 * across the lifetime of the process. Use this from any controller / job
 * that needs to enqueue work.
 *
 *   const q = createQueue('billing.monthly');
 *   await q.add('generate', { month: '2026-06' }, { jobId: '2026-06' });
 */
export function createQueue(name, opts = {}) {
  if (!name) throw new Error('createQueue: name is required');
  if (queues.has(name)) return queues.get(name);
  const q = new Queue(name, {
    connection,
    defaultJobOptions: {
      // Sensible defaults — callers can override per-add.
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
      removeOnFail:     { age: 30 * 24 * 3600 },
      ...opts.defaultJobOptions
    },
    ...opts
  });
  queues.set(name, q);
  return q;
}

/**
 * Register a worker for a queue. The handler signature is the standard
 * BullMQ one: `async (job) => result`. Returns the Worker so the caller
 * can attach listeners if needed.
 *
 *   createWorker('billing.monthly', async (job) => {
 *     await invoiceService.generateForMonth(job.data.month);
 *   }, { concurrency: 1 });
 */
export function createWorker(name, handler, opts = {}) {
  if (!name)        throw new Error('createWorker: name is required');
  if (!handler)     throw new Error('createWorker: handler is required');
  if (workers.has(name)) {
    throw new Error(`createWorker: a worker for "${name}" is already registered in this process`);
  }
  const worker = new Worker(name, handler, {
    connection,
    concurrency: 1,
    ...opts
  });
  worker.on('failed', (job, err) => {
    console.error(`[queue:${name}] job ${job?.id} failed:`, err.message);
  });
  worker.on('error', (err) => {
    console.error(`[queue:${name}] worker error:`, err.message);
  });
  workers.set(name, worker);
  return worker;
}

/**
 * Optional: attach a global event bus for a queue (useful for sockets-
 * pushed progress). Lazy — only created on first request per queue.
 */
export function getQueueEvents(name) {
  if (eventBus.has(name)) return eventBus.get(name);
  const ev = new QueueEvents(name, { connection });
  eventBus.set(name, ev);
  return ev;
}

/**
 * Graceful shutdown — called from server.js on SIGTERM. Closes every
 * worker first (to let in-flight jobs finish), then queues, then the
 * shared Redis connection.
 */
export async function shutdownQueues() {
  for (const [name, w] of workers) {
    try { await w.close(); }
    catch (e) { console.error(`[queue] worker ${name} close error:`, e.message); }
  }
  for (const [name, q] of queues) {
    try { await q.close(); }
    catch (e) { console.error(`[queue] queue ${name} close error:`, e.message); }
  }
  for (const [name, ev] of eventBus) {
    try { await ev.close(); }
    catch (e) { console.error(`[queue] events ${name} close error:`, e.message); }
  }
  try { await connection.quit(); } catch { /* already closed */ }
}

export { connection };
