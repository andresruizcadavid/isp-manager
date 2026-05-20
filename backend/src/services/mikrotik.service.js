import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const REQUEST_TIMEOUT_MS = 15000;
// Network-level transient failures we should retry. HTTP 4xx/5xx are NOT
// retried — those are deterministic responses from the router.
const TRANSIENT_NET_CODES = new Set([
  'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH',
  'ENETUNREACH', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET'
]);

function isTransientNetError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true; // our own timeout
  // Node's undici (built-in fetch) wraps errors in TypeError 'fetch failed'
  // with the actual cause attached as err.cause.
  const cause = err.cause || err;
  return TRANSIENT_NET_CODES.has(cause?.code) ||
         /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(String(err.message || ''));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class MikrotikService {
  /**
   * Accepts an explicit endpoint config so the caller decides which IP to
   * dial. Use `buildMikrotikService(router)` or `getMikrotikService(routerId)`
   * if you want the failover resolver to pick the IP for you.
   *
   * @param {{ ip:string, apiPort?:number, username:string, password:string, routerName?:string, routerId?:number }} cfg
   */
  constructor(cfg) {
    if (!cfg?.ip) {
      throw new Error('MikrotikService requires an explicit { ip, ... } config');
    }
    this.routerId   = cfg.routerId ?? null;
    this.routerName = cfg.routerName ?? null;
    this.ip         = cfg.ip;
    const port = cfg.apiPort && cfg.apiPort !== 80 ? `:${cfg.apiPort}` : ':80';
    this.baseUrl = `http://${cfg.ip}${port}/rest`;
    this.headers = {
      'Authorization': 'Basic ' + Buffer.from(
        `${cfg.username ?? ''}:${cfg.password ?? ''}`
      ).toString('base64'),
      'Content-Type': 'application/json'
    };
  }

  // Single attempt. Throws on any error (HTTP or network).
  async _requestOnce(path, method, body, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const opts = { method, headers: this.headers, signal: controller.signal };
    if (body !== null && body !== undefined) opts.body = JSON.stringify(body);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, opts);
      clearTimeout(timeout);

      if (res.status === 401) throw new Error('Credenciales incorrectas (401 Unauthorized)');
      if (res.status === 404) throw new Error(`Endpoint no existe en este RouterOS: ${path}`);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`MikroTik error ${res.status}: ${text}`);
      }

      const text = await res.text();
      if (!text || text.trim() === '') return [];
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Respuesta inválida del router: ${text.slice(0, 100)}`);
      }
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') {
        throw new Error(`Timeout: El router no respondió en ${Math.round(timeoutMs / 1000)} segundos`);
      }
      throw e;
    }
  }

  /**
   * MikroTik REST request with retry+backoff on transient network failures.
   *
   * @param {string}  path
   * @param {string}  method
   * @param {*}       body
   * @param {object}  [opts]
   * @param {number}  [opts.retries=2]   extra attempts after the first (so 2 = up to 3 tries total)
   * @param {number}  [opts.timeoutMs]   per-attempt timeout
   */
  async request(path, method = 'GET', body = null, opts = {}) {
    const retries   = opts.retries   ?? 2;
    const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const totalAttempts = retries + 1;

    let lastErr = null;
    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      try {
        console.log(`[MikroTik] ${method} ${this.baseUrl}${path}${attempt > 1 ? ` (retry ${attempt - 1}/${retries})` : ''}`);
        const result = await this._requestOnce(path, method, body, timeoutMs);
        if (attempt > 1) {
          console.log(`[MikroTik] OK after retry ${attempt - 1}`);
        }
        return result;
      } catch (e) {
        lastErr = e;
        // Only retry transient network errors. HTTP 4xx/5xx returns
        // deterministic state — retrying won't change the answer.
        if (!isTransientNetError(e) || attempt === totalAttempts) {
          console.error(`[MikroTik] ${method} ${path} failed (attempt ${attempt}/${totalAttempts}):`, e.message);
          throw e;
        }
        // Exponential backoff: 400ms, 800ms, 1600ms...
        const wait = 400 * Math.pow(2, attempt - 1);
        console.warn(`[MikroTik] transient error on ${path} (attempt ${attempt}/${totalAttempts}): ${e.message} — retrying in ${wait}ms`);
        await sleep(wait);
      }
    }
    throw lastErr;
  }

  // ---------------------------------------------------------------------------
  // System / read
  // ---------------------------------------------------------------------------

  async testConnection() {
    const data = await this.request('/system/identity');
    return { success: true, identity: data?.name || 'MikroTik' };
  }

  async getSystemInfo() {
    const [identity, resource, routerboard] = await Promise.all([
      this.request('/system/identity'),
      this.request('/system/resource'),
      this.request('/system/routerboard').catch(() => null)
    ]);
    return { identity, resource, routerboard };
  }

  async getIdentity() {
    return this.request('/system/identity');
  }

  async getSystemResource() {
    return this.request('/system/resource');
  }

  async getInterfaces() {
    return this.request('/interface');
  }

  async getIPPools() {
    return this.request('/ip/pool');
  }

  // ---------------------------------------------------------------------------
  // PPPoE — read
  // ---------------------------------------------------------------------------

  async getPPPoESecrets() {
    return this.request('/ppp/secret');
  }

  async getActivePPPoE() {
    return this.request('/ppp/active');
  }

  async getPPPoEProfiles() {
    return this.request('/ppp/profile');
  }

  async findPPPoEProfileByName(name) {
    if (!name) throw new Error('findPPPoEProfileByName: name requerido');
    const list = await this.request(`/ppp/profile?name=${encodeURIComponent(name)}`);
    if (Array.isArray(list) && list.length > 0) return list[0];
    return null;
  }

  async deletePPPoEProfileByName(name) {
    const profile = await this.findPPPoEProfileByName(name);
    if (!profile) return { skipped: true, reason: 'not_found' };
    // MikroTik refuses to delete the built-in "default" / "default-encryption"
    // profiles. Guard explicitly so the caller gets a clean error.
    if (name === 'default' || name === 'default-encryption') {
      throw new Error(`El perfil "${name}" es interno de MikroTik y no se puede eliminar.`);
    }
    await this.request(`/ppp/profile/${encodeURIComponent(profile['.id'])}`, 'DELETE');
    return { deleted: true, id: profile['.id'] };
  }

  async findPPPoESecretByName(name) {
    if (!name) throw new Error('findPPPoESecretByName: name requerido');
    // RouterOS REST supports query: ?name=foo
    const list = await this.request(`/ppp/secret?name=${encodeURIComponent(name)}`);
    if (Array.isArray(list) && list.length > 0) return list[0];
    return null;
  }

  async findActivePPPoEByName(name) {
    if (!name) throw new Error('findActivePPPoEByName: name requerido');
    const list = await this.request(`/ppp/active?name=${encodeURIComponent(name)}`);
    if (Array.isArray(list) && list.length > 0) return list[0];
    return null;
  }

  // ---------------------------------------------------------------------------
  // PPPoE — write
  // ---------------------------------------------------------------------------

  async createPPPoESecret({ name, password, profile, service = 'pppoe', remoteAddress, comment, disabled = false }) {
    if (!name || !password) {
      throw new Error('createPPPoESecret: name y password son requeridos');
    }
    const body = {
      name,
      password,
      service,
      disabled: disabled ? 'true' : 'false'
    };
    if (profile) body.profile = profile;
    if (remoteAddress) body['remote-address'] = remoteAddress;
    if (comment) body.comment = comment;
    return this.request('/ppp/secret', 'PUT', body);
  }

  async updatePPPoESecretById(id, data) {
    if (!id) throw new Error('updatePPPoESecretById: id requerido');
    return this.request(`/ppp/secret/${encodeURIComponent(id)}`, 'PATCH', data);
  }

  async updatePPPoESecretByName(name, data) {
    const secret = await this.findPPPoESecretByName(name);
    if (!secret) throw new Error(`PPPoE secret '${name}' no existe en el router`);
    return this.updatePPPoESecretById(secret['.id'], data);
  }

  async deletePPPoESecretById(id) {
    if (!id) throw new Error('deletePPPoESecretById: id requerido');
    return this.request(`/ppp/secret/${encodeURIComponent(id)}`, 'DELETE');
  }

  async deletePPPoESecretByName(name) {
    const secret = await this.findPPPoESecretByName(name);
    if (!secret) return { skipped: true, reason: 'not_found' };
    await this.deletePPPoESecretById(secret['.id']);
    return { deleted: true, id: secret['.id'] };
  }

  async enablePPPoESecret(name) {
    return this.updatePPPoESecretByName(name, { disabled: 'false' });
  }

  async disablePPPoESecret(name) {
    return this.updatePPPoESecretByName(name, { disabled: 'true' });
  }

  async setPPPoEProfile(name, profile) {
    if (!profile) throw new Error('setPPPoEProfile: profile requerido');
    return this.updatePPPoESecretByName(name, { profile });
  }

  async kickActivePPPoE(name) {
    const active = await this.findActivePPPoEByName(name);
    if (!active) return { skipped: true, reason: 'not_active' };
    // RouterOS REST: POST /ppp/active/remove con {.id}
    await this.request('/ppp/active/remove', 'POST', { '.id': active['.id'] });
    return { kicked: true, id: active['.id'] };
  }

  /**
   * Suspende una cuenta PPPoE: deshabilita el secret y desconecta la sesión activa
   * si existe. Devuelve un resumen de lo realizado.
   */
  async suspendPPPoE(name) {
    await this.disablePPPoESecret(name);
    const kick = await this.kickActivePPPoE(name).catch((e) => ({
      kicked: false,
      error: e.message
    }));
    return { name, disabled: true, kick };
  }

  /**
   * Reactiva una cuenta PPPoE habilitando el secret. La sesión se restablecerá
   * cuando el cliente intente reconectarse.
   */
  async reactivatePPPoE(name) {
    await this.enablePPPoESecret(name);
    return { name, enabled: true };
  }

  // ---------------------------------------------------------------------------
  // Firewall address-list (used for "Moroso" / overdue list)
  // ---------------------------------------------------------------------------

  async findAddressListEntry(list, address) {
    if (!list || !address) {
      throw new Error('findAddressListEntry: list y address son requeridos');
    }
    const all = await this.request('/ip/firewall/address-list');
    if (!Array.isArray(all)) return null;
    const entry = all.find(e =>
      (e.list === list || e['list'] === list) &&
      (e.address === address || (e['address'] || '').split('/')[0] === address)
    );
    return entry || null;
  }

  /**
   * Asegura que `address` esté presente y habilitado en la lista `list`.
   * Si ya existe, actualiza disabled=false y comment. Idempotente.
   */
  async addToAddressList({ list, address, comment }) {
    if (!list || !address) {
      throw new Error('addToAddressList: list y address son requeridos');
    }
    const existing = await this.findAddressListEntry(list, address);
    if (existing) {
      await this.request(
        `/ip/firewall/address-list/${encodeURIComponent(existing['.id'])}`,
        'PATCH',
        { disabled: 'false', ...(comment ? { comment } : {}) }
      );
      return { updated: true, id: existing['.id'] };
    }
    const body = { list, address, disabled: 'false' };
    if (comment) body.comment = comment;
    const created = await this.request('/ip/firewall/address-list', 'PUT', body);
    return { created: true, id: created?.['.id'] || null };
  }

  /**
   * Elimina la entrada `address` de la lista `list`. Si no existe, retorna
   * skipped:true (operación idempotente).
   */
  async removeFromAddressList({ list, address }) {
    if (!list || !address) {
      throw new Error('removeFromAddressList: list y address son requeridos');
    }
    const existing = await this.findAddressListEntry(list, address);
    if (!existing) return { skipped: true, reason: 'not_found' };
    await this.request(
      `/ip/firewall/address-list/${encodeURIComponent(existing['.id'])}`,
      'DELETE'
    );
    return { deleted: true, id: existing['.id'] };
  }
}

// -----------------------------------------------------------------------------
// Factories — usar estas en vez del singleton legacy
// -----------------------------------------------------------------------------

/**
 * Picks the IP to dial from a router-with-routes object: first route with
 * status=ONLINE in priority order, falling back to the first route by
 * priority if none have been probed (or none are currently up — best effort
 * so a freshly-created or fully-offline router still attempts the call and
 * surfaces the network error to the caller).
 *
 * Returns { ip, route } or throws if the router has no routes at all.
 */
export function pickActiveRoute(routerWithRoutes) {
  const routes = (routerWithRoutes?.routes ?? []).slice()
    .sort((a, b) => a.priority - b.priority);
  if (routes.length === 0) {
    throw new Error(`Router '${routerWithRoutes?.name ?? '?'}' no tiene rutas configuradas`);
  }
  const online = routes.find(r => r.status === 'ONLINE');
  const chosen = online ?? routes[0];
  return { ip: chosen.ip, route: chosen };
}

/**
 * Construye un MikrotikService a partir de un router-con-routes ya cargado.
 * No hace I/O. Usa pickActiveRoute para decidir el IP.
 */
export function buildMikrotikService(routerWithRoutes) {
  const { ip } = pickActiveRoute(routerWithRoutes);
  return new MikrotikService({
    ip,
    apiPort:    routerWithRoutes.apiPort,
    username:   routerWithRoutes.username,
    password:   routerWithRoutes.password,
    routerId:   routerWithRoutes.id,
    routerName: routerWithRoutes.name
  });
}

/**
 * Devuelve un MikrotikService configurado para el router indicado.
 * Lanza si el router no existe, está inactivo o no tiene rutas.
 */
export async function getMikrotikService(routerId) {
  if (!routerId) throw new Error('getMikrotikService: routerId requerido');
  const router = await prisma.router.findUnique({
    where:   { id: Number(routerId) },
    include: { routes: { orderBy: { priority: 'asc' } } }
  });
  if (!router) throw new Error(`Router id=${routerId} no existe`);
  if (!router.isActive) throw new Error(`Router '${router.name}' está desactivado`);
  return buildMikrotikService(router);
}

/**
 * Resuelve la cuenta Mikrotik de un cliente y devuelve el servicio del router
 * correspondiente, junto con la cuenta. Útil para suspender/reactivar.
 */
export async function getMikrotikServiceForClient(clientId) {
  if (!clientId) throw new Error('getMikrotikServiceForClient: clientId requerido');
  const account = await prisma.mikrotikAccount.findUnique({
    where:   { clientId },
    include: { router: { include: { routes: { orderBy: { priority: 'asc' } } } } }
  });
  if (!account) throw new Error(`Cliente ${clientId} no tiene cuenta Mikrotik vinculada`);
  if (!account.router) throw new Error(`Cuenta Mikrotik del cliente ${clientId} no tiene router`);
  if (!account.router.isActive) {
    throw new Error(`Router '${account.router.name}' está desactivado`);
  }
  return { service: buildMikrotikService(account.router), account };
}

/**
 * Prueba credenciales contra un router antes de guardarlo en BD.
 * No requiere que el router exista.
 */
export async function testRouterCredentials({ ip, ipAddress, apiPort = 80, username, password }) {
  const tmp = new MikrotikService({
    // Acepta `ip` (nuevo) o `ipAddress` (legacy callers que no se hayan migrado).
    ip: ip ?? ipAddress,
    apiPort,
    username,
    password
  });
  return tmp.testConnection();
}

// -----------------------------------------------------------------------------
// Singleton legacy DEPRECADO
// -----------------------------------------------------------------------------
// Antes este export era un stub que devolvía {success:true} silenciosamente,
// lo que hacía que las suspensiones/activaciones "funcionaran" pero nunca
// llegaran al router. Ahora cualquier acceso lanza un error claro indicando
// la migración requerida. Los callers que aún lo usan
// (overdue.job.js, mikrotik.controller.js, reports.controller.js) se migran
// en fases posteriores.
export const mikrotikService = new Proxy({}, {
  get(_, prop) {
    if (prop === 'then' || typeof prop === 'symbol') return undefined;
    return () => {
      throw new Error(
        `mikrotikService.${String(prop)}() está deprecado. ` +
        `Usa getMikrotikService(routerId) o getMikrotikServiceForClient(clientId) ` +
        `desde mikrotik.service.js.`
      );
    };
  }
});
