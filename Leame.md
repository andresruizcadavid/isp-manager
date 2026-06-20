# ISP Manager — Documentación Técnica del Proyecto

> Generado automáticamente mediante auditoría de código.
> Última actualización: 2026-06-20 (Campañas: borradores/prueba/envío individual + buscador dinámico; doc de despliegue real PM2/Nginx)

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
| Pasarela de pago | Wompi — Links de Pago API | v1 |
| Procesos prod | PM2 | 7.0.1 |
| Infra | Docker + Docker Compose | Alpine-based |
| Proxy reverso | Nginx | Alpine-based / Ubuntu |

---

## Estructura del Proyecto

```
isp-manager/
├── backend/
│   ├── src/
│   │   ├── app.js                        # Express setup, CORS, 21+ routers montados
│   │   ├── server.js                     # Entry: Prisma, Redis, Socket.io, crons
│   │   ├── config/
│   │   │   ├── env.js                    # Zod schema de 30+ variables de entorno
│   │   │   └── database.js              # Singleton PrismaClient (fuente única)
│   │   ├── controllers/
│   │   │   ├── auth.controller.js        # login/register/logout/change-password
│   │   │   ├── clients.controller.js     # CRUD + suspend/activate/changePlan/tokens
│   │   │   ├── invoices.controller.js    # CRUD + bulkGenerate + PDF
│   │   │   ├── mikrotik.controller.js    # Proxy a RouterOS REST API
│   │   │   ├── payments.controller.js    # CRUD + refunds + webhook + sync
│   │   │   └── reports.controller.js     # Dashboard + financial + collection + export
│   │   ├── middleware/
│   │   │   ├── auth.middleware.js        # JWT verify + session DB lookup + roles
│   │   │   ├── client-auth.middleware.js # JWT verify para portal clientes (type: 'client')
│   │   │   ├── error.middleware.js       # AppError + Prisma/Zod/Multer handlers
│   │   │   ├── validate.middleware.js    # Zod body/query/params validators
│   │   │   ├── rateLimit.middleware.js   # Global rate limiter (express-rate-limit)
│   │   │   └── origin-guard.middleware.js # CSRF defense-in-depth por origin
│   │   ├── routes/ (21+ archivos)
│   │   │   ├── auth.routes.js            # Login, register, logout, profile, changePassword
│   │   │   ├── client-auth.routes.js     # Portal cliente: login, register-password, forgot/reset password, me
│   │   │   ├── portal.routes.js          # Portal cliente: dashboard, invoices, payments, profile, pay
│   │   │   ├── clients.routes.js         # CRUD + bulk + suspend/activate + changePlan
│   │   │   ├── invoices.routes.js        # CRUD + bulkGenerate + PDF + send
│   │   │   ├── payments.routes.js        # CRUD + refunds + webhook Wompi
│   │   │   ├── mikrotik.routes.js        # Proxy RouterOS: secrets, perfiles, IPs, firewall
│   │   │   ├── routers.routes.js         # CRUD + sync + import PPPoE
│   │   │   ├── network.routes.js         # Devices + connections + events
│   │   │   ├── notifications.routes.js   # Templates + campaigns (con paymentLinks) + history
│   │   │   ├── public.client-updates.routes.js  # Público: token GET/PUT/POST
│   │   │   ├── collection-windows.routes.js     # Ventanas de cobranza
│   │   │   ├── billing-cycles.routes.js         # Ciclos de facturación
│   │   │   ├── backups.routes.js                # Backups de router
│   │   │   └── ... (zones, plans, accounts, evidence, reports, dashboard, smtp, telegram, whatsapp, users)
│   │   ├── services/ (16+ archivos)
│   │   │   ├── wompi.service.js           # Links de Pago + webhook + reconciliation
│   │   │   ├── payment-link.service.js     # Creación individual/bulk de payment links
│   │   │   ├── client-auth.service.js      # Auth portal cliente: login, register, forgot/reset
│   │   │   ├── mikrotik.service.js         # RouterOS REST client + failover
│   │   │   ├── network-monitor.service.js  # ICMP sweep + state machine
│   │   │   ├── router-monitor.service.js   # ICMP per route + router status
│   │   │   ├── notification.service.js     # SMTP + WhatsApp + Telegram sends
│   │   │   ├── notification.campaign.service.js  # Audiencia + envío masivo + paymentLinks
│   │   │   ├── notification-orchestrator.service.js  # Dispatch multicanal transactional
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
│   │   │   ├── debtor-notification.job.js # Recordatorio de deuda (día 25–EOM)
│   │   │   ├── auto-collection.job.js     # Cobranza automática horaria
│   │   │   └── backup.job.js              # Backup de routers
│   │   └── prisma/ (NO USAR — deprecated)
│   │       └── schema.prisma              # ⚠️ SCHEMA ANTIGUO — no usar
│   ├── prisma/
│   │   ├── schema.prisma                  # Schema activo (38 modelos, 14+ enums)
│   │   ├── migrations/                    # 32 migraciones aplicadas
│   │   ├── seed.js                        # admin@demo.com / password123
│   │   └── init.sql
│   ├── scripts/                           # import-wisphub, scrape, analyze, seed-templates
│   ├── Dockerfile / Dockerfile.dev
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── +layout.svelte             # Root layout (Toaster, etc.)
│   │   │   ├── +page.svelte               # Home
│   │   │   ├── login/+page.svelte         # Admin login page
│   │   │   ├── (app)/                     # Rutas autenticadas admin (sidebar layout)
│   │   │   │   ├── dashboard/             # KPIs + charts
│   │   │   │   ├── clients/               # List + [id] detail + new (stepper)
│   │   │   │   ├── plans/                 # CRUD planes
│   │   │   │   ├── zones/                 # CRUD zonas
│   │   │   │   ├── invoices/              # List + PDF + send + collection-windows + billing-cycles
│   │   │   │   ├── payments/              # List + register
│   │   │   │   ├── mikrotik/              # Overview + routers + accounts
│   │   │   │   ├── network/               # Map + events + settings
│   │   │   │   ├── notifications/         # Campaigns + templates + history + configs
│   │   │   │   ├── reports/               # Multi-tab financial + clients + invoices
│   │   │   │   ├── users/                 # CRUD usuarios sistema
│   │   │   │   └── forbidden/             # 403 page
│   │   │   ├── portal/                    # Portal de Cliente (rutas literales)
│   │   │   │   ├── +layout.svelte         # Layout portal con auth guard + nav móvil
│   │   │   │   ├── login/+page.svelte     # Login portal cliente
│   │   │   │   ├── register-password/[token]/+page.svelte  # Primera vez
│   │   │   │   ├── forgot-password/+page.svelte
│   │   │   │   ├── dashboard/+page.svelte # Resumen: cards + facturas recientes
│   │   │   │   ├── invoices/+page.svelte  # Lista de facturas
│   │   │   │   ├── invoices/[id]/+page.svelte  # Detalle + pagar
│   │   │   │   ├── payments/+page.svelte  # Historial de pagos
│   │   │   │   └── profile/+page.svelte   # Datos personales, plan, estado
│   │   │   └── (public)/                  # Rutas públicas
│   │   │       └── update/[token]/        # Portal auto-servicio cliente
│   │   ├── lib/
│   │   │   ├── api/ (17 wrappers)         # clients, invoices, payments, portal, etc.
│   │   │   ├── stores/ (6 stores)         # auth, client-auth, socket, toast, ui, etc.
│   │   │   ├── components/
│   │   │   │   ├── layout/ (Header, Sidebar)
│   │   │   │   ├── payments/ (WompiButton — redirect-only)
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

## Variables de Entorno

### Backend (backend/.env)

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `NODE_ENV` | Sí | development / production / test |
| `PORT` | Sí | Puerto del servidor (3001) |
| `DATABASE_URL` | Sí | PostgreSQL connection string |
| `REDIS_URL` | Sí | Redis connection string |
| `JWT_SECRET` | Sí | Secreto JWT (≥32 chars) |
| `JWT_EXPIRES_IN` | No (default 8h) | TTL del token (formato: `8h`, `24h`) |
| `COOKIE_SECRET` | Sí | Secreto para cookies firmadas (≥32 chars) |
| `FRONTEND_URL` | Sí | URL exacta del frontend (para CORS y redirects). **Debe coincidir con el origin del navegador** |
| `CORS_EXTRA_ORIGINS` | No | Orígenes CORS adicionales (separados por coma) |
| `WOMPI_PUBLIC_KEY` | Sí | Llave pública Wompi (`pub_test_*` / `pub_prod_*`) |
| `WOMPI_PRIVATE_KEY` | Sí | Llave privada Wompi (`prv_test_*` / `prv_prod_*`)  |
| `WOMPI_EVENTS_KEY` | Sí | Events key para verificar webhooks (`evt_test_*` / `evt_prod_*`) |
| `WOMPI_API_URL` | No (default `https://api.wompi.co/v1`) | Base URL de la API de Wompi |
| `SMTP_HOST` | Sí | Servidor SMTP (ej: smtp.brevo.com) |
| `SMTP_PORT` | No (default 587) | Puerto SMTP |
| `SMTP_USER` | Sí | Usuario SMTP |
| `SMTP_PASS` | Sí | Contraseña SMTP |
| `COMPANY_*` | Sí | Datos de la empresa (nombre, NIT, ciudad, dirección, teléfono, email) |
| `UPLOADS_PATH` | No (default ./uploads) | Ruta para archivos subidos |
| `MAX_FILE_SIZE` | No (default 10485760) | Tamaño máximo de archivo (bytes) |
| `RATE_LIMIT_WINDOW_MS` | No (default 900000) | Ventana de rate limiting (ms) |
| `RATE_LIMIT_MAX_REQUESTS` | No (default 1000) | Máximo de requests por ventana |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | No | Credenciales WhatsApp Cloud API (bootstrap) |
| `TWILIO_*` | No | Credenciales Twilio (scaffold, no implementado) |
| `MIKROTIK_*` | No | Router MikroTik por defecto (opcional, la config per-router está en DB) |

