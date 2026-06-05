import { prisma } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/error.middleware.js';
import { mikrotikService } from '../services/mikrotik.service.js';

class MikrotikController {
  getConfig = asyncHandler(async (req, res) => {
    const config = await prisma.mikrotikConfig.findFirst({
      where: { isActive: true }
    });

    if (!config) {
      return res.json({
        success: true,
        data: null,
        message: 'No hay configuración de Mikrotik activa'
      });
    }

    // Don't return password in response
    const { password, ...configWithoutPassword } = config;

    res.json({
      success: true,
      data: configWithoutPassword
    });
  });

  updateConfig = asyncHandler(async (req, res) => {
    const { host, port, username, password } = req.body;

    // Test connection first
    const isConnected = await mikrotikService.testConnection({ host, port, username, password });
    
    if (!isConnected) {
      throw new AppError('No se pudo conectar a Mikrotik', 400, 'CONNECTION_FAILED');
    }

    // Deactivate all existing configs
    await prisma.mikrotikConfig.updateMany({
      where: { isActive: true },
      data: { isActive: false }
    });

    // Create new config
    const config = await prisma.mikrotikConfig.create({
      data: {
        host,
        port,
        username,
        password
      }
    });

    const { password: _, ...configWithoutPassword } = config;

    res.json({
      success: true,
      data: configWithoutPassword,
      message: 'Configuración de Mikrotik actualizada exitosamente'
    });
  });

  deleteConfig = asyncHandler(async (req, res) => {
    await prisma.mikrotikConfig.deleteMany({
      where: { isActive: true }
    });

    res.json({
      success: true,
      message: 'Configuración de Mikrotik eliminada'
    });
  });

  testConnection = asyncHandler(async (req, res) => {
    const config = await prisma.mikrotikConfig.findFirst({
      where: { isActive: true }
    });

    if (!config) {
      throw new AppError('No hay configuración de Mikrotik activa', 404, 'NO_ACTIVE_CONFIG');
    }

    const isConnected = await mikrotikService.testConnection(config);

    res.json({
      success: true,
      data: {
        connected: isConnected,
        timestamp: new Date().toISOString()
      }
    });
  });

  syncClients = asyncHandler(async (req, res) => {
    const clients = await prisma.client.findMany({
      where: { mikrotikId: { not: null } },
      include: { plan: true }
    });

    const results = [];
    
    for (const client of clients) {
      try {
        const mikrotikClient = await mikrotikService.getClient(client.mikrotikId);
        
        // Update local client with Mikrotik data
        await prisma.client.update({
          where: { id: client.id },
          data: {
            status: mikrotikClient.disabled ? 'SUSPENDED' : 'ACTIVE'
          }
        });

        results.push({
          clientId: client.id,
          mikrotikId: client.mikrotikId,
          status: 'synced',
          mikrotikStatus: mikrotikClient.disabled ? 'disabled' : 'enabled'
        });
      } catch (error) {
        results.push({
          clientId: client.id,
          mikrotikId: client.mikrotikId,
          status: 'error',
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      data: {
        processed: clients.length,
        results
      },
      message: 'Sincronización de clientes completada'
    });
  });

  addClientToMikrotik = asyncHandler(async (req, res) => {
    const { clientId } = req.params;
    const { mikrotikId, planSpeed } = req.body;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: { plan: true }
    });

    if (!client) {
      throw new AppError('Cliente no encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    // Check if mikrotikId already exists
    const existingClient = await prisma.client.findUnique({
      where: { mikrotikId }
    });

    if (existingClient) {
      throw new AppError('ID de Mikrotik ya está en uso', 409, 'MIKROTIK_ID_EXISTS');
    }

    // Create client in Mikrotik
    await mikrotikService.createClient({
      ...client,
      mikrotikId,
      planSpeed
    });

    // Update client with mikrotikId
    const updatedClient = await prisma.client.update({
      where: { id: clientId },
      data: { mikrotikId },
      include: { plan: true }
    });

    res.json({
      success: true,
      data: updatedClient,
      message: 'Cliente agregado a Mikrotik exitosamente'
    });
  });

  removeClientFromMikrotik = asyncHandler(async (req, res) => {
    const { clientId } = req.params;

    const client = await prisma.client.findUnique({
      where: { id: clientId }
    });

    if (!client) {
      throw new AppError('Cliente no encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    if (!client.mikrotikId) {
      throw new AppError('El cliente no tiene ID de Mikrotik', 400, 'NO_MIKROTIK_ID');
    }

    // Remove from Mikrotik
    await mikrotikService.removeClient(client.mikrotikId);

    // Remove mikrotikId from client
    const updatedClient = await prisma.client.update({
      where: { id: clientId },
      data: { mikrotikId: null },
      include: { plan: true }
    });

    res.json({
      success: true,
      data: updatedClient,
      message: 'Cliente removido de Mikrotik exitosamente'
    });
  });

  updateClientInMikrotik = asyncHandler(async (req, res) => {
    const { clientId } = req.params;
    const updateData = req.body;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: { plan: true }
    });

    if (!client) {
      throw new AppError('Cliente no encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    if (!client.mikrotikId) {
      throw new AppError('El cliente no tiene ID de Mikrotik', 400, 'NO_MIKROTIK_ID');
    }

    // Update in Mikrotik
    await mikrotikService.updateClient(client.mikrotikId, updateData);

    // Update mikrotikId if changed
    let updatedClient = client;
    if (updateData.mikrotikId && updateData.mikrotikId !== client.mikrotikId) {
      updatedClient = await prisma.client.update({
        where: { id: clientId },
        data: { mikrotikId: updateData.mikrotikId },
        include: { plan: true }
      });
    }

    res.json({
      success: true,
      data: updatedClient,
      message: 'Cliente actualizado en Mikrotik exitosamente'
    });
  });

  // REMOVED: suspendClientInMikrotik / activateClientInMikrotik.
  //
  // These were duplicates of clientController.suspendService /
  // .activateService (mounted at POST /clients/:id/suspend|activate)
  // but with worse code: they called the deprecated `mikrotikService`
  // proxy (which throws "deprecado") and depended on the legacy
  // `client.mikrotikId` column (the canonical link is now MikrotikAccount).
  // The frontend never called them. The clientController versions are
  // the only suspension path.

  getQueues = asyncHandler(async (req, res) => {
    const queues = await mikrotikService.getQueues();

    res.json({
      success: true,
      data: queues
    });
  });

  createQueue = asyncHandler(async (req, res) => {
    const queueData = req.body;

    const queue = await mikrotikService.createQueue(queueData);

    res.status(201).json({
      success: true,
      data: queue,
      message: 'Queue creado exitosamente'
    });
  });

  updateQueue = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;

    const queue = await mikrotikService.updateQueue(id, updateData);

    res.json({
      success: true,
      data: queue,
      message: 'Queue actualizado exitosamente'
    });
  });

