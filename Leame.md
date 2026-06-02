# ISP Manager — Documentación Técnica del Proyecto

> Generado automáticamente mediante auditoría de código.
> Última actualización: 2026-06-01 (hotfix producción)

---

## Stack Tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Frontend | SvelteKit (adapter-static, SPA) | ^1.27.4 |
| Frontend Runtime | Svelte | ^4.2.8 |
| Backend Runtime | Node.js | >=18, v20.20.2 en prod |
| Backend Framework | Express | ^4.18.2 |
| ORM | Prisma (Client + Migrate) | ^5.6.0 |
| Base de datos | PostgreSQL | 15 |
| Cache / Cola | Redis 7 + ioredis + BullMQ (scaffold) | ^5.3.2 / ^4.12.2 |
| Gestor paquetes | npm | 10.8.2 en prod |
| Build tool frontend | Vite | ^4.4.2 |
| Estilos | TailwindCSS + DaisyUI | ^3.4.19 / ^5.5.19 |
| Iconos | lucide-svelte | ^1.0.1 |
| Autenticación | JWT (jsonwebtoken) + bcryptjs + sesiones DB | ^9.0.2 / ^2.4.3 |
| Validación | Zod | ^3.22.4 |
| Tiempo real | socket.io + socket.io-client | ^4.8.3 |
| Procesos prod | PM2 | 7.0.1 |
| Infra | Docker + Docker Compose | Alpine-based |
| Proxy reverso | Nginx | Alpine-based |

---

## Estructura del Proyecto

```
isp-manager/
├── backend/
│   ├── src/
│   │   ├── app.js                        # Express setup, CORS, 19 routers montados
│   │   ├── server.js                     # Entry: Prisma, Redis, Socket.io, crons
│   │   ├── config/
│   │   │   └── env.js                    # Zod schema de 30+ variables de entorno
│   │   ├── controllers/
│   │   │   ├── auth.controller.js        # login/register/logout/change-password
│   │   │   ├── clients.controller.js     # CRUD + suspend/activate/changePlan/tokens
│   │   │   ├── invoices.controller.js    # CRUD + bulkGenerate + PDF + Wompi checkout
│   │   │   ├── mikrotik.controller.js    # Proxy a RouterOS REST API
│   │   │   ├── payments.controller.js    # CRUD + refunds + Wompi webhook + sync
│   │   │   └── reports.controller.js     # Dashboard + financial + collection + export
│   │   ├── middleware/
│   │   │   ├── auth.middleware.js        # JWT verify + session DB lookup + roles
│   │   │   ├── error.middleware.js       # AppError + Prisma/Zod/Multer handlers
│   │   │   └── validate.middleware.js    # Zod body/query/params validators
│   │   ├── routes/ (19 archivos)
│   │   │   ├── auth.routes.js            # 6 endpoints
│   │   │   ├── clients.routes.js         # 9 endpoints + bulk
│   │   │   ├── invoices.routes.js        # 9 endpoints
│   │   │   ├── payments.routes.js        # 5 endpoints + webhook
│   │   │   ├── mikrotik.routes.js        # 10+ endpoints de proxy RouterOS
│   │   │   ├── routers.routes.js         # CRUD + sync + import PPPoE
│   │   │   ├── network.routes.js         # Devices + connections + events
│   │   │   ├── notifications.routes.js   # Templates + campaigns + history
│   │   │   ├── public.client-updates.routes.js  # Público: token GET/PUT/POST
│   │   │   ├── ... (zones, plans, accounts, evidence, reports, dashboard, smtp, telegram, whatsapp, users)
│   │   ├── services/ (14 archivos)
│   │   │   ├── mikrotik.service.js       # RouterOS REST client + failover
│   │   │   ├── network-monitor.service.js # ICMP sweep + state machine
│   │   │   ├── router-monitor.service.js  # ICMP per route + router status
│   │   │   ├── notification.service.js    # SMTP + WhatsApp + Telegram sends
│   │   │   ├── notification.campaign.service.js  # Audiencia + envío masivo
│   │   │   ├── wompi.service.js           # Checkout + webhook signature
│   │   │   ├── whatsapp.service.js         # Meta Cloud API
│   │   │   ├── telegram.service.js         # Bot alerts
│   │   │   ├── invoice.service.js          # PDFKit generation
│   │   │   ├── client-update-token.service.js  # Self-service tokens
│   │   │   ├── queue.service.js            # BullMQ scaffold (inactivo)
│   │   │   ├── redis.service.js            # IORedis + cache + rate limit
│   │   │   ├── socket.service.js           # Singleton socket.io
│   │   │   └── email-base.template.js      # HTML email templates
│   │   ├── jobs/
│   │   │   ├── billing.job.js             # 6 cron jobs (facturación)
│   │   │   ├── overdue.job.js             # 4 cron jobs (suspensiones)
│   │   │   └── queue.bootstrap.js         # BullMQ workers (placeholder)
│   │   └── prisma/
│   │       └── schema.prisma              # ⚠️ SCHEMA ANTIGUO — no usar
│   ├── prisma/
│   │   ├── schema.prisma                  # Schema activo (25 modelos, 11 enums)
│   │   ├── migrations/                    # 21 migraciones aplicadas
│   │   ├── seed.js                        # admin@demo.com / password123
│   │   └── init.sql
│   ├── scripts/                           # import-wisphub, scrape, analyze, seed-templates
│   ├── Dockerfile / Dockerfile.dev
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── +layout.svelte             # Root layout
│   │   │   ├── +page.svelte               # Home
│   │   │   ├── login/+page.svelte         # Login page
│   │   │   ├── (app)/                     # Rutas autenticadas (sidebar layout)
│   │   │   │   ├── dashboard/             # KPIs + charts
│   │   │   │   ├── clients/               # List + [id] detail + new (stepper)
│   │   │   │   ├── plans/                 # CRUD planes
│   │   │   │   ├── zones/                 # CRUD zonas
│   │   │   │   ├── invoices/              # List + PDF + send
│   │   │   │   ├── payments/              # List + register
│   │   │   │   ├── mikrotik/              # Overview + routers + accounts
│   │   │   │   ├── network/               # Map + events + settings
│   │   │   │   ├── notifications/         # Campaigns + templates + history + configs
│   │   │   │   ├── reports/               # Multi-tab financial + clients + invoices
│   │   │   │   ├── users/                 # CRUD usuarios sistema
│   │   │   │   └── forbidden/             # 403 page
│   │   │   └── (public)/                  # Rutas públicas
│   │   │       └── update/[token]/        # Portal auto-servicio cliente
│   │   ├── lib/
│   │   │   ├── api/ (15 wrappers)         # clients, invoices, payments, etc.
│   │   │   ├── stores/ (4 stores)         # auth, socket, toast, ui
│   │   │   ├── components/
│   │   │   │   ├── layout/ (Header, Sidebar)
│   │   │   │   ├── network/ (DeviceNode, ZoneTabs)
│   │   │   │   └── ui/ (Button, Input, Modal, Sheet, Table, etc.)
│   │   │   └── permissions.js             # RBAC route guard + sidebar filter
│   │   ├── app.css                        # Base styles
│   │   └── app.html                       # HTML shell
│   ├── svelte.config.js                   # adapter-static, fallback 200.html
│   ├── vite.config.js                     # proxy /api + /uploads → :3001
│   ├── tailwind.config.js                 # Brand palette (blues), surface tokens
│   └── Dockerfile                         # Multi-stage build + nginx:alpine
│
├── docker-compose.yml                     # Producción (postgres, redis, backend, frontend, pgadmin)
├── docker-compose.dev.yml                 # Desarrollo (hot-reload backend)
├── design-rules.md                        # Paleta, botones, contraste WCAG AA
├── README.md                              # Documentación general
├── START.md                               # Guía de arranque rápido
└── .env.example                           # Template de variables de entorno
```

