// Payments routes — only the endpoints that remain consumed by the system
// after the "Pagos Recibidos" + "Registrar Pago" UI sections were removed.
//
// What still uses these:
//   • POST /payments                 ← clients/+page.svelte (in-row "Pagar" modal)
//   • POST /payments/bulk-payment    ← CashierWizard (multi-month settlement)
//   • POST /payments/:id/evidence    ← invoices/[id] payment modal +
//                                      CashierWizard upload step
//   • GET  /payments/wompi/checkout  ← Wompi checkout-link generator
//   • POST /webhooks/wompi (public)  ← Wompi async confirmation
//   • POST /payments/backfill        ← operator-only data repair tool
//
// Everything else (list / detail / refund / stats / export / reconcile /
// consolidated report) was removed along with the deleted UI surfaces.

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { paymentController } from '../controllers/payments.controller.js';
import { billingController } from '../controllers/billing.controller.js';
import { requireOperational, requireOperatorOrAdmin } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { z } from 'zod';

const router = Router();

// Public webhook router — mounted by app.js BEFORE authMiddleware so external
// providers (Wompi) can POST without a JWT. Do NOT add internal endpoints here.
export const webhookRouter = Router();

const createPaymentSchema = z.object({
  invoiceId: z.string().min(1, 'Factura es requerida'),
  amount: z.number().positive('Monto debe ser positivo'),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'WOMPI', 'NEQUI', 'BANCOLOMBIA']),
  notes: z.string().optional()
});

// Single-invoice payment registration (in-row modal in /clients).
router.post('/', requireOperatorOrAdmin, validateBody(createPaymentSchema), paymentController.createPayment);

// Bulk payment — pay multiple invoices at once (CashierWizard).
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
router.post('/:id/evidence',  requireOperational, uploadEvidence.single('file'), billingController.uploadPaymentEvidence);

// Wompi integration — the WEBHOOK lives on the public webhookRouter
// (mounted in app.js before authMiddleware). The checkout-link generator
// stays authenticated because it's invoked from the operator UI.
router.get('/wompi/checkout/:invoiceId', paymentController.getWompiCheckout);

// Public Wompi webhook. MUST NOT use authMiddleware — Wompi has no JWT.
webhookRouter.post('/wompi', paymentController.wompiWebhook);

// Data repair — operator-triggered, no UI link. Creates Payment records
// for PAID invoices that lack them (legacy data fix).
router.post('/backfill', requireOperatorOrAdmin, paymentController.backfillMissingPayments);

export default router;