### Frontend (frontend/.env)

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `PUBLIC_API_URL` | No (vacío en dev → Vite proxy) | URL base del API. Vacío = mismo origen (producción), o `http://localhost:3001` para standalone |

---

## Integración Wompi — Links de Pago

### Arquitectura General

Wompi es la **única pasarela de pago** del sistema. Se implementa mediante **Links de Pago** (Payment Links), NO mediante el Widget Checkout Web (deprecado por inestabilidad).

```
Frontend (SPA)                         Backend (Express)                  Wompi API
     │                                      │                                │
     │  POST /portal/invoices/:id/pay       │                                │
     │─────────────────────────────────────>│                                │
     │                                      │  POST /v1/payment_links        │
     │                                      │───────────────────────────────>│
     │                                      │     { data: { id: "xxx" } }   │
     │                                      │<───────────────────────────────│
     │  { checkoutUrl }                     │                                │
     │<─────────────────────────────────────│                                │
     │                                      │                                │
     │  Redirect a checkout URL             │                                │
     │──────────────────────────────────────┼───────────────────────────────>│
     │                                      │                                │
     │  (Cliente paga en checkout.wompi.co) │                                │
     │                                      │                                │
     │                                      │  POST /webhooks/wompi          │
     │                                      │  (transaction.updated)         │
     │                                      │<───────────────────────────────│
     │                                      │                                │
     │                                      │  • Verifica firma HMAC-SHA256  │
     │                                      │  • Busca PaymentAttempt por    │
     │                                      │    reference o payment_link_id │
     │                                      │  • Crea/actualiza Payment      │
     │                                      │  • Actualiza Invoice.status    │
     │                                      │                                │
```

