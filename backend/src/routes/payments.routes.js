import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { paymentController } from '../controllers/payments.controller.js';
import { billingController } from '../controllers/billing.controller.js';
import { authMiddleware, requireOperational, requireOperatorOrAdmin } from '../middleware/auth.middleware.js';
import { validateBody, validateQuery, validateParams, commonSchemas } from '../middleware/validate.middleware.js';
import { z } from 'zod';

const router = Router();

// Most payment routes require authentication, but webhooks are public
router.use('/webhooks', (req, res, next) => {
  // Webhook routes don't require authentication
  next();
});

router.use(authMiddleware);

// Validation schemas
const createPaymentSchema = z.object({
  invoiceId: z.string().min(1, 'Factura es requerida'),
  amount: z.number().positive('Monto debe ser positivo'),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'WOMPI', 'NEQUI', 'BANCOLOMBIA']),
  notes: z.string().optional()
});

const paymentQuerySchema = commonSchemas.pagination.extend({
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED']).optional(),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'WOMPI', 'NEQUI', 'BANCOLOMBIA']).optional(),
  invoiceId: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  amountMin: z.string().transform(Number).optional(),
  amountMax: z.string().transform(Number).optional()
});

const refundSchema = z.object({
  reason: z.string().min(5, 'Motivo debe tener al menos 5 caracteres'),
  amount: z.number().positive().optional()
});

// CRUD routes
router.get('/', validateQuery(paymentQuerySchema), paymentController.getPayments);
router.get('/:id', validateParams(commonSchemas.idParam), paymentController.getPayment);
router.post('/', requireOperatorOrAdmin, validateBody(createPaymentSchema), paymentController.createPayment);
router.put('/:id', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), validateBody(createPaymentSchema.partial()), paymentController.updatePayment);
router.delete('/:id', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), paymentController.deletePayment);

// Payment operations
router.post('/:id/confirm', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), paymentController.confirmPayment);
router.post('/:id/fail', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), paymentController.failPayment);
router.post('/:id/refund', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), validateBody(refundSchema), paymentController.refundPayment);

// Bulk payment — pay multiple invoices at once
const ALLOWED_PAYMENT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const evidenceDir = path.resolve(env.UPLOADS_PATH, 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

const evidenceStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, evidenceDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const id = crypto.randomBytes(12).toString('hex');
    cb(null, `${Date.now()}_${id}${ext}`);
  }
});

const uploadEvidence = multer({
  storage: evidenceStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_PAYMENT_MIME.has(file.mimetype)) {
      return cb(new Error('Formato de imagen no soportado'));
    }
    cb(null, true);
  }
});

const bulkPaymentSchema = z.object({
  invoiceIds: z.array(z.string()).min(1, 'Debe seleccionar al menos una factura'),
  amount: z.number().positive('Monto debe ser positivo'),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'WOMPI', 'NEQUI', 'BANCOLOMBIA']),
  notes: z.string().optional(),
  paymentDate: z.string().optional()
});

router.post('/bulk-payment', requireOperational, validateBody(bulkPaymentSchema), billingController.registerPayment);
router.post('/:id/evidence', requireOperational, uploadEvidence.single('file'), billingController.uploadPaymentEvidence);

// Wompi integration (public webhooks)
router.post('/webhooks/wompi', paymentController.wompiWebhook);
router.get('/wompi/checkout/:invoiceId', paymentController.getWompiCheckout);

// Data repair — create Payment records for PAID invoices that lack them
router.post('/backfill', requireOperatorOrAdmin, paymentController.backfillMissingPayments);

// Reports and statistics
router.get('/stats/overview', paymentController.getPaymentStats);
router.get('/stats/by-method', paymentController.getPaymentsByMethod);
router.get('/stats/by-month', paymentController.getPaymentsByMonth);
router.get('/stats/daily', paymentController.getDailyPayments);

// Consolidated report (JSON or CSV with ?format=csv)
router.get('/report/consolidated', requireOperatorOrAdmin, paymentController.getConsolidatedReport);

// Export functionality
router.get('/export/excel', paymentController.exportToExcel);
router.get('/export/pdf', paymentController.exportToPDF);

// Reconciliation
router.post('/reconcile', requireOperatorOrAdmin, paymentController.reconcilePayments);
router.get('/reconciliation/report', paymentController.getReconciliationReport);

export default router;