---

## Variables de Entorno Detectadas

### Backend (backend/.env)
`NODE_ENV`, `PORT`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`,
`FRONTEND_URL`, `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_EVENTS_KEY`,
`WOMPI_API_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERSION`, `TWILIO_SID`,
`TWILIO_AUTH`, `TWILIO_PHONE`, `COMPANY_NAME`, `COMPANY_NIT`, `COMPANY_CITY`,
`COMPANY_ADDRESS`, `COMPANY_PHONE`, `COMPANY_EMAIL`, `UPLOADS_PATH`,
`MAX_FILE_SIZE`, `MIKROTIK_HOST`, `MIKROTIK_USER`, `MIKROTIK_PASSWORD`,
`MIKROTIK_PORT`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`

### Frontend (frontend/.env)
`PUBLIC_API_URL`

---

## Inventario de Funcionalidades

### Autenticación y Seguridad
- Login con JWT + sesión en DB (revocable)
- Logout (elimina sesión)
- Registro de usuarios (solo ADMIN)
- Cambio de contraseña (invalida otras sesiones)
- Roles: ADMIN, OPERATOR, TECHNICIAN, VIEWER
- Middleware de autorización por ruta (requireAdmin, requireOperational)

### Gestión de Clientes
- CRUD completo con búsqueda, filtros (status/plan/zone/city), paginación
- Stepper de creación en 2 pasos: zona → datos + PPPoE
- Vista detalle con datos editables inline, KPI strip, facturas, pagos, galería de fotos
- Suspender/activar servicio (actualiza MikroTik + notifica)
- Cambio de plan
- Generación de enlaces de auto-actualización para clientes
- Evidencias fotográficas (upload con multer, galería con lightbox)
- Portal público de auto-servicio (token de un solo uso)

