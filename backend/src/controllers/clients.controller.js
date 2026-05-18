import { prisma } from '../server.js';
import { AppError, asyncHandler } from '../middleware/error.middleware.js';
import { notificationService } from '../services/notification.service.js';
import { getMikrotikService, getMikrotikServiceForClient } from '../services/mikrotik.service.js';

const MOROSO_LIST = 'Moroso';

class ClientsController {
  getClients = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, search, sortBy = 'createdAt', sortOrder = 'desc', status, planId, zoneId, city } = req.query;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    const where = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { documentNumber: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } }
        ]
      }),
      ...(status && { status }),
      ...(planId && { planId }),
      ...(zoneId && { zoneId: Number(zoneId) }),
      ...(city && { city: { contains: city, mode: 'insensitive' } })
    };

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { [sortBy]: sortOrder },
        include: {
          plan: {
            select: {
              id: true,
              name: true,
              price: true,
              monthlyPrice: true,
              downloadSpeed: true,
              uploadSpeed: true
            }
          },
          zone: {
            select: {
              id: true,
              name: true,
              color: true
            }
          },
          mikrotikAccount: {
            include: {
              router: {
                select: {
                  id: true,
                  name: true,
                  ipAddress: true
                }
              }
            }
          },
          devices: {
            select: {
              id: true,
              mac: true,
              ip: true,
              type: true,
              isActive: true
            }
          },
          invoices: {
            where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] } },
            select: {
              id: true,
              status: true,
              total: true,
              amount: true,
              balanceDue: true,
              dueDate: true
            }
          },
          _count: {
            select: {
              invoices: true,
              payments: true
            }
          }
        }
      }),
      prisma.client.count({ where })
    ]);

    // Compute payment status + pending amount per client
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const enriched = clients.map(c => {
      const pending = c.invoices || [];
      const hasOverdue = pending.some(inv =>
        inv.status === 'OVERDUE' || (inv.dueDate && new Date(inv.dueDate) < today)
      );
      const pendingAmount = pending.reduce(
        (sum, inv) => sum + (inv.balanceDue > 0 ? inv.balanceDue : (inv.amount ?? inv.total ?? 0)),
        0
      );
      let paymentStatus = 'OK';
      if (pending.length > 0) paymentStatus = hasOverdue ? 'OVERDUE' : 'PENDING';
      return {
        ...c,
        pendingInvoices: pending,
        paymentStatus,
        pendingAmount
      };
    });

    res.json({
      success: true,
      data: enriched,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  });

  getClient = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        plan: true,
        zone: true,
        devices: true,
        mikrotikAccount: { include: { router: true } },
        invoices: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            payments: true
          }
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    });

    if (!client) {
      throw new AppError('Cliente no encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    res.json({
      success: true,
      data: client
    });
  });

  createClient = asyncHandler(async (req, res) => {
    const clientData = req.body;

    // Map frontend fields to database fields. Phone is expected to come
    // already formatted from the frontend (e.g. "+573001234567").
    const mappedData = {
      name: clientData.fullName,
      email: clientData.email || null,
      phone: clientData.phone || '',
      address: clientData.address || '',
      neighborhood: clientData.neighborhood || null,
      city: 'Cali',
      documentType: clientData.documentType,
      documentNumber: clientData.documentNumber || null,
      status: 'ACTIVE',
      planId: clientData.planId || null,
      zoneId: clientData.zoneId ? Number(clientData.zoneId) : null,
      contractDate: clientData.contractDate ? new Date(clientData.contractDate) : null,
      notes: clientData.notes || null,
    };

    // Zone is now required and must have a router assigned. The router for
    // the MikroTik account is resolved from the zone — clients no longer
    // pick a router independently.
    if (!mappedData.zoneId) {
      throw new AppError('Debe seleccionar una zona', 400, 'ZONE_REQUIRED');
    }
    const zone = await prisma.zone.findUnique({
      where: { id: mappedData.zoneId },
      select: { id: true, name: true, routerId: true }
    });
    if (!zone) {
      throw new AppError('Zona no encontrada', 404, 'ZONE_NOT_FOUND');
    }
    if (!zone.routerId) {
      throw new AppError(
        `La zona "${zone.name}" no tiene router asignado`,
        400,
        'ZONE_WITHOUT_ROUTER'
      );
    }

    // Check if document number already exists
    if (mappedData.documentNumber) {
      const existingClient = await prisma.client.findUnique({
        where: { documentNumber: mappedData.documentNumber }
      });

      if (existingClient) {
        throw new AppError('El número de documento ya está registrado', 409, 'DOCUMENT_NUMBER_EXISTS');
      }
    }

    // Check if email already exists
    if (mappedData.email) {
      const existingEmail = await prisma.client.findUnique({
        where: { email: mappedData.email }
      });

      if (existingEmail) {
        throw new AppError('El email ya está registrado', 409, 'EMAIL_EXISTS');
      }
    }

    // Verify plan exists
    const plan = await prisma.plan.findUnique({
      where: { id: mappedData.planId }
    });

    if (!plan) {
      throw new AppError('Plan no encontrado', 404, 'PLAN_NOT_FOUND');
    }

    // Router is resolved from the zone — the client form no longer picks one.
    const resolvedRouterId = zone.routerId;

    // ───────────────────────────────────────────────────────────────────
    // MikroTik-first creation flow.
    //
    // Rule of the house: NEVER persist the client locally unless MikroTik
    // accepts the PPPoE secret. The order is:
    //   1. Check the username isn't already taken locally OR on the device.
    //   2. Create the secret on the device.
    //   3. Persist the client + mikrotikAccount in the DB.
    //   4. If the DB write fails (rare), best-effort delete the secret to
    //      avoid orphaning it on the router.
    // ───────────────────────────────────────────────────────────────────
    const mk = clientData.mikrotik || {};
    const pppoeUsername = (mk.username || '').trim();

    if (!pppoeUsername) {
      throw new AppError(
        'El usuario PPPoE es obligatorio para crear un cliente',
        400,
        'PPPOE_USERNAME_REQUIRED'
      );
    }

    // 1a. Duplicate check — local DB
    const dupLocal = await prisma.mikrotikAccount.findUnique({
      where: { username: pppoeUsername },
      select: { id: true, clientId: true }
    });
    if (dupLocal) {
      throw new AppError(
        'No se puede crear el cliente: ya existe un usuario PPPoE con esas credenciales.',
        409,
        'PPPOE_USERNAME_EXISTS'
      );
    }

    // 1b. Duplicate check — MikroTik device
    let mkService;
    try {
      mkService = await getMikrotikService(resolvedRouterId);
    } catch (e) {
      throw new AppError(
        `No se pudo contactar el router de la zona: ${e.message}`,
        502,
        'MIKROTIK_UNREACHABLE'
      );
    }

    let existingOnDevice = null;
    try {
      existingOnDevice = await mkService.findPPPoESecretByName(pppoeUsername);
    } catch (e) {
      // If we can't query the device we shouldn't blindly proceed — abort.
      throw new AppError(
        `No se pudo verificar credenciales en el router: ${e.message}`,
        502,
        'MIKROTIK_VERIFY_FAILED'
      );
    }
    if (existingOnDevice) {
      throw new AppError(
        'No se puede crear el cliente: ya existe un usuario PPPoE con esas credenciales en el router.',
        409,
        'PPPOE_USERNAME_EXISTS_ON_DEVICE'
      );
    }

    // 1c. Resolve & validate the PPPoE profile against the actual device.
    // Resolution order (first non-empty wins):
    //   1. mk.profileName     — what the operator typed in the form
    //   2. plan.mikrotikProfile — technical name configured on the Plan
    //   3. plan.name           — last-resort fallback (legacy behaviour)
    // If a candidate is resolved, it MUST match a profile that exists on the
    // router; otherwise we abort cleanly with a list of available profiles.
    // If nothing is resolved we omit `profile` from the request so MikroTik
    // falls back to its "default" profile.
    const requestedProfile = (
      mk.profileName?.trim() ||
      plan?.mikrotikProfile?.trim() ||
      plan?.name?.trim() ||
      ''
    );
    let validatedProfile;
    if (requestedProfile) {
      let deviceProfiles = [];
      try {
        deviceProfiles = await mkService.getPPPoEProfiles();
        if (!Array.isArray(deviceProfiles)) deviceProfiles = [];
      } catch (e) {
        throw new AppError(
          `No se pudo leer la lista de perfiles del router: ${e.message}`,
          502,
          'MIKROTIK_PROFILES_FETCH_FAILED'
        );
      }
      const exists = deviceProfiles.some(p => (p?.name || p?.['name']) === requestedProfile);
      if (!exists) {
        const available = deviceProfiles
          .map(p => p?.name || p?.['name'])
          .filter(Boolean);
        const hint = available.length > 0
          ? ` Perfiles disponibles en el router: ${available.join(', ')}.`
          : ' El router no devolvió ningún perfil PPPoE.';
        throw new AppError(
          `El perfil "${requestedProfile}" no existe en MikroTik.${hint} Selecciona un plan sincronizado con el router o ajusta el campo "Perfil PPPoE".`,
          400,
          'PPPOE_PROFILE_NOT_FOUND'
        );
      }
      validatedProfile = requestedProfile;
    }

    // The remote address is required both for the PPPoE secret AND for the
    // firewall address-list authorization. Reject early if missing so we
    // don't end up with a secret without a paired IP authorization.
    const remoteAddress = (mk.remoteAddress || '').split('/')[0] || '';
    if (!remoteAddress) {
      throw new AppError(
        'La IP remota (Remote Address PPPoE) es obligatoria para autorizar el cliente en el firewall.',
        400,
        'REMOTE_ADDRESS_REQUIRED'
      );
    }

    // 2. Create the secret on the device first.
    let createdSecret = null;
    try {
      createdSecret = await mkService.createPPPoESecret({
        name:          pppoeUsername,
        password:      mk.password,
        profile:       validatedProfile, // undefined → device uses default profile
        remoteAddress: remoteAddress,
        comment:       `${mappedData.name}${mappedData.documentNumber ? ` · CC ${mappedData.documentNumber}` : ''}`,
        disabled:      (mk.status || 'ACTIVE') !== 'ACTIVE'
      });
    } catch (e) {
      throw new AppError(
        `No se pudo crear el usuario en MikroTik: ${e.message}`,
        502,
        'MIKROTIK_CREATE_FAILED'
      );
    }

    // 3. Authorize the IP in the firewall address-list. addToAddressList is
    // idempotent: if the entry already exists it just enables it (no dup).
    // If this fails we MUST roll back the PPPoE secret to keep state coherent.
    const AUTHORIZED_LIST = 'ips_autorizadas_wisphub';
    let addressListResult = null;
    try {
      addressListResult = await mkService.addToAddressList({
        list:    AUTHORIZED_LIST,
        address: remoteAddress,
        comment: `${mappedData.name}${mappedData.documentNumber ? ` · CC ${mappedData.documentNumber}` : ''} · ${pppoeUsername}`
      });
    } catch (e) {
      // Roll back the secret we just created so we never leave half-state.
      try {
        const secretId = createdSecret?.['.id'] || createdSecret?.id;
        if (secretId) await mkService.deletePPPoESecretById(secretId);
        else          await mkService.deletePPPoESecretByName(pppoeUsername);
      } catch (cleanupErr) {
        console.error(
          `[clients.create] address-list failed AND PPPoE rollback failed for "${pppoeUsername}":`,
          cleanupErr.message
        );
      }
      throw new AppError(
        `No se pudo autorizar la IP en el firewall del router: ${e.message}`,
        502,
        'MIKROTIK_AUTHORIZE_IP_FAILED'
      );
    }

    // 4. Persist client + mikrotikAccount in DB.
    let client;
    try {
      client = await prisma.client.create({
        data: {
          ...mappedData,
          serviceIp:     remoteAddress,
          mikrotikAccount: {
            create: {
              routerId:      resolvedRouterId,
              username:      pppoeUsername,
              password:      mk.password,
              remoteAddress: mk.remoteAddress || null,
              localAddress:  mk.localAddress || null,
              profileName:   mk.profileName || null,
              coordinates:   mk.coordinates || null,
              status:        mk.status || 'ACTIVE',
            }
          }
        },
        include: {
          plan: true,
          zone: true,
          mikrotikAccount: { include: { router: true } }
        }
      });
    } catch (e) {
      // 5. DB write failed AFTER both MikroTik ops succeeded. Best-effort
      // cleanup BOTH so we never leave phantom state on the router.
      try {
        const secretId = createdSecret?.['.id'] || createdSecret?.id;
        if (secretId) await mkService.deletePPPoESecretById(secretId);
        else          await mkService.deletePPPoESecretByName(pppoeUsername);
      } catch (cleanupErr) {
        console.error(
          `[clients.create] DB write failed AND PPPoE cleanup failed for "${pppoeUsername}":`,
          cleanupErr.message
        );
      }
      // Only remove the address-list entry if WE created it. If it already
      // existed (addressListResult.updated === true) we shouldn't delete
      // something the operator may have hand-curated.
      if (addressListResult?.created) {
        try {
          await mkService.removeFromAddressList({
            list: AUTHORIZED_LIST,
            address: remoteAddress
          });
        } catch (cleanupErr) {
          console.error(
            `[clients.create] DB write failed AND address-list cleanup failed for "${remoteAddress}":`,
            cleanupErr.message
          );
        }
      }
      throw new AppError(
        `No se pudo guardar el cliente en la base de datos: ${e.message}`,
        500,
        'DB_CREATE_FAILED'
      );
    }

    res.status(201).json({
      success: true,
      data: client,
      message: 'Cliente creado y IP autorizada correctamente en MikroTik'
    });
  });

  updateClient = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;

    // Check if client exists
    const existingClient = await prisma.client.findUnique({
      where: { id }
    });

    if (!existingClient) {
      throw new AppError('Cliente no encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    // Check for duplicate document number if it's being changed
    if (updateData.documentNumber && updateData.documentNumber !== existingClient.documentNumber) {
      const duplicateDocument = await prisma.client.findUnique({
        where: { documentNumber: updateData.documentNumber }
      });

      if (duplicateDocument) {
        throw new AppError('El número de documento ya está registrado', 409, 'DOCUMENT_NUMBER_EXISTS');
      }
    }

    // Check for duplicate email if it's being changed
    if (updateData.email && updateData.email !== existingClient.email) {
      const duplicateEmail = await prisma.client.findUnique({
        where: { email: updateData.email }
      });

      if (duplicateEmail) {
        throw new AppError('El email ya está registrado', 409, 'EMAIL_EXISTS');
      }
    }

    // Verify plan if it's being changed
    if (updateData.planId && updateData.planId !== existingClient.planId) {
      const plan = await prisma.plan.findUnique({
        where: { id: updateData.planId }
      });

      if (!plan) {
        throw new AppError('Plan no encontrado', 404, 'PLAN_NOT_FOUND');
      }
    }

    // If zoneId is being changed, validate the new zone has a router and
    // resolve the routerId from it (clients no longer pick a router directly).
    let resolvedRouterId = null;
    const nextZoneId = updateData.zoneId !== undefined
      ? (updateData.zoneId ? Number(updateData.zoneId) : null)
      : existingClient.zoneId;

    if (updateData.zoneId !== undefined) {
      if (!nextZoneId) {
        throw new AppError('Debe seleccionar una zona', 400, 'ZONE_REQUIRED');
      }
      const zone = await prisma.zone.findUnique({
        where: { id: nextZoneId },
        select: { id: true, name: true, routerId: true }
      });
      if (!zone) {
        throw new AppError('Zona no encontrada', 404, 'ZONE_NOT_FOUND');
      }
      if (!zone.routerId) {
        throw new AppError(
          `La zona "${zone.name}" no tiene router asignado`,
          400,
          'ZONE_WITHOUT_ROUTER'
        );
      }
      resolvedRouterId = zone.routerId;
    }

    // Map only the fields that belong to the Client model. The body may contain
    // a nested `mikrotik` object — we handle that separately with an upsert
    // against MikrotikAccount, avoiding "Unknown arg `mikrotik`" Prisma errors.
    const m = updateData.mikrotik;
    const clientFields = {
      ...(updateData.fullName       !== undefined && { name: updateData.fullName }),
      ...(updateData.email          !== undefined && { email: updateData.email || null }),
      ...(updateData.phone          !== undefined && { phone: updateData.phone || '' }),
      ...(updateData.address        !== undefined && { address: updateData.address || '' }),
      ...(updateData.neighborhood   !== undefined && { neighborhood: updateData.neighborhood || null }),
      ...(updateData.city           !== undefined && { city: updateData.city }),
      ...(updateData.documentType   !== undefined && { documentType: updateData.documentType }),
      ...(updateData.documentNumber !== undefined && { documentNumber: updateData.documentNumber || null }),
      ...(updateData.zoneId         !== undefined && { zoneId: nextZoneId }),
      ...(updateData.planId         !== undefined && { planId: updateData.planId || null }),
      ...(updateData.notes          !== undefined && { notes: updateData.notes || null }),
      ...(updateData.contractDate   !== undefined && { contractDate: updateData.contractDate ? new Date(updateData.contractDate) : null }),
      ...(updateData.installationDate !== undefined && { installationDate: updateData.installationDate ? new Date(updateData.installationDate) : null }),
    };

    const ops = [
      prisma.client.update({
        where: { id },
        data: clientFields,
        include: { plan: true, zone: true, mikrotikAccount: { include: { router: true } } }
      })
    ];

    // Mikrotik account upsert: always force routerId from the (current or new) zone.
    // We upsert when a mikrotik payload is provided OR when the zone changed
    // (so the account follows the new zone's router).
    if (m || resolvedRouterId !== null) {
      const targetRouterId = resolvedRouterId
        ?? (await prisma.zone.findUnique({ where: { id: nextZoneId }, select: { routerId: true } }))?.routerId;
      if (targetRouterId) {
        ops.push(
          prisma.mikrotikAccount.upsert({
            where: { clientId: id },
            create: {
              clientId: id,
              routerId: targetRouterId,
              username: m?.username || '',
              password: m?.password || '',
              remoteAddress: m?.remoteAddress || null,
              localAddress: m?.localAddress || null,
              profileName: m?.profileName || null,
              coordinates: m?.coordinates || null,
              status: m?.status || 'ACTIVE',
            },
            update: {
              routerId: targetRouterId,
              ...(m?.username      !== undefined && { username: m.username }),
              ...(m?.password      !== undefined && m.password && { password: m.password }),
              ...(m?.remoteAddress !== undefined && { remoteAddress: m.remoteAddress || null }),
              ...(m?.localAddress  !== undefined && { localAddress: m.localAddress || null }),
              ...(m?.profileName   !== undefined && { profileName: m.profileName || null }),
              ...(m?.coordinates   !== undefined && { coordinates: m.coordinates || null }),
              ...(m?.status        !== undefined && { status: m.status }),
            },
          })
        );
      }
    }

    const [client] = await prisma.$transaction(ops);

    res.json({
      success: true,
      data: client,
      message: 'Cliente actualizado exitosamente'
    });
  });

  deleteClient = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Check if client exists
    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        mikrotikAccount: true,
        _count: {
          select: {
            invoices: true,
            payments: true
          }
        }
      }
    });

    if (!client) {
      throw new AppError('Cliente no encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    // Check if client has invoices or payments
    if (client._count.invoices > 0 || client._count.payments > 0) {
      throw new AppError('No se puede eliminar un cliente con facturas o pagos asociados', 400, 'CLIENT_HAS_TRANSACTIONS');
    }

    // Remove Mikrotik account if exists
    if (client.mikrotikAccount) {
      await prisma.mikrotikAccount.delete({
        where: { id: client.mikrotikAccount.id }
      });
    }

    await prisma.client.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Cliente eliminado exitosamente'
    });
  });

  getClientDevices = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const devices = await prisma.device.findMany({
      where: { clientId: id },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: devices
    });
  });

  addDevice = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const deviceData = req.body;

    // Check if client exists
    const client = await prisma.client.findUnique({
      where: { id }
    });

    if (!client) {
      throw new AppError('Cliente no encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    // Check if MAC address already exists
    const existingDevice = await prisma.device.findUnique({
      where: { macAddress: deviceData.macAddress }
    });

    if (existingDevice) {
      throw new AppError('La dirección MAC ya está registrada', 409, 'MAC_ADDRESS_EXISTS');
    }

    const device = await prisma.device.create({
      data: {
        ...deviceData,
        clientId: id
      }
    });

    // TODO: Add device to Mikrotik via REST API when write support is implemented

    res.status(201).json({
      success: true,
      data: device,
      message: 'Dispositivo agregado exitosamente'
    });
  });

  updateDevice = asyncHandler(async (req, res) => {
    const { id, deviceId } = req.params;
    const updateData = req.body;

    // Check if device exists and belongs to client
    const device = await prisma.device.findFirst({
      where: {
        id: deviceId,
        clientId: id
      }
    });

    if (!device) {
      throw new AppError('Dispositivo no encontrado', 404, 'DEVICE_NOT_FOUND');
    }

    // Check for duplicate MAC address if it's being changed
    if (updateData.macAddress && updateData.macAddress !== device.macAddress) {
      const existingDevice = await prisma.device.findUnique({
        where: { macAddress: updateData.macAddress }
      });

      if (existingDevice) {
        throw new AppError('La dirección MAC ya está registrada', 409, 'MAC_ADDRESS_EXISTS');
      }
    }

    const updatedDevice = await prisma.device.update({
      where: { id: deviceId },
      data: updateData
    });

    res.json({
      success: true,
      data: updatedDevice,
      message: 'Dispositivo actualizado exitosamente'
    });
  });

  removeDevice = asyncHandler(async (req, res) => {
    const { id, deviceId } = req.params;

    // Check if device exists and belongs to client
    const device = await prisma.device.findFirst({
      where: {
        id: deviceId,
        clientId: id
      },
      include: {
        client: {
          select: { id: true }
        }
      }
    });

    if (!device) {
      throw new AppError('Dispositivo no encontrado', 404, 'DEVICE_NOT_FOUND');
    }

    // TODO: Remove device from Mikrotik via REST API when write support is implemented

    await prisma.device.delete({
      where: { id: deviceId }
    });

    res.json({
      success: true,
      message: 'Dispositivo eliminado exitosamente'
    });
  });

  suspendService = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const client = await prisma.client.findUnique({
      where: { id },
      include: { plan: true, mikrotikAccount: true }
    });

    if (!client) {
      throw new AppError('Cliente no encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    if (client.status === 'SUSPENDED') {
      throw new AppError('El servicio ya está suspendido', 400, 'SERVICE_ALREADY_SUSPENDED');
    }

    await prisma.client.update({
      where: { id },
      data: { status: 'SUSPENDED' }
    });

    if (client.mikrotikAccount) {
      try {
        await prisma.mikrotikAccount.update({
          where: { id: client.mikrotikAccount.id },
          data: { status: 'SUSPENDED' }
        });
      } catch (error) {
        console.error('Failed to flag Mikrotik account as SUSPENDED in DB:', error);
      }
    }

    // Push the change to the router: disable the PPPoE secret, kick any active
    // session, and add the assigned IP to the "Moroso" address-list (enabled).
    // Best-effort: if the router is unreachable, we keep the DB change and log
    // the failure so it can be retried manually.
    const mikrotikResult = { attempted: false, secret: null, kick: null, addressList: null, error: null };
    if (client.mikrotikAccount) {
      mikrotikResult.attempted = true;
      try {
        const { service } = await getMikrotikServiceForClient(client.id);
        const username = client.mikrotikAccount.username;
        const remoteAddress = (client.mikrotikAccount.remoteAddress || client.serviceIp || '').split('/')[0];

        // 1) Disable PPPoE secret + kick active session
        try {
          mikrotikResult.secret = await service.disablePPPoESecret(username);
        } catch (e) {
          mikrotikResult.secret = { error: e.message };
        }
        try {
          mikrotikResult.kick = await service.kickActivePPPoE(username);
        } catch (e) {
          mikrotikResult.kick = { error: e.message };
        }

        // 2) Add to Moroso address-list (enabled)
        if (remoteAddress) {
          try {
            mikrotikResult.addressList = await service.addToAddressList({
              list: MOROSO_LIST,
              address: remoteAddress,
              comment: username
            });
          } catch (e) {
            mikrotikResult.addressList = { error: e.message };
          }
        } else {
          mikrotikResult.addressList = { skipped: true, reason: 'no_remote_address' };
        }
      } catch (error) {
        console.error('Failed to push suspension to MikroTik:', error.message);
        mikrotikResult.error = error.message;
      }
    }

    try { await notificationService.sendServiceSuspension(client); } catch {}

    res.json({
      success: true,
      message: 'Servicio suspendido exitosamente',
      data: { mikrotik: mikrotikResult }
    });
  });

  activateService = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const client = await prisma.client.findUnique({
      where: { id },
      include: { plan: true, mikrotikAccount: true }
    });

    if (!client) {
      throw new AppError('Cliente no encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    if (client.status === 'ACTIVE') {
      throw new AppError('El servicio ya está activo', 400, 'SERVICE_ALREADY_ACTIVE');
    }

    await prisma.client.update({
      where: { id },
      data: { status: 'ACTIVE' }
    });

    if (client.mikrotikAccount) {
      try {
        await prisma.mikrotikAccount.update({
          where: { id: client.mikrotikAccount.id },
          data: { status: 'ACTIVE' }
        });
      } catch (error) {
        console.error('Failed to flag Mikrotik account as ACTIVE in DB:', error);
      }
    }

    // Push reactivation to the router: enable the PPPoE secret and remove the
    // entry from the "Moroso" address-list. Best-effort.
    const mikrotikResult = { attempted: false, secret: null, addressList: null, error: null };
    if (client.mikrotikAccount) {
      mikrotikResult.attempted = true;
      try {
        const { service } = await getMikrotikServiceForClient(client.id);
        const username = client.mikrotikAccount.username;
        const remoteAddress = (client.mikrotikAccount.remoteAddress || client.serviceIp || '').split('/')[0];

        try {
          mikrotikResult.secret = await service.enablePPPoESecret(username);
        } catch (e) {
          mikrotikResult.secret = { error: e.message };
        }

        if (remoteAddress) {
          try {
            mikrotikResult.addressList = await service.removeFromAddressList({
              list: MOROSO_LIST,
              address: remoteAddress
            });
          } catch (e) {
            mikrotikResult.addressList = { error: e.message };
          }
        } else {
          mikrotikResult.addressList = { skipped: true, reason: 'no_remote_address' };
        }
      } catch (error) {
        console.error('Failed to push activation to MikroTik:', error.message);
        mikrotikResult.error = error.message;
      }
    }

    try { await notificationService.sendServiceActivation(client); } catch {}

    res.json({
      success: true,
      message: 'Servicio activado exitosamente',
      data: { mikrotik: mikrotikResult }
    });
  });

  changePlan = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { planId } = req.body;

    const client = await prisma.client.findUnique({
      where: { id }
    });

    if (!client) {
      throw new AppError('Cliente no encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    const plan = await prisma.plan.findUnique({
      where: { id: planId }
    });

    if (!plan) {
      throw new AppError('Plan no encontrado', 404, 'PLAN_NOT_FOUND');
    }

    const updatedClient = await prisma.client.update({
      where: { id },
      data: { planId },
      include: { plan: true }
    });

    // TODO: Update plan in Mikrotik via REST API when write support is implemented

    res.json({
      success: true,
      data: updatedClient,
      message: 'Plan cambiado exitosamente'
    });
  });

  getClientInvoices = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const skip = (page - 1) * limit;

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where: { clientId: id },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          plan: {
            select: {
              id: true,
              name: true,
              price: true
            }
          },
          payments: {
            select: {
              id: true,
              amount: true,
              paymentMethod: true,
              status: true,
              paidAt: true
            }
          }
        }
      }),
      prisma.invoice.count({ where: { clientId: id } })
    ]);

    res.json({
      success: true,
      data: invoices,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  });

  getClientPayments = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where: {
          invoice: {
            clientId: id
          }
        },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              amount: true,
              dueDate: true,
              status: true
            }
          }
        }
      }),
      prisma.payment.count({
        where: {
          invoice: {
            clientId: id
          }
        }
      })
    ]);

    res.json({
      success: true,
      data: payments,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  });

  getClientBalance = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const [totalInvoices, totalPayments] = await Promise.all([
      prisma.invoice.aggregate({
        where: { clientId: id },
        _sum: { amount: true }
      }),
      prisma.payment.aggregate({
        where: {
          invoice: { clientId: id },
          status: 'COMPLETED'
        },
        _sum: { amount: true }
      })
    ]);

    const balance = (totalInvoices._sum.amount || 0) - (totalPayments._sum.amount || 0);

    res.json({
      success: true,
      data: {
        totalInvoiced: totalInvoices._sum.amount || 0,
        totalPaid: totalPayments._sum.amount || 0,
        balance,
        isOverdue: balance > 0
      }
    });
  });

  // Computes the next sequential numeric prefix used in PPPoE usernames.
  // Looks at Client.pppoeUsername and MikrotikAccount.username; takes the
  // max leading-digit run found, returns max + 1 zero-padded to 4 chars
  // (or wider if the existing max is already wider).
  getNextPppoeNumber = asyncHandler(async (req, res) => {
    const [clients, accounts] = await Promise.all([
      prisma.client.findMany({
        where: { pppoeUsername: { not: null } },
        select: { pppoeUsername: true }
      }),
      prisma.mikrotikAccount.findMany({
        select: { username: true }
      })
    ]);

    let max = 0;
    let maxWidth = 4;
    const usernames = [
      ...clients.map(c => c.pppoeUsername),
      ...accounts.map(a => a.username)
    ];
    for (const name of usernames) {
      if (!name) continue;
      const m = String(name).match(/^(\d+)/);
      if (!m) continue;
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
      if (m[1].length > maxWidth) maxWidth = m[1].length;
    }

    const next = max + 1;
    const padded = String(next).padStart(maxWidth, '0');
    res.json({ success: true, data: { next: padded, raw: next, width: maxWidth } });
  });

  getClientStats = asyncHandler(async (req, res) => {
    const [total, byStatus, newThisMonth] = await Promise.all([
      prisma.client.count(),
      prisma.client.groupBy({
        by: ['status'],
        _count: true
      }),
      prisma.client.count({
        where: {
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          }
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        total,
        byStatus,
        newThisMonth
      }
    });
  });

  getClientsByCity = asyncHandler(async (req, res) => {
    const clientsByCity = await prisma.client.groupBy({
      by: ['city'],
      _count: true,
      orderBy: {
        _count: {
          city: 'desc'
        }
      }
    });

    res.json({
      success: true,
      data: clientsByCity
    });
  });

  getClientsByPlan = asyncHandler(async (req, res) => {
    const clientsByPlan = await prisma.client.groupBy({
      by: ['planId'],
      _count: true
    });

    // Get plan details
    const planIds = clientsByPlan.map(item => item.planId);
    const plans = await prisma.plan.findMany({
      where: { id: { in: planIds } },
      select: { id: true, name: true, price: true }
    });

    const result = clientsByPlan.map(item => {
      const plan = plans.find(p => p.id === item.planId);
      return {
        planId: item.planId,
        planName: plan?.name || 'Unknown',
        planPrice: plan?.price || 0,
        clientCount: item._count
      };
    });

    res.json({
      success: true,
      data: result
    });
  });
}

export const clientController = new ClientsController();
