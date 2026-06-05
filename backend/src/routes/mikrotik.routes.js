import { Router } from 'express';
import { mikrotikController } from '../controllers/mikrotik.controller.js';
import { authMiddleware, requireOperatorOrAdmin } from '../middleware/auth.middleware.js';
import { validateBody, validateParams, commonSchemas } from '../middleware/validate.middleware.js';
import { z } from 'zod';

const router = Router();

// All Mikrotik routes require authentication
router.use(authMiddleware);

// Validation schemas
const configSchema = z.object({
  host: z.string().min(1, 'Host es requerido'),
  port: z.number().int().positive().default(8728),
  username: z.string().min(1, 'Usuario es requerido'),
  password: z.string().min(1, 'Contraseña es requerida')
});

const clientConfigSchema = z.object({
  clientId: z.string().min(1, 'Cliente es requerido'),
  mikrotikId: z.string().min(1, 'ID de Mikrotik es requerido'),
  planSpeed: z.object({
    download: z.number().positive(),
    upload: z.number().positive()
  })
});

const queueConfigSchema = z.object({
  name: z.string().min(1),
  target: z.string().min(1),
  maxLimit: z.string().min(1),
  limitAt: z.string().min(1),
  burstLimit: z.string().optional(),
  burstThreshold: z.string().optional(),
  burstTime: z.string().optional()
});

const firewallRuleSchema = z.object({
  chain: z.enum(['forward', 'input', 'output']),
  action: z.enum(['accept', 'drop', 'reject']),
  protocol: z.enum(['tcp', 'udp', 'icmp', 'any']).default('any'),
  srcAddress: z.string().optional(),
  dstAddress: z.string().optional(),
  srcPort: z.string().optional(),
  dstPort: z.string().optional(),
  comment: z.string().optional()
});

// Configuration management
router.get('/config', mikrotikController.getConfig);
router.post('/config', requireOperatorOrAdmin, validateBody(configSchema), mikrotikController.updateConfig);
router.delete('/config', requireOperatorOrAdmin, mikrotikController.deleteConfig);
router.get('/test-connection', mikrotikController.testConnection);

// Client management
router.post('/clients/sync', requireOperatorOrAdmin, mikrotikController.syncClients);
router.post('/clients/:clientId/add', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), validateBody(clientConfigSchema), mikrotikController.addClientToMikrotik);
router.delete('/clients/:clientId/remove', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), mikrotikController.removeClientFromMikrotik);
router.put('/clients/:clientId/update', requireOperatorOrAdmin, validateParams(commonSchemas.idParam), validateBody(clientConfigSchema.partial()), mikrotikController.updateClientInMikrotik);
// REMOVED: /clients/:clientId/suspend and /activate. They were duplicates
// of /clients/:id/suspend|activate (clients.routes.js), but called the
// deprecated mikrotikService proxy. Use the clients.routes versions.

// Queue management
router.get('/queues', mikrotikController.getQueues);
router.post('/queues', requireOperatorOrAdmin, validateBody(queueConfigSchema), mikrotikController.createQueue);
router.put('/queues/:id', requireOperatorOrAdmin, validateParams(z.object({ id: z.string() })), validateBody(queueConfigSchema.partial()), mikrotikController.updateQueue);
router.delete('/queues/:id', requireOperatorOrAdmin, validateParams(z.object({ id: z.string() })), mikrotikController.deleteQueue);

// Firewall rules
router.get('/firewall/rules', mikrotikController.getFirewallRules);
router.post('/firewall/rules', requireOperatorOrAdmin, validateBody(firewallRuleSchema), mikrotikController.createFirewallRule);
router.put('/firewall/rules/:id', requireOperatorOrAdmin, validateParams(z.object({ id: z.string() })), validateBody(firewallRuleSchema.partial()), mikrotikController.updateFirewallRule);
router.delete('/firewall/rules/:id', requireOperatorOrAdmin, validateParams(z.object({ id: z.string() })), mikrotikController.deleteFirewallRule);

// System monitoring
router.get('/system/resources', mikrotikController.getSystemResources);
router.get('/system/health', mikrotikController.getSystemHealth);
router.get('/interfaces', mikrotikController.getInterfaces);
router.get('/interfaces/traffic', mikrotikController.getInterfaceTraffic);

// DHCP management
router.get('/dhcp/leases', mikrotikController.getDhcpLeases);
router.get('/dhcp/networks', mikrotikController.getDhcpNetworks);
router.post('/dhcp/leases', requireOperatorOrAdmin, validateBody(z.object({
  address: z.string().ip(),
  macAddress: z.string().regex(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/),
  clientId: z.string().optional(),
  comment: z.string().optional()
})), mikrotikController.createDhcpLease);

// Log monitoring
router.get('/logs', mikrotikController.getLogs);
router.get('/logs/traffic', mikrotikController.getTrafficLogs);

export default router;