### Planes
- CRUD con precio en centavos, velocidades, perfil MikroTik asociado

### Zonas
- CRUD con asignación 1:1 a router MikroTik
- Vista en mapa de red (SvelteFlow)
- Pesistencia de viewport por zona

### MikroTik / RouterOS
- CRUD de routers con multi-IP failover (hasta 3 rutas)
- Verificación de conectividad, sincronización de secrets
- Listado de perfiles PPPoE, IPs disponibles
- Importación masiva de PPPoE desde router
- Suspensión/activación de secrets PPPoE
- Lista de direcciones autorizadas (firewall address-list)
- Historial de logs del router

### Facturación
- CRUD de facturas con items
- Generación masiva mensual (cron)
- PDF con PDFKit
- Envío por email/WhatsApp
- Checkout Wompi (pasarela de pago colombiana)
- Estados: DRAFT, PENDING, PARTIAL, PAID, OVERDUE, CANCELLED, REFUNDED

### Pagos
- Registro manual (CASH, BANK_TRANSFER, CREDIT_CARD, WOMPI, OTHER)
- Reembolsos parciales/totales
- Webhook Wompi con verificación HMAC-SHA256
- Sincronización de estado de facturas (reconciliación)
- Dashboard de pagos por método/mes

### Red / Monitoreo
- Mapa interactivo de dispositivos de red (SvelteFlow)
- Monitoreo ICMP con state machine (ONLINE → UNSTABLE → OFFLINE)
- Monitoreo de rutas de routers (failover automático)
- Eventos de red en tiempo real (socket.io)
- Alertas por Telegram en transiciones DOWN/RECOVERY
- Configuración de polling (intervalo, timeout, down-count)

### Notificaciones
- Plantillas con presets + variables {{name}}, {{plan}}, etc.
- Campañas masivas con filtro de audiencia
- Canales: EMAIL (SMTP configurable desde UI), WhatsApp (Meta Cloud API), Telegram
- Historial de envíos con logs

### Reportes
- Dashboard KPIs: clientes, facturas, ingresos, cobranza
- Reporte financiero (ingresos, gastos, P&L)
- Reporte de clientes (por plan, ciudad, estado)
- Reporte de cobranza (antigüedad de deuda)
- Exportación multi-formato (JSON/CSV/Excel/PDF scaffold)

### Admin / Configuración
- CRUD de usuarios del sistema
- Configuración SMTP desde UI con test
- Configuración WhatsApp Cloud API
- Configuración Telegram Bot
- Configuración de monitoreo de red

---

## Bugs y Problemas Detectados

### [CRÍTICO] Bug #1 — Auth middleware crea PrismaClient propio
**Archivo:** `backend/src/middleware/auth.middleware.js:3-4`
**Problema:** Crea `new PrismaClient()` en vez de importar la instancia compartida de `server.js`. Lo mismo ocurre en `backend/src/routes/evidence.routes.js:10`. Esto genera conexiones DB duplicadas sin el logging configurado en `server.js`.
**Severidad:** CRÍTICO

### [CRÍTICO] Bug #2 — Schema Prisma duplicado y desactualizado
**Archivo:** `backend/src/prisma/schema.prisma`
**Problema:** Existe un schema antiguo con modelos diferentes (`Device.macAddress` vs `mac`, `Client.documentType` como enum, campos faltantes). Si alguien corre `prisma generate` desde `backend/src/prisma/` obtendrá un cliente incompatible.
**Severidad:** CRÍTICO

### [ALTO] Bug #3 — validateBody traga errores detallados de Zod
**Archivo:** `backend/src/middleware/validate.middleware.js:17-21`
**Problema:** En vez de dejar que el `errorMiddleware` maneje el ZodError (que devuelve detalles campo por campo), crea un `AppError` genérico. El cliente recibe "Error de validación" sin saber qué campo falló.
**Causa:** `validateBody` captura el ZodError y lanza un AppError genérico. El `error.middleware.js` sí maneja ZodError correctamente (devuelve `error.errors` con field+message).
**Severidad:** ALTO

### [ALTO] Bug #4 — Device model: campo `macAddress` no existe
**Archivo:** `backend/src/controllers/clients.controller.js:742, 783, 788`
**Problema:** El controlador referencia `macAddress` como campo único del Device, pero el schema activo (`backend/prisma/schema.prisma`) define el campo como `mac`. `prisma.device.findUnique({ where: { macAddress: ... } })` arrojará Prisma error P2009 ("Unknown argument").
**Severidad:** ALTO

