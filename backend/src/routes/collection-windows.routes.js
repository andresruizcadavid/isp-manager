// Collection windows — CRUD + manual tick trigger.

import { Router } from 'express';
import { z } from 'zod';
import { collectionWindowsController } from '../controllers/collection-windows.controller.js';
import { validateBody, validateParams, commonSchemas } from '../middleware/validate.middleware.js';

const router = Router();

const channelEnum = z.enum(['EMAIL','WHATSAPP','TELEGRAM']);
const statusEnum  = z.enum(['PENDING','OVERDUE','PARTIAL']);

const createSchema = z.object({
  name:               z.string().min(2).max(120),
  startDate:          z.string().datetime(),
  endDate:            z.string().datetime(),
  targetStatuses:     z.array(statusEnum).min(1).max(3).optional(),
  channels:           z.array(channelEnum).min(1).max(3).optional(),
  sendFrequencyHours: z.number().int().min(1).max(168).optional(),
  messageTemplate:    z.string().min(10).max(1500).optional(),
  isActive:           z.boolean().optional()
}).refine(d => new Date(d.endDate) > new Date(d.startDate), {
  message: 'endDate debe ser posterior a startDate', path: ['endDate']
});

const updateSchema = createSchema._def.schema.partial();

router.get('/',              collectionWindowsController.list);
router.get('/:id',           validateParams(commonSchemas.idParam), collectionWindowsController.get);
router.post('/',             validateBody(createSchema), collectionWindowsController.create);
router.put('/:id',           validateParams(commonSchemas.idParam), validateBody(updateSchema), collectionWindowsController.update);
router.delete('/:id',        validateParams(commonSchemas.idParam), collectionWindowsController.remove);
router.post('/:id/run-now',  validateParams(commonSchemas.idParam), collectionWindowsController.runNow);
router.get('/:id/metrics',   validateParams(commonSchemas.idParam), collectionWindowsController.metrics);

export default router;
