// Single entry point para registrar workers de BullMQ.
//
// IMPORTANTE: este archivo NO se importa todavía desde server.js.
// Mientras esté así, ningún worker está corriendo — la cola está
// instalada pero dormida. Cuando un job esté listo para producción:
//
//   1. Reemplaza el placeholder de abajo por el `createWorker` real.
//   2. En server.js, agrega `import './jobs/queue.bootstrap.js';`
//      ANTES del listen().
//   3. Para apagado limpio, llamar `shutdownQueues()` en el handler de
//      SIGTERM/SIGINT (ya está exportado de queue.service.js).
//
// Patrón recomendado por job:
//
//   - El productor (controller/service) hace `createQueue('foo').add(...)`.
//     Es síncrono y barato — puede llamarse desde una request handler.
//   - El consumidor vive aquí: `createWorker('foo', async (job) => {...})`.
//     Cada `createWorker` consume su cola en background.
//
// Ejemplo (comentado para no activarlo accidentalmente):
//
//   import { createWorker } from '../services/queue.service.js';
//   import { invoiceService } from '../services/invoice.service.js';
//
//   createWorker('billing.monthly', async (job) => {
//     const { month } = job.data;            // '2026-06'
//     return invoiceService.generateForMonth(month);
//   }, { concurrency: 1 });

// Marker export — nothing runs by importing this file today.
export const queueBootstrapLoaded = true;
