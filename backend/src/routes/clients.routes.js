import { Router } from 'express';
import { clientController } from '../controllers/clients.controller.js';
import { billingController } from '../controllers/billing.controller.js';
import { requireOperational, requireOperatorOrAdmin } from '../middleware/auth.middleware.js';
import { validateBody, validateQuery, validateParams, commonSchemas } from '../middleware/validate.middleware.js';
import { z } from 'zod';

const router = Router();

// Validation schemas
//
// The frontend serializes empty fields as `''` or `null`. The Prisma model
// accepts `null` for nullable columns, so we normalize "empty" inputs to
// `undefined` and validate the rest leniently. The controller already does
// final null/empty-string normalization before persisting.

// String that allows '' / null, treating both as "not provided".
const optionalString = () =>
  z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().optional()
  );

// Email that allows '' / null, but requires a valid address when present.
const optionalEmail = () =>
  z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().email('Email inválido').optional()
  );

// Number that allows '' / null / numeric strings.
const optionalNumber = () =>
  z.preprocess(
    (v) => {
      if (v === '' || v === null || v === undefined) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    },
    z.number().optional()
  );

// Date strings: accept ISO datetime, yyyy-mm-dd, '' / null. Normalize to ISO.
const optionalDate = () =>
  z.preprocess(
    (v) => {
      if (v === '' || v === null || v === undefined) return undefined;
      // yyyy-mm-dd → 2024-05-09T00:00:00.000Z
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return new Date(`${v}T00:00:00.000Z`).toISOString();
      }
      return v;
    },
    z.string().datetime({ message: 'Fecha inválida (se espera ISO o yyyy-mm-dd)' }).optional()
  );

const mikrotikSubSchema = z.object({
  routerId:      optionalNumber(),
  username:      optionalString(),
  password:      optionalString(),
  remoteAddress: optionalString(),
  localAddress:  optionalString(),
  profileName:   optionalString(),
  coordinates:   optionalString(),
  status:        z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  // Adopt flow: the PPPoE secret already exists on the router (client was
  // installed in the field before being registered). When true, provisioning
  // ADOPTS the existing secret instead of failing with 409 — and never
  // creates/modifies/deletes it on the device.
  reuseExisting: z.boolean().optional()
}).partial();

const createClientSchema = z.object({
  fullName:       z.string().min(2, 'Nombre debe tener al menos 2 caracteres'),
  documentType:   z.enum(['CC', 'NIT', 'CE', 'TI', 'PAS']).optional(),
  documentNumber: optionalString(),
  email:          optionalEmail(),
  phone:          optionalString(),
  address:        optionalString(),
  neighborhood:   optionalString(),
  city:           optionalString(),
  zoneId:         optionalNumber(),
  contractDate:   optionalDate(),
  installationDate: optionalDate(),
  // Per-client price override (in cents, WispHub-style). When 0 or omitted,
  // the plan's monthly price applies. Coerced from string so number inputs
  // from the form (which arrive as strings via JSON) still validate.
  monthlyFee:     z.coerce.number().int().nonnegative().optional(),
  connectionType: z.enum(['FIBER', 'WIRELESS']).optional(),
  notes:          optionalString(),
  planId:         optionalString(),
  mikrotik:       mikrotikSubSchema.optional()
});

const updateClientSchema = createClientSchema.partial();

const clientQuerySchema = commonSchemas.pagination.extend({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE', 'PENDING']).optional(),
  planId: z.string().optional(),
  zoneId: z.string().optional(),                 // was already being read by the controller
  city:   z.string().optional(),
  connectionType: z.enum(['FIBER', 'WIRELESS']).optional(),
  // Fase 1 (cobranzas): "?debtors=true" filters to clients with at least
  // one unpaid invoice with positive balanceDue. Coerced from string.
  debtors: z.enum(['true', 'false']).optional()
});

const deviceSchema = z.object({
  mac: z.string().regex(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/, 'MAC address inválida'),
  ipAddress: z.string().ip('IP address inválida').optional(),
  hostname: z.string().optional(),
  deviceType: z.enum(['ROUTER', 'ACCESS_POINT', 'SWITCH', 'OTHER']).default('ROUTER')
});

// CRUD routes
router.get('/', validateQuery(clientQuerySchema), clientController.getClients);

// Helper: next sequential number for PPPoE username prefixes (must be defined
// BEFORE the /:id route so Express does not match it as an id).
router.get('/next-pppoe-number', clientController.getNextPppoeNumber);

// Bulk operation audit history. Same rule as `/next-pppoe-number` — the
// literal path MUST precede `/:id` or Express greedily matches it.
router.get('/bulk-history', requireOperatorOrAdmin, clientController.getBulkHistory);

// Spreadsheet ("planilla") view: all clients with per-month invoice status for
// a year. Literal path MUST precede `/:id` so Express does not match "sheet"
// as a client id.
router.get('/sheet', clientController.getSheet);

// Deleted-client archive. Literal paths MUST precede `/:id`.
router.get('/archive', requireOperatorOrAdmin, clientController.getArchive);
router.get('/archive/:id', requireOperatorOrAdmin, clientController.getArchiveEntry);