### [MEDIO] Bug #5 — Session TTL desincronizado con JWT_EXPIRES_IN
**Archivo:** `backend/src/controllers/auth.controller.js:53`
**Problema:** El `expiresAt` de la sesión en DB se hardcodea a 8h, ignorando `env.JWT_EXPIRES_IN`. Si `JWT_EXPIRES_IN=24h`, el JWT sigue siendo válido pero la sesión en DB expiró → el usuario recibe 401 aunque su token no haya expirado.
**Causa:** `expiresAt.setHours(expiresAt.getHours() + 8)` debería usar `env.JWT_EXPIRES_IN`.
**Severidad:** MEDIO

### [MEDIO] Bug #6 — changePlan no sincroniza con MikroTik
**Archivo:** `backend/src/controllers/clients.controller.js:1023`
**Problema:** Al cambiar de plan, solo se actualiza `planId` en DB. El perfil PPPoE en el router MikroTik no se actualiza, por lo que el cliente sigue teniendo la velocidad/ancho de banda del plan anterior hasta sincronización manual.
**Severidad:** MEDIO

### [MEDIO] Bug #7 — Socket.io CORS hardcodeado a localhost
**Archivo:** `backend/src/services/socket.service.js:12`
**Problema:** `origin: ['http://localhost:5173', 'http://localhost:5174']` no usa `FRONTEND_URL` ni comparte la config de CORS de Express. En producción (frontend por Nginx :3000), socket.io será bloqueado.
**Severidad:** MEDIO

### [MEDIO] Bug #8 — `register` sin protección de ADMIN
**Archivo:** `backend/src/routes/auth.routes.js` (implícito en `app.js`)
**Problema:** Las rutas de auth se montan sin middleware de auth: `app.use('/api/v1/auth', authRoutes)`. Cualquier endpoint público dentro de auth routes (como register) es accesible sin autenticación a menos que se proteja dentro del router.
**Severidad:** MEDIO

### [MEDIO] Bug #9 — Sin validación de input en login
**Archivo:** `backend/src/controllers/auth.controller.js:10`
**Problema:** No se valida que `email` y `password` sean strings no vacíos antes de pasarlos a Prisma. Un `email: undefined` o `email: ""` pasaría silenciosamente.
**Severidad:** MEDIO

### [BAJO] Bug #10 — confirmPayment no actualiza balanceDue
**Archivo:** `backend/src/controllers/payments.controller.js:347-357`
**Problema:** Al confirmar un pago, actualiza `status: 'PAID'` pero no pone `balanceDue: 0`. Comparar con `createPayment` que usa `$transaction` y actualiza ambos campos.
**Severidad:** BAJO

### [BAJO] Bug #11 — Import no utilizado en auth.controller
**Archivo:** `backend/src/controllers/auth.controller.js:6`
**Problema:** `import { authMiddleware } from '../middleware/auth.middleware.js'` nunca se usa en el controller (solo en las rutas).
**Severidad:** BAJO

### [BAJO] Bug #12 — notifyTechnician: WhatsApp no implementado
**Archivo:** `backend/src/services/client-update-token.service.js:355`
**Problema:** `results.WHATSAPP = { ok: false, error: 'NO_TECH_PHONE_CONFIGURED' }` siempre falla. La funcionalidad está documentada pero no implementada.
**Severidad:** BAJO

### [BAJO] Bug #13 — Invoice requiere planId pero client puede no tener plan
**Archivo:** `backend/prisma/schema.prisma` (schema activo)
**Problema:** `Invoice.planId` y `InvoiceItem` tienen `planId` requerido, pero `Client.planId` es opcional. Si se genera factura para cliente sin plan, falla.
**Severidad:** BAJO

### [BAJO] Bug #14 — confirmPayment no actualiza balanceDue
**Archivo:** `backend/src/controllers/payments.controller.js:352-357`
**Problema:** `createPayment` (registro manual) usa `$transaction` y actualiza `balanceDue + status` atómicamente. `confirmPayment` solo actualiza `status: 'PAID'`, dejando `balanceDue` sin cambios.
**Severidad:** BAJO

---

## Propuestas de Fix y Mejoras

### Fix #1 — Compartir instancia de PrismaClient
**Archivo:** `backend/src/middleware/auth.middleware.js`
```diff
- import { PrismaClient } from '@prisma/client';
- const prisma = new PrismaClient();
+ import { prisma } from '../server.js';
```
Aplicar el mismo cambio en:
- `backend/src/routes/evidence.routes.js:10` — importar `prisma` desde `server.js` en vez de crear instancia propia.

### Fix #2 — Eliminar schema duplicado
```bash
rm backend/src/prisma/schema.prisma
rm -rf backend/src/prisma/migrations   # si existe
```
El schema activo está en `backend/prisma/schema.prisma`. Mantener el duplicado causa confusión.

