import { Router } from 'express';
import { z } from 'zod';
import { billingCyclesController } from '../controllers/billing-cycles.controller.js';
import { validateBody, validateParams, commonSchemas } from '../middleware/validate.middleware.js';

const router = Router();

const createSchema = z.object({
  year:               z.number().int().min(2020).max(2100),
  month:              z.number().int().min(1).max(12),
  collectionStart:    z.string().datetime(),
  collectionEnd:      z.string().datetime(),
  moraGraceDays:      z.number().int().min(0).max(60).optional(),
  status:             z.enum(['draft','active','closed']).optional(),
  autoSuspendEnabled: z.boolean().optional(),
  notes:              z.string().max(1000).optional().nullable()
}).refine(d => new Date(d.collectionEnd) >= new Date(d.collectionStart), {
  message: 'collectionEnd debe ser >= collectionStart',
  path:    ['collectionEnd']
});

const updateSchema = z.object({
  collectionStart:    z.string().datetime().optional(),
  collectionEnd:      z.string().datetime().optional(),
  moraGraceDays:      z.number().int().min(0).max(60).optional(),
  autoSuspendEnabled: z.boolean().optional(),
  notes:              z.string().max(1000).optional().nullable()
});

router.get('/',                billingCyclesController.list);
router.get('/active',          billingCyclesController.active);
router.get('/:id',             validateParams(commonSchemas.idParam), billingCyclesController.get);
router.get('/:id/impact',      validateParams(commonSchemas.idParam), billingCyclesController.impact);

router.post('/',               validateBody(createSchema), billingCyclesController.create);
router.put('/:id',             validateParams(commonSchemas.idParam), validateBody(updateSchema), billingCyclesController.update);
router.post('/:id/activate',   validateParams(commonSchemas.idParam), billingCyclesController.activate);
router.post('/:id/close',      validateParams(commonSchemas.idParam), billingCyclesController.close);
router.delete('/:id',          validateParams(commonSchemas.idParam), billingCyclesController.delete);

export default router;