### Endpoints Wompi Utilizados

| Endpoint | Método | Propósito |
|----------|--------|-----------|
| `/{env}/v1/payment_links` | `POST` | Crear link de pago |
| `/{env}/v1/payment_links/{id}` | `GET` | Consultar estado del link |

`{env}` = `sandbox.wompi.co` (desarrollo) o `api.wompi.co` (producción). Ver variable `WOMPI_API_URL`.

### Formato del Body (POST /v1/payment_links)

```json
{
  "name": "Pago factura INV-001",
  "description": "Factura servicio internet - INV-001",
  "single_use": true,
  "collect_shipping": false,
  "currency": "COP",
  "amount_in_cents": 6500000,
  "expires_at": "2026-07-09T00:00:00.000Z",
  "redirect_url": "https://app.internetonline.co/invoices/xxx?wompi_attempt=yyy"
}
```

**Notas importantes:**
- No se envía `reference`, `customer_data`, ni `signature` (esos campos no existen en el endpoint de payment_links)
- `amount_in_cents` es el **valor total en centavos**: $65,000 COP → 6500000
- `expires_at` en ISO 8601
- `redirect_url` es opcional; el cliente vuelve ahí después del pago
- La respuesta incluye `data.id` (ej: `test_DLG4nh`) → checkout URL = `https://checkout.wompi.co/l/{id}`

### Flujo de Pago Completo

#### 1. Creación del Payment Link

El servicio `wompi.service.js` (`createCheckout`) recibe un objeto `invoice`:

1. Genera un `reference` único por intento: `PL-{clientId[:6]}-{timestamp36}-{random4byteshex}`
2. Crea un `PaymentAttempt` en DB con estado `PENDING` (idempotencia + trazabilidad)
3. Llama a `POST /v1/payment_links` de Wompi
4. Actualiza `PaymentAttempt` con `checkoutUrl` y `externalId` (= wompiLinkId)
5. Retorna `{ checkoutUrl, paymentAttemptId, wompiLinkId }`

El servicio `payment-link.service.js` (`createForInvoice`) orquesta todo:
1. Verifica invoice (existe, no pagada)
2. Llama a `wompiService.createCheckout(invoice)`
3. Crea un `PaymentLink` en DB asociado a la invoice + cliente
4. Retorna el `PaymentLink` completo (incluye `checkoutUrl`)

#### 2. Pago del Cliente

- El frontend redirige al cliente a `https://checkout.wompi.co/l/{wompiLinkId}`
- Wompi maneja toda la UX de pago (tarjeta, PSE, Nequi, etc.)
- Wompi redirige al `redirect_url` después del pago (no es fuente de confirmación)

#### 3. Webhook — Confirmación del Pago

Wompi envía un evento `transaction.updated` a `POST /api/v1/payments/webhooks/wompi`.

El handler `handleTransactionUpdate` en `wompi.service.js`:

1. **Verifica firma**: HMAC-SHA256 con `WOMPI_EVENTS_KEY` sobre propiedades ordenadas del transaction + timestamp
2. **Resuelve la factura** por dos estrategias:
   - **Por reference**: extrae el `invoiceNumber` del reference (`INV-001-{ts}-{rand}` → `INV-001`)
   - **Por payment_link_id**: busca `PaymentAttempt.externalId` igual al `payment_link_id` del webhook
3. **Actualiza PaymentAttempt**: marca como APPROVED/DECLINED/ERROR según corresponda
4. **Idempotencia**: busca `Payment` por `transactionId` (UNIQUE en schema). Si existe, actualiza estado; si no, crea registro nuevo
5. **Crea pago**: `Payment` con método `WOMPI`, monto, status `COMPLETED`, reference del webhook
6. **Actualiza factura**: `updateInvoiceStatus` → suma pagos, si totalPagado >= total → status = `PAID`, balanceDue = 0

### Modelos de Datos Relacionados

```prisma
model PaymentAttempt {
  id              String   @id @default(cuid())
  invoiceId       String
  clientId        String
  reference       String   @unique  // PL-{clientId}-{ts}-{rand}
  amount          Int               // en centavos
  currency        String   @default("COP")
  status          String   @default("PENDING") // PENDING | APPROVED | DECLINED | ERROR | FAILED
  checkoutUrl     String?           // URL de checkout de Wompi
  externalId      String?           // wompiLinkId (para matching por payment_link_id)
  webhookPayload  Json?
  expiresAt       DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model PaymentLink {
  id              String   @id @default(cuid())
  clientId        String
  invoiceId       String
  reference       String   @unique
  amountInCents   Int
  currency        String   @default("COP")
  checkoutUrl     String
  wompiLinkId     String?
  status          String   @default("pending") // pending | active | expired | used
  expiresAt       DateTime?
  paymentAttemptId String?
  sentAt          DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### Payment Links en Campañas de Notificación

El campo `generatePaymentLinks` en `NotificationCampaign` permite que al ejecutar una campaña:

1. Por cada cliente en la audiencia, se identifica la **factura pendiente más antigua**
2. Se genera un payment link único via `createForInvoice`
3. El link se inyecta en la variable `{{paymentLink}}` del template
4. El cliente recibe el mensaje con el enlace de pago personalizado

**Uso en la plantilla:**
```
Hola {{name}}, tienes un saldo pendiente de {{amount}} con vencimiento {{dueDate}}.
Paga aquí: {{paymentLink}}
```

**Creación de campaña con links:**
```json
POST /api/v1/notifications/campaigns
{
  "name": "Cobro masivo marzo",
  "templateId": "tpl_xxx",
  "channel": "EMAIL",
  "generatePaymentLinks": true,
  "audience": { "overdue": true }
}
```

### Manejo de Errores

| Error | Causa | Acción del sistema |
|-------|-------|-------------------|
| `INVALID_ACCESS_TOKEN` | WOMPI_PRIVATE_KEY incorrecta o entorno (sandbox vs prod) no coincide | PaymentAttempt → FAILED. Se loguea el error |
| `INPUT_VALIDATION_ERROR` | Body mal formado (falta `description`, `amount_in_cents` inválido, etc.) | PaymentAttempt → FAILED. Se loguea el error |
| Webhook con firma inválida | Events key incorrecta o request malicioso | Se rechaza con 401 |
| Webhook sin factura | reference no matchea ninguna factura ni payment_link_id | Se loguea warning, se ignora |
| Timeout de API | Wompi no responde en tiempo razonable | PaymentAttempt → FAILED. Se puede reintentar |

### Configuración por Entorno

| Variable | Sandbox (dev) | Producción |
|----------|--------------|------------|
| `WOMPI_API_URL` | `https://sandbox.wompi.co/v1` | `https://api.wompi.co/v1` |
| `WOMPI_PUBLIC_KEY` | `pub_test_*` | `pub_prod_*` |
| `WOMPI_PRIVATE_KEY` | `prv_test_*` | `prv_prod_*` |
| `WOMPI_EVENTS_KEY` | `evt_test_*` | `evt_prod_*` |