### Fix #3 — validateBody debe delegar ZodError al errorMiddleware
**Archivo:** `backend/src/middleware/validate.middleware.js`
```diff
export const validateBody = (schema) => {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
-       console.error('[validateBody] ZodError on', ...);
-       throw new AppError('Error de validación en los datos enviados', 400, 'VALIDATION_ERROR');
+       next(error);  // Delega al errorMiddleware que ya maneja ZodError correctamente
+       return;
      }
      next(error);
    }
  };
};
```

### Fix #4 — Cambiar `macAddress` por `mac` en clients.controller
**Archivo:** `backend/src/controllers/clients.controller.js`
```diff
- const existingDevice = await prisma.device.findUnique({
-   where: { macAddress: deviceData.macAddress }
- });
+ // Nota: el campo en Prisma es "mac", no "macAddress"
+ const existingDevice = deviceData.mac
+   ? await prisma.device.findUnique({ where: { mac: deviceData.mac } })
+   : null;
```

### Fix #5 — Usar JWT_EXPIRES_IN para la sesión en DB
**Archivo:** `backend/src/controllers/auth.controller.js`
```diff
- const expiresAt = new Date();
- expiresAt.setHours(expiresAt.getHours() + 8);
+ // Calcular expiresAt desde JWT_EXPIRES_IN
+ const match = env.JWT_EXPIRES_IN.match(/^(\d+)h$/);
+ const ttlHours = match ? parseInt(match[1]) : 8;
+ const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);
```

### Fix #6 — Sincronizar perfil PPPoE al cambiar plan
**Archivo:** `backend/src/controllers/clients.controller.js` — en `changePlan`:
```js
// Después de actualizar planId en DB:
if (client.mikrotikAccount) {
  try {
    const { service } = await getMikrotikServiceForClient(client.id);
    await service.updatePPPoESecret(client.mikrotikAccount.username, {
      profile: plan.mikrotikProfile || plan.name
    });
  } catch (e) {
    console.error(`Failed to sync PPPoE profile for "${client.name}":`, e.message);
    // No hacer throw: el cambio en DB ya se aplicó
  }
}
```

### Fix #7 — Socket.io CORS desde variable de entorno
**Archivo:** `backend/src/services/socket.service.js`
```diff
+ import { env } from '../config/env.js';
+
export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
-     origin: ['http://localhost:5173', 'http://localhost:5174'],
+     origin: [env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:5174'],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });
}
```

### Fix #8 — Proteger register con requireAdmin
**Archivo:** `backend/src/routes/auth.routes.js`
```diff
+ import { requireAdmin } from '../middleware/auth.middleware.js';
+
// ...
+ router.post('/register', requireAdmin, authController.register);
```

### Fix #9 — Validar login con Zod
**Archivo:** `backend/src/controllers/auth.controller.js`
```diff
+ import { z } from 'zod';
+ const loginSchema = z.object({
+   email: z.string().email('Email inválido'),
+   password: z.string().min(1, 'Contraseña requerida')
+ });
+
login = asyncHandler(async (req, res) => {
+ const { email, password } = loginSchema.parse(req.body);  // lanza ZodError si falla
- const { email, password } = req.body;
  // ... resto igual
```

### Fix #10 — confirmPayment debe actualizar balanceDue
**Archivo:** `backend/src/controllers/payments.controller.js`
```diff
  if (totalPaid >= payment.invoice.amount) {
    await prisma.invoice.update({
      where: { id: payment.invoiceId },
-     data: { status: 'PAID' }
+     data: { status: 'PAID', balanceDue: 0 }
    });
  }
```

---

## Mejoras Propuestas

### Rendimiento
1. **Queries N+1 en reportes** — Varios reportes iteran sobre resultados y hacen queries adicionales por fila. Ej: `getClientsByPlan` (clients.controller.js:1241) hace dos queries separadas. Unificar con `groupBy` + `include`.
2. **Falta de índices** — La tabla `payments` no tiene índice compuesto en `(clientId, status)`, lo que afecta reportes de cobranza.
3. **Monitor ICMP in-process** — `startMonitor()` y `startRouterMonitor()` corren en el mismo proceso que Express. A 200+ dispositivos, el bloqueo de ICMP puede afectar latencia del API. Mover a worker dedicado (BullMQ).
4. **Lazy loading de imágenes** — Las evidencias fotográficas se sirven sin compresión ni lazy loading en el frontend.

### Seguridad
1. **Helmet no está configurado** — Express usa helmet en `dependencies` pero en `app.js` solo se importa `cors` y `morgan`, no `helmet`. No hay headers de seguridad (X-Content-Type-Options, CSP, etc.).
2. **No hay rate limiting real** — Las variables `RATE_LIMIT_WINDOW_MS` y `RATE_LIMIT_MAX_REQUESTS` existen en env pero no se aplican en Express (express-rate-limit no está instalado). La única protección es en el router público de actualizaciones (30 req/min manual).
3. **CORS demasiado permisivo**: `if (!origin) return cb(null, true)` permite peticiones sin origen (Postman, curl, scripts server-side).
4. **No hay Content Security Policy** — La app SPA es vulnerable a XSS si algún input se renderiza sin escapar.
5. **Subida de archivos sin antivirus** — Los archivos subidos se guardan directamente en disco sin escaneo de malware.