router.get('/:id', validateParams(commonSchemas.idParam), clientController.getClient);

// Planilla: act on a single month cell (pay / bill / unbill / unpay). Money op,
// so requireOperational (technicians register field payments). Validated in the
// controller (period + action + amount).
router.post('/:id/sheet-cell', requireOperational, validateParams(commonSchemas.idParam), clientController.sheetCell);

// Planilla: registrar/limpiar el envío del mensaje de cobro (medio + fecha).
router.post('/:id/collection-reminder', requireOperational, validateParams(commonSchemas.idParam), clientController.setCollectionReminder);
// Create/update are `requireOperational`: field TECHNICIANs provision new
// clients and fix their data/IPs on site. Destructive ops (delete, suspend,
// bulk) remain operator/admin below.
router.post('/', requireOperational, validateBody(createClientSchema), clientController.createClient);
router.put('/:id', requireOperational, validateParams(commonSchemas.idParam), validateBody(updateClientSchema), clientController.updateClient);
router.delete('/:id', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), clientController.deleteClient);

// Device management
router.get('/:id/devices', validateParams(commonSchemas.idParam), clientController.getClientDevices);
router.post('/:id/devices', requireOperational, validateParams(commonSchemas.idParam), validateBody(deviceSchema), clientController.addDevice);
router.put('/:id/devices/:deviceId', requireOperational, validateParams(z.object({ id: z.string(), deviceId: z.string() })), validateBody(deviceSchema.partial()), clientController.updateDevice);
router.delete('/:id/devices/:deviceId', requireOperatorOrAdmin, validateParams(z.object({ id: z.string(), deviceId: z.string() })), clientController.removeDevice);

// Service management
router.post('/:id/suspend', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), clientController.suspendService);
router.post('/:id/activate', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), clientController.activateService);
router.post('/:id/change-plan', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), validateBody(z.object({ planId: z.string() })), clientController.changePlan);

// Notification history for this client (Centro de Notificaciones ↔ Clientes).
router.get('/:id/notifications', validateParams(commonSchemas.idParam), clientController.getClientNotifications);
// Reenviar cobro de una factura al cliente (operacional — staff dispara, cliente paga).
router.post('/:id/resend-charge', requireOperational, validateParams(commonSchemas.idParam), clientController.resendCharge);

// Envío manual de una notificación (plantilla) a ESTE cliente. Operacional —
// el staff decide enviarle algo puntual; lo masivo va por el Centro de Notif.
const clientNotifySchema = z.object({
  templateId: z.string().min(1, 'Selecciona una plantilla'),
  channel:    z.enum(['EMAIL', 'WHATSAPP', 'BOTH']),
  generatePaymentLinks: z.boolean().optional()
});
router.post('/:id/notify', requireOperational, validateParams(commonSchemas.idParam), validateBody(clientNotifySchema), clientController.notifyClient);

// Bulk plan change — operator-driven mass assignment of a plan to N clients.
// Per-router connection pooling + per-client transaction in the service.
const bulkPlanChangeSchema = z.object({
  clientIds:        z.array(z.string().min(1)).min(1, 'Debes seleccionar al menos un cliente').max(500),
  planId:           z.string().min(1, 'Plan destino requerido'),
  syncMikrotik:     z.boolean().optional(),
  resetMonthlyFee:  z.boolean().optional(),
  includeSuspended: z.boolean().optional()
});
router.post(
  '/bulk-change-plan',
  requireOperatorOrAdmin,
  validateBody(bulkPlanChangeSchema),
  clientController.bulkChangePlan
);

// (the `/bulk-history` route was moved above /:id to avoid greedy matching.)

// Self-service update token generation. The public-facing GET/PUT/POST
// that consume the token live under /api/v1/public/client-updates/*.
const channelEnum = z.enum(['EMAIL', 'WHATSAPP', 'TELEGRAM']);
const updateTokenSchema = z.object({
  sendChannels:   z.array(channelEnum).max(3).default([]),
  notifyChannels: z.array(channelEnum).max(3).default([])
});
// `requireOperational`: field TECHNICIANs send this link on site so the client
// completes their own data — non-destructive (token + dispatch only).
router.post(
  '/:id/update-tokens',
  requireOperational,
  validateParams(commonSchemas.idParam),
  validateBody(updateTokenSchema),
  clientController.createUpdateToken
);

// Financial information
router.get('/:id/invoices', validateParams(commonSchemas.idParam), validateQuery(commonSchemas.pagination), clientController.getClientInvoices);
router.get('/:id/payments', validateParams(commonSchemas.idParam), validateQuery(commonSchemas.pagination), clientController.getClientPayments);
router.get('/:id/balance', validateParams(commonSchemas.idParam), clientController.getClientBalance);

// Billing / Cashier
router.get('/:id/billing-months', validateParams(commonSchemas.idParam), billingController.getBillingMonths);
router.post('/:id/generate-invoices', requireOperational, validateParams(commonSchemas.idParam), billingController.generateInvoices);

// Statistics
router.get('/stats/overview', clientController.getClientStats);
router.get('/stats/by-city', clientController.getClientsByCity);
router.get('/stats/by-plan', clientController.getClientsByPlan);

export default router;