**Importante:** Las llaves de sandbox y producción NO son intercambiables. Usar `pub_test_*` contra `api.wompi.co/v1` (o viceversa) retorna `INVALID_ACCESS_TOKEN`.

### Webhooks en Wompi

Para que Wompi envíe webhooks al sistema, debes registrar la URL en el dashboard de Wompi:

- **Sandbox:** https://sandbox.wompi.co > Configuración > Webhooks
- **Producción:** https://wompi.co > Configuración > Webhooks

**URL a registrar:** `https://app.internetonline.co/api/v1/payments/webhooks/wompi`

**Eventos a suscribir:** `transaction.updated`

**Verificación de firma:** El webhook incluye un header `x-signature` que se verifica con `WOMPI_EVENTS_KEY` usando HMAC-SHA256. El algoritmo concatenan las propiedades en orden alfabético + timestamp + events key, aplica SHA256, y compara en tiempo constante.

---

## Portal de Cliente

### Arquitectura

El portal de cliente es una sección independiente dentro del mismo SPA, bajo rutas literales `/portal/*`. Usa su propio sistema de autenticación:

- **Cookie:** `client_token` (separada de `token` de admin)
- **Middleware:** `client-auth.middleware.js` (verifica JWT con `type: 'client'` y busca `ClientSession`)
- **Alcance:** Solo datos del propio cliente (dashboard, facturas, pagos, perfil)

### Modelos

| Modelo | Propósito |
|--------|-----------|
| `ClientUser` | Usuario del portal (1:1 con `Client`, email único) |
| `ClientSession` | Sesión JWT (revocable, mismo patrón que `Session` de admin) |
| `ClientResetToken` | Token para registro inicial / reset de contraseña |

### Flujo de Registro

1. **Admin invita al cliente** → se crea `ClientUser` + `ClientResetToken` → se envía email con link
2. **Cliente recibe link** → `GET /portal/register-password/{token}`
3. **Cliente establece contraseña** → `POST /api/v1/client-auth/register-password` → se hashea con bcryptjs, se activa la cuenta
4. **Cliente inicia sesión** → `POST /api/v1/client-auth/login` → JWT firmado + cookie `client_token`

### Endpoints

| Ruta | Método | Auth | Descripción |
|------|--------|------|-------------|
| `/api/v1/client-auth/login` | POST | No | Login con email + password |
| `/api/v1/client-auth/register-password` | POST | No | Establecer contraseña (primer login) |
| `/api/v1/client-auth/forgot-password` | POST | No | Enviar email de recuperación |
| `/api/v1/client-auth/reset-password` | POST | No | Reset con token |
| `/api/v1/client-auth/logout` | POST | No | Cerrar sesión |
| `/api/v1/client-auth/me` | GET | Client | Perfil del cliente |
| `/api/v1/portal/dashboard` | GET | Client | Resumen: cards + facturas recientes |
| `/api/v1/portal/invoices` | GET | Client | Lista de facturas |
| `/api/v1/portal/invoices/:id` | GET | Client | Detalle de factura |
| `/api/v1/portal/invoices/:id/pay` | POST | Client | Generar link de pago |
| `/api/v1/portal/payments` | GET | Client | Historial de pagos |
| `/api/v1/portal/profile` | GET | Client | Datos personales + plan |

---

## Inventario de Funcionalidades