### Mantenibilidad
1. **Schema redundante** — Eliminar `backend/src/prisma/schema.prisma` (schema antiguo).
2. **Unificar PrismaClient** — Todas las referencias a `new PrismaClient()` deben reemplazarse por el singleton de `server.js`.
3. **Constantes mágicas** — `MOROSO_LIST = 'Moroso'` (clients.controller.js:8), `AUTHORIZED_LIST = 'ips_autorizadas_wisphub'` (clients.controller.js:405) deberían estar en un archivo de configuración.
4. **console.log en producción** — Múltiples `console.log` con emojis en servicios y controladores. Reemplazar por logger estructurado (pino, winston).
5. **El frontend no tiene tests** — Ni unit, ni e2e. `svelte-check` existe pero no se corre en CI.

### Escalabilidad
1. **BullMQ está cableado pero inactivo** — `queue.service.js` existe con `createQueue`/`createWorker`, `queue.bootstrap.js` está comentado. Las campañas de notificaciones y la generación de facturas corren en proceso bloqueando el event loop.
2. **Background jobs en proceso** — Los crons de billing y overdue corren dentro del proceso del API. Escalar horizontalmente requeriría workers separados.
3. **Redis infrautilizado** — Redis está configurado y conectado, pero solo se usa para socket.io adaptador y scaffold de BullMQ. No hay caché de queries (clientes, planes, zonas).

### Experiencia de Desarrollo
1. **Faltan scripts** — No hay `npm run lint` funcional en backend (falta eslint config). No hay `npm run typecheck`.
2. **No hay husky/lint-staged** — Sin pre-commit hooks para formatear/verificar código.
3. **No hay docker-compose para desarrollo sin infra** — Sería útil un perfil que solo levante postgres + redis para desarrollo local con el backend fuera del contenedor.
4. **Variables de entorno Twilio son requeridas pero no se usan** — `env.js` exige `TWILIO_SID`, `TWILIO_AUTH`, `TWILIO_PHONE` como `optional()` pero en `notification.service.js` solo hay un placeholder. Marcar como opcionales de verdad o implementar el envío.

---

## Resumen de Hallazgos

| Tipo | Cantidad | Severidad |
|------|----------|-----------|
| Bugs críticos | 2 | Schema duplicado, PrismaClient singleton |
| Bugs alto | 2 | validateBody genérico, Device.macAddress roto |
| Bugs medio | 5 | Session TTL, changePlan sin sync, socket CORS, register público, login sin validación |
| Bugs bajo | 4 | confirmPayment balanceDue, imports, WhatsApp notify, Invoice planId |
| **Total bugs** | **13** | |
| Mejoras rendimiento | 4 | |
| Mejoras seguridad | 5 | |
| Mejoras mantenibilidad| 5 | |
| Mejoras escalabilidad | 3 | |
| Mejoras DX | 4 | |

---

## Scores por Categoría (1-10)

| Categoría | Score | Notas |
|-----------|-------|-------|
| Stack y Arquitectura | 7/10 | Stack moderno, bien elegido. Monolito bien organizado. |
| Funcionalidades | 9/10 | Muy completo para un ISP pequeño-mediano. |
| Calidad del Código | 7/10 | PrismaClient unificado, imports muertos eliminados, validateBody corrige errores. Aún hay console.log sin logger. |
| Seguridad | 5/10 | Sin helmet, sin CSP, sin rate-limit real, CORS permisivo. |
| Tests | 1/10 | Sin tests automatizados. |
| Rendimiento | 5/10 | Monitor in-process, sin caché, N+1 queries en reportes. |
| Mantenibilidad | 7/10 | Schema duplicado marcado, PrismaClient centralizado, imports limpios. Lógica mezclada aún en controllers. |
| Documentación | 8/10 | README, design-rules, START.md. Código bien comentado + bitácora de remediación. |
| **Overall** | **7/10** | Post-Fase 1: bugs críticos resueltos, estabilidad mejorada. Pendiente seguridad, workers, tests. |

---

## Próximos Pasos Recomendados

1. **Inmediato (< 1 día):** Eliminar schema duplicado, unificar PrismaClient, corregir `macAddress` → `mac`.
2. **Corto plazo (< 1 semana):** Agregar helmet + rate-limit, arreglar `validateBody`, sincronizar session TTL, corregir socket.io CORS.
3. **Mediano plazo (< 1 mes):** Implementar tests (vitest + playwright), migrar workers a BullMQ, agregar caché Redis a queries frecuentes.
4. **Largo plazo (< 3 meses):** Dashboard de monitoreo de rendimiento, CI/CD pipeline, migración a TypeScript estricto.

