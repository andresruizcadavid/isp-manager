import { Router } from 'express';
import { invoiceController } from '../controllers/invoices.controller.js';
import { paymentController } from '../controllers/payments.controller.js';
import { authMiddleware, requireOperatorOrAdmin } from '../middleware/auth.middleware.js';
import { validateBody, validateQuery, validateParams, commonSchemas } from '../middleware/validate.middleware.js';
import { z } from 'zod';

const router = Router();

// All invoice routes require authentication
router.use(authMiddleware);

// Sync invoice statuses with their payment totals (idempotent maintenance op)
router.post('/sync-status', requireOperatorOrAdmin, paymentController.syncInvoiceStatuses);

// Validation schemas
const createInvoiceSchema = z.object({
  clientId: z.string().min(1, 'Cliente es requerido'),
  amount: z.number().positive('Monto debe ser positivo'),
  dueDate: z.string().min(1, 'Fecha de vencimiento es requerida'),
  description: z.string().optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional()
});

const updateInvoiceSchema = createInvoiceSchema.partial();

const invoiceQuerySchema = commonSchemas.pagination.extend({
  status: z.enum(['PENDING', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
  clientId: z.string().optional(),
  planId: z.string().optional(),
  dueDateFrom: z.string().datetime().optional(),
  dueDateTo: z.string().datetime().optional(),
  amountMin: z.string().transform(Number).optional(),
  amountMax: z.string().transform(Number).optional()
});

const bulkGenerateSchema = z.object({
  clientIds: z.array(z.string()).min(1, 'Seleccione al menos un cliente'),
  planId: z.string().min(1, 'Plan es requerido'),
  amount: z.number().positive('Monto debe ser positivo'),
  dueDate: z.string().datetime('Fecha de vencimiento inválida'),
  periodStart: z.string().datetime('Fecha de inicio inválida'),
  periodEnd: z.string().datetime('Fecha de fin inválida')
});

// CRUD routes
router.get('/', validateQuery(invoiceQuerySchema), invoiceController.getInvoices);
router.get('/:id', validateParams(commonSchemas.idParam), invoiceController.getInvoice);
router.post('/', requireOperatorOrAdmin, validateBody(createInvoiceSchema), invoiceController.createInvoice);
router.put('/:id', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), validateBody(updateInvoiceSchema), invoiceController.updateInvoice);
router.delete('/:id', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), invoiceController.deleteInvoice);

// Invoice operations
router.post('/:id/cancel', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), invoiceController.cancelInvoice);
router.post('/:id/mark-paid', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), validateBody(z.object({
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'WOMPI', 'NEQUI', 'BANCOLOMBIA']),
  amount: z.number().positive(),
  notes: z.string().optional()
})), invoiceController.markAsPaid);

// Bulk operations
router.post('/bulk-generate', requireOperatorOrAdmin, validateBody(bulkGenerateSchema), invoiceController.bulkGenerateInvoices);
router.post('/bulk-cancel', requireOperatorOrAdmin, validateBody(z.object({
  invoiceIds: z.array(z.string()).min(1, 'Seleccione al menos una factura')
})), invoiceController.bulkCancelInvoices);

// Reports and statistics
router.get('/stats/overview', invoiceController.getInvoiceStats);
router.get('/stats/overdue', invoiceController.getOverdueInvoices);
router.get('/stats/by-month', invoiceController.getInvoicesByMonth);
router.get('/stats/by-plan', invoiceController.getInvoicesByPlan);

// Export functionality
router.get('/export/excel', invoiceController.exportToExcel);
router.get('/export/pdf', invoiceController.exportToPDF);
router.get('/:id/pdf', validateParams(commonSchemas.idParam), invoiceController.generateInvoicePDF);

// Send invoice via specified channels
const sendInvoiceSchema = z.object({
  channels: z.array(z.enum(['email', 'whatsapp'])).min(1, 'Seleccione al menos un canal'),
  sendPdf: z.boolean().optional().default(true),
  sendPaymentLink: z.boolean().optional().default(false)
});
router.post('/:id/send', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), validateBody(sendInvoiceSchema), invoiceController.sendInvoice);

// Reminders
router.post('/send-reminders', requireOperatorOrAdmin, invoiceController.sendPaymentReminders);
router.post('/:id/send-reminder', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), invoiceController.sendSingleReminder);

export default router;