### Autenticación y Seguridad
- Login con JWT + sesión en DB (revocable) para admin y clientes
- Logout (elimina sesión)
- Registro de usuarios (solo ADMIN)
- Cambio de contraseña (invalida otras sesiones)
- Reset de contraseña (portal cliente: forgot-password + token)
- Roles: ADMIN, OPERATOR, TECHNICIAN, VIEWER
- Middleware de autorización por ruta (requireAdmin, requireOperational)
- CSRF defense-in-depth (origin-guard middleware para cookie-auth)
- Rate limiting global (express-rate-limit) + específico por ruta

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
- Plan gratis (isFree) para clientes sin facturación

### Zonas
- CRUD con asignación 1:1 a router MikroTik
- Vista en mapa de red (SvelteFlow)
- Persistencia de viewport por zona

### MikroTik / RouterOS
- CRUD de routers con multi-IP failover (hasta 3 rutas)
- Verificación de conectividad, sincronización de secrets
- Listado de perfiles PPPoE, IPs disponibles
- Importación masiva de PPPoE desde router
- Suspensión/activación de secrets PPPoE
- Lista de direcciones autorizadas (firewall address-list)
- Historial de logs del router
- Backups programados de configuración

### Facturación
- CRUD de facturas con items
- Generación masiva mensual (cron)
- PDF con PDFKit
- Envío por email/WhatsApp
- Ciclos de facturación configurables
- Ventanas de cobranza
- Estados: DRAFT, PENDING, PARTIAL, PAID, OVERDUE, CANCELLED, REFUNDED

### Pagos (Wompi Links de Pago)
- Creación de links de pago individuales y masivos
- Múltiples PaymentAttempt por factura (intentos trazables)
- Webhook Wompi con verificación HMAC-SHA256
- Reconciliación automática por reference o payment_link_id
- Idempotencia por transactionId
- Registro manual (CASH, BANK_TRANSFER, CREDIT_CARD, OTHER)
- Reembolsos parciales/totales
- Dashboard de pagos por método/mes

### Portal de Cliente
- Inicio de sesión con email + contraseña
- Registro de contraseña (primer acceso)
- Recuperación de contraseña
- Dashboard con resumen de cuenta (cards de estado, facturas pendientes, último pago)
- Lista y detalle de facturas con opción de pago
- Historial de pagos
- Perfil con datos personales, plan, dirección, estado del servicio

### Campañas de Notificación con Links de Pago
- Creación de campañas con generación automática de payment links
- Variable `{{paymentLink}}` en templates
- Variables disponibles: `{{name}}`, `{{email}}`, `{{phone}}`, `{{plan}}`, `{{zone}}`, `{{ip}}`, `{{balance}}`, `{{dueDate}}`, `{{amount}}`, `{{paymentLink}}`
- Canales: EMAIL (SMTP), WhatsApp (Meta Cloud API), ambos (BOTH)
- Filtros de audiencia: zona, plan, estado, solo morosos
- Vista previa de audiencia antes de enviar
- Historial de envíos con logs individuales
- Reintento de fallidos

### Red / Monitoreo
- Mapa interactivo de dispositivos de red (SvelteFlow)
- Monitoreo ICMP con state machine (ONLINE → UNSTABLE → OFFLINE)
- Monitoreo de rutas de routers (failover automático)
- Eventos de red en tiempo real (socket.io)
- Alertas por Telegram en transiciones DOWN/RECOVERY
- Configuración de polling (intervalo, timeout, down-count)

### Notificaciones
- Plantillas con presets + variables
- Campañas masivas con filtro de audiencia + payment links
- Canales: EMAIL (SMTP configurable desde UI), WhatsApp (Meta Cloud API), Telegram
- Notificaciones transaccionales automáticas (factura creada, pago recibido, servicio suspendido)
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

### [CRÍTICO] Bug #2 — Schema Prisma duplicado y desactualizado
**Archivo:** `backend/src/prisma/schema.prisma`
**Problema:** Existe un schema antiguo. Si alguien corre `prisma generate` desde esa ruta obtendrá un cliente incompatible. Ya marcado como deprecated.

### [ALTO] Bug #6 — changePlan no sincroniza con MikroTik
**Archivo:** `backend/src/controllers/clients.controller.js`
**Problema:** Al cambiar de plan, solo se actualiza `planId` en DB. El perfil PPPoE en el router MikroTik no se actualiza.

### [MEDIO] Bug #7 — Socket.io CORS hardcodeado a localhost
**Archivo:** `backend/src/services/socket.service.js:12`
**Problema:** `origin: ['http://localhost:5173', 'http://localhost:5174']` no usa `FRONTEND_URL` ni comparte la config de CORS de Express.