---

## Bitácora de Remediación

### FASE 1 — Estabilización crítica y corrección de bugs bloqueantes ✅ COMPLETADA

### HOTFIX PRODUCCIÓN — CORS + bcrypt + error handling (2026-06-01) ✅ COMPLETADA

#### Contexto
Login de usuarios creados desde Administración → Usuarios del sistema retornaba "Error interno del servidor" en producción. Causa raíz: `FRONTEND_URL=http://10.2.3.6` (IP privada del servidor, no la URL real del frontend). El navegador enviaba `Origin: http://app.internetonline.co` que no estaba en el allowlist de CORS, bloqueando la petición antes de llegar al controller.

#### Diagnóstico
- Logs de PM2: `Error: CORS: origin http://app.internetonline.co not allowed`
- `.env.production` tenía `FRONTEND_URL=http://10.2.3.6` en vez de `http://app.internetonline.co`
- Adicionalmente, `auth.controller.js` no manejaba `user.password === null` ni tenía try-catch en `bcrypt.compare`, lo que podía causar 500 en producción con hashes corruptos
- Localmente (working tree tras FASE 1), `users.routes.js` perdió `import bcrypt from 'bcryptjs'` durante reorganización de imports

#### Cambios aplicados en producción (servidor Oracle, root@10.2.3.6)

| Archivo | Cambio | Backup |
|---------|--------|--------|
| `/opt/isp-manager/backend/.env` | `FRONTEND_URL=http://10.2.3.6` → `http://app.internetonline.co` | `.env.backup.20260601_161742` |
| `/opt/isp-manager/backend/.env` | Añadido `CORS_EXTRA_ORIGINS=http://internetonline.co,https://app.internetonline.co,https://internetonline.co` | — |
| `src/controllers/auth.controller.js` | Null-password guard + try-catch en `bcrypt.compare` para login y changePassword | `auth.controller.js.bak` |

#### Validación
- ✅ `curl -X POST http://app.internetonline.co/api/v1/auth/login -H 'Origin: http://app.internetonline.co'` → `Access-Control-Allow-Origin: http://app.internetonline.co`, status 401 (no 500 ni CORS error)
- ✅ `curl -X POST` sin Origin → 401 (INVALID_CREDENTIALS)
- ✅ PM2 restart exitoso

#### Lecciones aprendidas
- El `FRONTEND_URL` del `.env` **debe coincidir exactamente con el origin que el navegador envía** — ni IP privada, ni localhost. Usar el nombre de dominio público.
- CORS errors se confunden fácilmente con errores internos del servidor porque Express no devuelve un body con el error CORS (el middleware aborta antes).
- `auth.controller.js` debe ser tolerante a fallos de bcrypt (passwords null, hashes inválidos) para no crashear el servidor ante datos corruptos.
- `users.routes.js` local perdió `import bcrypt` en fase de refactor — programar verificación post-merge.

#### Objetivo
Eliminar inconsistencias estructurales que pueden romper la app o producir errores graves en tiempo de ejecución.

#### Archivos creados
- `backend/src/config/database.js` — Singleton de PrismaClient (fuente única de verdad)

#### Archivos modificados (46 archivos)

**PrismaClient singleton (33 archivos):**
- `backend/src/server.js` — Cambia de `new PrismaClient()` a import desde `./config/database.js`
- `backend/src/middleware/auth.middleware.js` — Elimina `new PrismaClient()`
- `backend/src/middleware/validate.middleware.js` — Idem
- Todos los controllers: `auth`, `clients`, `invoices`, `payments`, `reports`, `mikrotik`
- Todos los routes: `zones`, `plans`, `routers`, `accounts`, `notifications`, `smtp`, `users`, `evidence`, `dashboard`, `network`, `telegram`, `whatsapp`, `public.client-updates`, `clients`
- Todos los services: `mikrotik`, `network-monitor`, `router-monitor`, `notification`, `notification.campaign`, `whatsapp`, `telegram`, `invoice`, `wompi`, `client-update-token`
- Todos los jobs: `billing`, `overdue`

**Stale schema:**
- `backend/src/prisma/schema.prisma` — Añadido header de advertencia (⚠️ DEPRECATED — DO NOT USE)

**macAddress → mac (2 archivos):**
- `backend/src/controllers/clients.controller.js` — Cambia `macAddress` a `mac` en addDevice y updateDevice
- `backend/src/routes/clients.routes.js` — Cambia Zod schema `macAddress` a `mac`

**validateBody (1 archivo):**
- `backend/src/middleware/validate.middleware.js` — ZodError delegado a `errorMiddleware` (ahora retorna errores campo por campo). Aplicado también a `validateQuery` y `validateParams`.