  deleteQueue = asyncHandler(async (req, res) => {
    const { id } = req.params;

    await mikrotikService.deleteQueue(id);

    res.json({
      success: true,
      message: 'Queue eliminado exitosamente'
    });
  });

  getFirewallRules = asyncHandler(async (req, res) => {
    const rules = await mikrotikService.getFirewallRules();

    res.json({
      success: true,
      data: rules
    });
  });

  createFirewallRule = asyncHandler(async (req, res) => {
    const ruleData = req.body;

    const rule = await mikrotikService.createFirewallRule(ruleData);

    res.status(201).json({
      success: true,
      data: rule,
      message: 'Regla de firewall creada exitosamente'
    });
  });

  updateFirewallRule = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;

    const rule = await mikrotikService.updateFirewallRule(id, updateData);

    res.json({
      success: true,
      data: rule,
      message: 'Regla de firewall actualizada exitosamente'
    });
  });

  deleteFirewallRule = asyncHandler(async (req, res) => {
    const { id } = req.params;

    await mikrotikService.deleteFirewallRule(id);

    res.json({
      success: true,
      message: 'Regla de firewall eliminada exitosamente'
    });
  });

  getSystemResources = asyncHandler(async (req, res) => {
    const resources = await mikrotikService.getSystemResources();

    res.json({
      success: true,
      data: resources
    });
  });

  getSystemHealth = asyncHandler(async (req, res) => {
    const health = await mikrotikService.getSystemHealth();

    res.json({
      success: true,
      data: health
    });
  });

  getInterfaces = asyncHandler(async (req, res) => {
    const interfaces = await mikrotikService.getInterfaces();

    res.json({
      success: true,
      data: interfaces
    });
  });

  getInterfaceTraffic = asyncHandler(async (req, res) => {
    const { interfaceName } = req.query;
    
    const traffic = await mikrotikService.getInterfaceTraffic(interfaceName);

    res.json({
      success: true,
      data: traffic
    });
  });

  getDhcpLeases = asyncHandler(async (req, res) => {
    const leases = await mikrotikService.getDhcpLeases();

    res.json({
      success: true,
      data: leases
    });
  });

  getDhcpNetworks = asyncHandler(async (req, res) => {
    const networks = await mikrotikService.getDhcpNetworks();

    res.json({
      success: true,
      data: networks
    });
  });

  createDhcpLease = asyncHandler(async (req, res) => {
    const leaseData = req.body;

    const lease = await mikrotikService.createDhcpLease(leaseData);

    res.status(201).json({
      success: true,
      data: lease,
      message: 'Lease DHCP creado exitosamente'
    });
  });

  getLogs = asyncHandler(async (req, res) => {
    const { limit = 100 } = req.query;

    const logs = await mikrotikService.getLogs(Number(limit));

    res.json({
      success: true,
      data: logs
    });
  });

  getTrafficLogs = asyncHandler(async (req, res) => {
    const { limit = 100, timeRange = '1h' } = req.query;

    const logs = await mikrotikService.getTrafficLogs(Number(limit), timeRange);

    res.json({
      success: true,
      data: logs
    });
  });
}

export const mikrotikController = new MikrotikController();