### [MEDIO] Bug #12 — notifyTechnician: WhatsApp no implementado
**Archivo:** `backend/src/services/client-update-token.service.js:355`
**Problema:** La funcionalidad está documentada pero no implementada — siempre retorna error.

### [BAJO] Bug #13 — Invoice requiere planId pero client puede no tener plan
**Archivo:** `backend/prisma/schema.prisma`
**Problema:** `Invoice.planId` y `InvoiceItem` tienen `planId` requerido, pero `Client.planId` es opcional.

### Bugs Corregidos (de fases anteriores)

| Bug ID | Severidad | Descripción | Estado |
|--------|-----------|-------------|--------|
| #1 | CRÍTICO | Auth middleware crea PrismaClient propio | ✅ Corregido (database.js singleton) |
| #3 | ALTO | validateBody traga errores detallados de Zod | ✅ Corregido |
| #4 | ALTO | Device model: campo `macAddress` no existe | ✅ Corregido |
| #5 | MEDIO | Session TTL desincronizado con JWT_EXPIRES_IN | ✅ Corregido |
| #8 | MEDIO | register sin protección de ADMIN | ✅ Ya corregido |
| #9 | MEDIO | Sin validación de input en login | ✅ Validado a nivel de ruta |
| #10 | BAJO | confirmPayment no actualiza balanceDue | ✅ Corregido |
| #11 | BAJO | Import no utilizado en auth.controller | ✅ Corregido |
| #14 | BAJO | confirmPayment duplicado | ✅ Corregido |
| — | CRÍTICO | bcrypt no instalado en producción (502 backend) | ✅ Corregido (cambiado a bcryptjs) |
| — | ALTO | schema.prisma sin modelos de portal (502 client-auth) | ✅ Corregido (schema sincronizado) |

---

## Mejoras Propuestas

### Rendimiento
1. **Queries N+1 en reportes** — Varios reportes iteran sobre resultados y hacen queries adicionales. Unificar con `groupBy` + `include`.
2. **Falta de índices** — La tabla `payments` no tiene índice compuesto en `(clientId, status)`.
3. **Monitor ICMP in-process** — `startMonitor()` corre en el mismo proceso. A 200+ dispositivos puede afectar latencia.
4. **Lazy loading de imágenes** — Las evidencias fotográficas se sirven sin compresión ni lazy loading.

### Seguridad
1. **Helmet no está completamente configurado** — No hay CSP, X-Frame-Options, etc.
2. **No hay rate limiting granular** — Solo existe el global y el específico de client-updates.
3. **CORS demasiado permisivo**: `if (!origin) return cb(null, true)` permite peticiones sin origen.
4. **Subida de archivos sin antivirus** — Los archivos subidos se guardan directamente en disco.

### Mantenibilidad
1. **Schema redundante** — Eliminar `backend/src/prisma/schema.prisma`.
2. **Constantes mágicas** — `MOROSO_LIST = 'Moroso'`, `AUTHORIZED_LIST = 'ips_autorizadas_wisphub'` deberían ir en configuración.
3. **console.log en producción** — Reemplazar por logger estructurado (pino, winston).
4. **El frontend no tiene tests** — Ni unit, ni e2e.

### Escalabilidad
1. **BullMQ está cableado pero inactivo** — Campañas y generación de facturas corren en proceso.
2. **Background jobs en proceso** — Crons de billing y overdue dentro del proceso del API.
3. **Redis infrautilizado** — Solo socket.io adaptador. No hay caché de queries.

---

## Scores por Categoría (1-10)

| Categoría | Score | Notas |
|-----------|-------|-------|
| Stack y Arquitectura | 7/10 | Stack moderno. Monolito bien organizado. |
| Funcionalidades | 9/10 | Muy completo. Portal cliente + Links de Pago integrados. |
| Calidad del Código | 7/10 | PrismaClient unificado, imports limpios. Pendiente logger. |
| Seguridad | 5/10 | Sin helmet completo, sin CSP, rate-limit básico. |
| Tests | 1/10 | Sin tests automatizados. |
| Rendimiento | 5/10 | Monitor in-process, sin caché, N+1 queries en reportes. |
| Mantenibilidad | 7/10 | Schema duplicado marcado, PrismaClient centralizado. |
| Documentación | 8/10 | README, design-rules, START.md, Leame.md actualizado. |
| **Overall** | **7/10** | Portal + Wompi integrados y en producción. Pendiente seguridad, workers, tests. |

---

## Despliegue en Producción

### Servidores