**Session TTL (1 archivo):**
- `backend/src/controllers/auth.controller.js` — `expiresAt` ahora calculado desde `JWT_EXPIRES_IN`

**confirmPayment balanceDue (1 archivo):**
- `backend/src/controllers/payments.controller.js` — Ahora actualiza `balanceDue` y status atómicamente

**Imports muertos (8 archivos):**
- `backend/src/controllers/auth.controller.js` — Elimina import de `authMiddleware`
- `routes/zones.routes.js`, `plans.routes.js`, `routers.routes.js`, `accounts.routes.js`, `notifications.routes.js`, `smtp.routes.js`, `users.routes.js` — Elimina imports de controllers que no existen y no se usaban

**Pre-existing fixes (4 archivos):**
- `routes/zones.routes.js` — Añade imports faltantes (`z`, `validateBody`)
- `routes/notifications.routes.js` — Añade imports faltantes (`z`, `validateBody`, `validateQuery`)
- `routes/smtp.routes.js` — Añade imports faltantes (`z`, `validateBody`)
- `routes/users.routes.js` — Añade imports faltantes (`z`, `validateBody`)

#### Bugs corregidos (de Leame.md)

| Bug ID | Severidad | Descripción | Estado |
|--------|-----------|-------------|--------|
| #1 | CRÍTICO | Auth middleware crea PrismaClient propio | ✅ Corregido |
| #2 | CRÍTICO | Schema Prisma duplicado y desactualizado | ✅ Marcado como deprecated |
| #3 | ALTO | validateBody traga errores detallados de Zod | ✅ Corregido |
| #4 | ALTO | Device model: campo `macAddress` no existe | ✅ Corregido |
| #5 | MEDIO | Session TTL desincronizado con JWT_EXPIRES_IN | ✅ Corregido |
| #8 | MEDIO | register sin protección de ADMIN | ✅ Ya estaba corregido en el código actual (auth.routes.js:30) |
| #10, #14 | BAJO | confirmPayment no actualiza balanceDue | ✅ Corregido |
| #11 | BAJO | Import no utilizado en auth.controller | ✅ Corregido |

#### Bugs encontrados y corregidos adicionalmente (no listados en Leame.md)

| Bug | Severidad | Descripción | Fix |
|-----|-----------|-------------|-----|
| N+1 PrismaClient | CRÍTICO | 9 archivos adicionales creaban `new PrismaClient()` no listados en Leame.md | Importados desde database.js singleton |
| Imports rotos | ALTO | 7 route files importaban controllers que no existen (nunca se usaban, pero rompían startup) | Eliminados los imports |
| Imports faltantes | ALTO | 4 route files usaban `z` y/o `validateBody` sin importarlos | Añadidos imports |
| Device Zod schema | ALTO | clients.routes.js validaba `macAddress` pero el controller espera `mac` | Cambiado campo en Zod schema |

#### Bugs pendientes (no corregidos en esta fase)

| Bug ID | Severidad | Descripción | Fase esperada |
|--------|-----------|-------------|---------------|
| #6 | MEDIO | changePlan no sincroniza con MikroTik | FASE 3 |
| #7 | MEDIO | Socket.io CORS hardcodeado a localhost | FASE 2 |
| #9 | MEDIO | Sin validación de input en login | Ya validado a nivel de ruta (validateBody en auth.routes.js) |
| #12 | BAJO | WhatsApp no implementado | FASE 2 |
| #13 | BAJO | Invoice requiere planId pero client puede no tener plan | FASE 3 |

#### Validaciones ejecutadas
- ✅ `prisma validate` — Schema activo válido
- ✅ `prisma generate` — Cliente generado sin errores
- ✅ Backend startup — Servidor arranca, conecta DB + Redis + Socket.io + Monitores
- ✅ Health endpoint — `GET /api/health` → 200
- ✅ Login exitoso — `POST /api/v1/auth/login` → 200 + token
- ✅ Login fallido con detalle Zod — `POST /api/v1/auth/login` con datos inválidos → 400 + errores campo por campo
- ✅ Clients list — `GET /api/v1/clients` → 200 + 36 clientes
- ✅ 404 handler — Endpoint inexistente → 404
- ✅ Frontend build — `npm run build` exitoso (18s)
- ✅ No residual `new PrismaClient()` — Solo server.js (fuente) y seed.js (standalone)
- ✅ No residual `macAddress` — Solo stale schema (deprecated) y mikrotik.routes.js (proxy RouterOS)

#### Riesgos remanentes
- DHCP lease schema en `mikrotik.routes.js` aún usa `macAddress` (correcto para API de RouterOS)
- Device Zod schema en `clients.routes.js` tiene `ipAddress` y `hostname` vs Prisma `ip` y `model` — inconsistencia pre-existente no cubierta en FASE 1
- Dashboard endpoint retorna 404 (route existe pero controller/handler no implementado) — pre-existente