| Rol | IP | Servicios |
|-----|-----|-----------|
| Backend + DB + Redis | `10.2.3.6` | PM2 (isp-api), PostgreSQL, Redis |
| Proxy reverso | `157.151.224.139` | Nginx → `app.internetonline.co` |

### Comandos Útiles

```bash
# SSH al servidor
ssh root@10.2.3.6

# Ver estado del backend
pm2 status
pm2 logs --lines 50

# Reiniciar
pm2 restart all

# Aplicar migración Prisma
cd /opt/isp-manager/backend
npx prisma migrate deploy
npx prisma generate
pm2 restart all

# Verificar health
curl http://localhost:3001/api/health

# Nginx
nginx -t
systemctl reload nginx
tail -n 100 /var/log/nginx/error.log
```

### Cómo corre producción (importante)

- **No usa Docker.** Aunque el repo tiene `docker-compose.yml`, en producción NO se usa
  (no hay `docker` instalado en `10.2.3.6`). El stack real es:
  - **Backend:** PM2, proceso `isp-api` = `node /opt/isp-manager/backend/src/server.js` (puerto 3001).
  - **Frontend:** **Nginx del host** sirve el build estático desde `/opt/isp-manager/frontend/build`
    y hace proxy de `/api` → `127.0.0.1:3001`. `server_name app.internetonline.co`.
  - **PostgreSQL** y **Redis** locales en `127.0.0.1`.
- **Ruta del proyecto:** `/opt/isp-manager`.
- **Acceso:** `ssh root@10.2.3.6` (llave SSH; evitar contraseña en texto).
- ⚠️ Históricamente se desplegó por **rsync de archivos sueltos** (abajo), por eso el working
  tree de git en el server suele estar **sucio** (muchos archivos sin commitear). Si vas a
  desplegar por git, primero `git stash -u` esos cambios (recuperable) — ver deploy git-based.

### Backups (hacer SIEMPRE antes de un deploy con migraciones)

```bash
ssh root@10.2.3.6 'bash -lc "
TS=$(date +%Y%m%d-%H%M%S); BK=/root/isp-backups/$TS; mkdir -p $BK
DBURL=$(grep -E ^DATABASE_URL= /opt/isp-manager/backend/.env | cut -d= -f2- | tr -d \"\\\"\")
pg_dump \"$DBURL\" > $BK/db.sql                                   # base de datos
tar czf $BK/source.tgz --exclude node_modules --exclude .git -C /opt isp-manager  # código actual
tar czf $BK/build.tgz -C /opt/isp-manager/frontend build         # frontend servido hoy
ls -lh $BK"'
# Restaurar DB:   psql "$DBURL" < /root/isp-backups/<TS>/db.sql
# Restaurar build: tar xzf /root/isp-backups/<TS>/build.tgz -C /opt/isp-manager/frontend
```

### Despliegue git-based (recomendado — el usado el 2026-06-20)

```bash
ssh root@10.2.3.6
cd /opt/isp-manager
git config --global --add safe.directory /opt/isp-manager   # solo una vez
git stash push -u -m pre-deploy-$(date +%F)                 # guarda los cambios sucios (recuperable: git stash list/pop)
git fetch origin && git checkout <rama> && git pull --ff-only origin <rama>

# Backend
cd backend && npm install --no-audit --no-fund
npx prisma migrate status          # ver si hay migraciones pendientes
npx prisma migrate deploy          # aplica solo las pendientes (idempotente)
npx prisma generate

# Frontend (genera /opt/isp-manager/frontend/build que sirve nginx)
cd ../frontend && npm install --include=dev --no-audit --no-fund && npm run build

# Reiniciar backend (el frontend es estático, no requiere reinicio)
pm2 restart isp-api --update-env

# Verificar
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/api/health     # -> 200
pm2 status
```

### Despliegue por rsync de archivos sueltos (método legacy)

```bash
# Backend (un archivo)
rsync -avz --no-owner --no-group \
  backend/src/services/xxx.service.js \
  root@10.2.3.6:/opt/isp-manager/backend/src/services/xxx.service.js

# Frontend: hay que reconstruir EN el server tras copiar el fuente —
# nginx sirve frontend/build, no el código fuente.
ssh root@10.2.3.6 "cd /opt/isp-manager/frontend && npm install --include=dev && npm run build"

# Aplicar migración y reiniciar backend
ssh root@10.2.3.6 "cd /opt/isp-manager/backend && npx prisma migrate deploy && npx prisma generate && pm2 restart isp-api"
```
