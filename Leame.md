# ISP Manager — Documentación Técnica del Proyecto

> Generado mediante auditoría de código.
> Última actualización: 2026-07-03 (Planilla de clientes, Archivo de eliminados, Inventario de equipos, Auto-servicio con pago + contrato digital ON-F-01, link de pago manual, identidad de marca Internet Online, tipado svelte-check a 0)

---

## Stack Tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Frontend | SvelteKit (adapter-static, SPA) | ^1.27.4 |
| Frontend Runtime | Svelte | ^4.2.8 |
| Lenguaje frontend | TypeScript (svelte-check a 0 errores) | ^5.0.0 |
| Backend Runtime | Node.js | >=18, v20.20.2 en prod |
| Backend Framework | Express | ^4.18.2 |
| ORM | Prisma (Client + Migrate) | ^5.6.0 |
| Base de datos | PostgreSQL | 15 |
| Cache / Cola | Redis 7 + ioredis + BullMQ (scaffold) | ^5.3.2 / ^4.12.2 |
| Gestor paquetes | npm | 10.8.2 en prod |
| Build tool frontend | Vite | ^4.4.2 |
| Estilos | TailwindCSS + DaisyUI | ^3.4.19 / ^5.5.19 |
| Iconos | lucide-svelte | ^1.0.1 |
| Tablas | @tanstack/svelte-table | ^8.10.7 |
| Mapa de red | @xyflow/svelte (SvelteFlow) | ^0.1.39 |
| Gráficas | chart.js + svelte-chartjs | ^4.4.0 / ^3.1.5 |
| Toasts | svelte-sonner | ^0.3.24 |
| Excel (import/export planilla) | xlsx (SheetJS) | ^0.18.5 |
| Autenticación | JWT (jsonwebtoken) + bcryptjs + sesiones DB | ^9.0.2 / ^2.4.3 |
| Validación | Zod | ^3.22.4 |
| Tiempo real | socket.io + socket.io-client | ^4.8.3 |
| PDF | PDFKit | ^0.14.0 |
| Email | nodemailer | ^6.9.7 |
| RouterOS / MikroTik | node-routeros + ssh2 | ^1.6.9 / ^1.17.0 |
| ICMP / ping | ping | ^1.0.0 |
| Telegram | node-telegram-bot-api | ^0.67.0 |
| Seguridad HTTP | helmet | ^7.1.0 |
| Rate limiting | express-rate-limit | ^8.5.2 |
| Cron | node-cron + cron-parser | ^3.0.3 / ^5.5.0 |
| Pasarela de pago | Wompi — Links de Pago API | v1 |
| Procesos prod | PM2 | 7.0.1 |
| Proxy reverso | Nginx (host, sin Docker en prod) | Ubuntu |
| Infra (repo, no usada en prod) | Docker + Docker Compose | Alpine-based |

---

## Estructura del Proyecto

```
isp-manager/
├── backend/
│   ├── src/
│   │   ├── app.js                        # Express setup, CORS, origin-guard, 26 routers montados
│   │   ├── server.js                     # Entry: Prisma, Redis, Socket.io, crons
│   │   ├── config/
│   │   │   ├── env.js                    # Zod schema de 30+ variables de entorno
│   │   │   ├── database.js              # Singleton PrismaClient (fuente única)
│   │   │   ├── brand.js                 # Identidad "Internet Online" (colores, copy, contacto) — fuente única para emails+PDF
│   │   │   └── contract.js              # Acta de servicios ON-F-01 (texto + versión + hash SHA-256)
│   │   ├── controllers/                  # auth, clients, invoices, mikrotik, payments, reports, billing(-cycles), backups
│   │   ├── middleware/
│   │   │   ├── auth.middleware.js        # JWT verify + session DB lookup + roles
│   │   │   ├── client-auth.middleware.js # JWT verify para portal clientes (type: 'client')
│   │   │   ├── error.middleware.js       # AppError + Prisma/Zod/Multer handlers
│   │   │   ├── validate.middleware.js    # Zod body/query/params validators
│   │   │   ├── rateLimit.middleware.js   # Global rate limiter (express-rate-limit)
│   │   │   └── origin-guard.middleware.js # CSRF defense-in-depth por origin
│   │   ├── routes/ (26 archivos)
│   │   │   ├── auth.routes.js            # Login, register, logout, profile, changePassword
│   │   │   ├── client-auth.routes.js     # Portal cliente: login, register-password, forgot/reset, me
│   │   │   ├── portal.routes.js          # Portal cliente: dashboard, invoices, payments, profile, pay
│   │   │   ├── public.client-updates.routes.js # Público (token): GET datos+contrato / PUT actualizar+aceptar / POST pay / POST photos
│   │   │   ├── clients.routes.js          # CRUD + bulk + suspend/activate + changePlan + planilla + archive
│   │   │   ├── inventory.routes.js        # CRUD productos + items (equipos) + asignación a clientes
│   │   │   ├── evidence.routes.js         # Evidencias fotográficas por cliente
│   │   │   ├── invoices.routes.js         # CRUD + bulkGenerate + PDF + send + payment-link (manual) + reminders
│   │   │   ├── payments.routes.js         # CRUD + refunds + registro manual
│   │   │   ├── payment-links.routes.js    # Listado + attempts + conciliación + resend + pixel de apertura
│   │   │   ├── wompi-config.routes.js     # Config Wompi desde UI
│   │   │   ├── mikrotik.routes.js         # Proxy RouterOS: secrets, perfiles, IPs, firewall
│   │   │   ├── routers.routes.js          # CRUD routers + sync + import PPPoE (montado en /mikrotik/routers)
│   │   │   ├── accounts.routes.js         # MikrotikAccount (montado en /mikrotik/accounts)
│   │   │   ├── network.routes.js          # Devices + connections + events (mapa)
│   │   │   ├── notifications.routes.js    # Templates + campaigns (paymentLinks) + settings + history + diagnose
│   │   │   ├── billing-cycles.routes.js   # Ciclos de facturación / ventanas de cobro
│   │   │   ├── backups.routes.js          # Backups de router + schedules
│   │   │   ├── smtp.routes.js             # Config SMTP (fuente única de correo) + test
│   │   │   ├── whatsapp.routes.js         # Config WhatsApp Cloud API + webhook
│   │   │   ├── telegram.routes.js         # Config bot Telegram
│   │   │   ├── dashboard.routes.js        # KPIs
│   │   │   ├── reports.routes.js          # Financiero + clientes + cobranza + export
│   │   │   ├── plans.routes.js            # CRUD planes
│   │   │   ├── zones.routes.js            # CRUD zonas
│   │   │   └── users.routes.js            # CRUD usuarios del sistema
│   │   ├── services/ (25 archivos)
│   │   │   ├── wompi.service.js           # Links de Pago + webhook + reconciliation
│   │   │   ├── payment-link.service.js     # Creación individual/bulk de payment links
│   │   │   ├── client-auth.service.js      # Auth portal cliente: login, register, forgot/reset
│   │   │   ├── client-update-token.service.js  # Tokens de auto-servicio + aceptación de contrato
│   │   │   ├── mikrotik.service.js         # RouterOS REST client + failover
│   │   │   ├── network-monitor.service.js  # ICMP sweep + state machine
│   │   │   ├── router-monitor.service.js   # ICMP per route + router status
│   │   │   ├── notification.service.js     # SMTP + WhatsApp + Telegram sends
│   │   │   ├── notification.campaign.service.js  # Audiencia + envío masivo + paymentLinks
│   │   │   ├── notification-orchestrator.service.js  # Dispatch multicanal transactional
│   │   │   ├── notification-settings.service.js  # Gate central de correos a clientes
│   │   │   ├── whatsapp.service.js         # Meta Cloud API
│   │   │   ├── telegram.service.js         # Bot alerts
│   │   │   ├── invoice.service.js          # PDFKit generation (branded)
│   │   │   ├── billing.service.js / billing-cycle.service.js  # Facturación + ciclos
│   │   │   ├── bulk-plan-change.service.js # Cambio masivo de plan
│   │   │   ├── backup.service.js / backup-schedule.service.js # Backups de routers
│   │   │   ├── system-config.service.js    # SystemConfig key-value
│   │   │   ├── email-base.template.js      # HTML email templates (branded)
│   │   │   ├── queue.service.js            # BullMQ scaffold (inactivo)
│   │   │   ├── redis.service.js            # IORedis + cache + rate limit
│   │   │   ├── redis-lock.service.js       # Locks distribuidos
│   │   │   └── socket.service.js           # Singleton socket.io
│   │   ├── jobs/
│   │   │   ├── billing.job.js             # Crons de facturación
│   │   │   ├── overdue.job.js             # Crons de mora (NO suspende automático)
│   │   │   ├── debtor-notification.job.js # Recordatorio de deuda
│   │   │   ├── backup.job.js              # Backup de routers
│   │   │   └── queue.bootstrap.js         # Arranque BullMQ (scaffold)
│   │   └── prisma/ (NO USAR — deprecated)
│   │       └── schema.prisma              # ⚠️ SCHEMA ANTIGUO — no usar
│   ├── prisma/
│   │   ├── schema.prisma                  # Schema activo (43 modelos, 11 enums)
│   │   ├── migrations/                    # 43 migraciones aplicadas
│   │   ├── seed.js                        # admin@demo.com / password123
│   │   └── init.sql
│   ├── scripts/                           # import-wisphub, import CSV, scrape, analyze, seed-templates
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── +layout.svelte             # Root layout (Toaster, etc.)
│   │   │   ├── login/+page.svelte         # Admin login page
│   │   │   ├── (app)/                     # Rutas autenticadas admin (sidebar layout)
│   │   │   │   ├── dashboard/             # KPIs + charts
│   │   │   │   ├── clients/               # List + [id] detalle + new (stepper)
│   │   │   │   │   ├── planilla/          # Hoja tipo Excel: edición inline + celdas de mes + export/import
│   │   │   │   │   ├── eliminados/        # Archivo de clientes borrados (snapshot + deuda + motivo)
│   │   │   │   │   └── inventory/         # Inventario de equipos (ONU/TVBox/Router) + asignación
│   │   │   │   ├── plans/                 # CRUD planes
│   │   │   │   ├── zones/                 # CRUD zonas
│   │   │   │   ├── invoices/              # List + PDF + send + payment-link manual + billing-cycles
│   │   │   │   ├── payments/              # List + registro manual
│   │   │   │   ├── payment-links/         # Enlaces de pago + conciliación + reenvío
│   │   │   │   ├── mikrotik/              # Overview + routers + accounts
│   │   │   │   ├── network/               # Map + events + settings
│   │   │   │   ├── notifications/         # Campaigns + templates + history + configs
│   │   │   │   ├── reports/               # Multi-tab financial + clients + invoices
│   │   │   │   ├── system/                # Configuración del sistema (SMTP, WhatsApp, Telegram, red)
│   │   │   │   ├── users/                 # CRUD usuarios sistema
│   │   │   │   └── forbidden/             # 403 page
│   │   │   ├── portal/                    # Portal de Cliente (rutas literales /portal/*)
│   │   │   │   ├── login / register-password/[token] / forgot-password
│   │   │   │   ├── dashboard / invoices (+[id]) / payments / profile
│   │   │   └── (public)/
│   │   │       └── update/[token]/        # Auto-servicio: actualizar datos + aceptar contrato + pagar
│   │   ├── lib/
│   │   │   ├── api/                       # wrappers (clients, invoices, payments, portal, inventory, etc.)
│   │   │   ├── stores/                    # auth, client-auth, socket, toast, ui
│   │   │   ├── components/
│   │   │   │   ├── layout/ (Header, Sidebar)
│   │   │   │   ├── payments/ (RegisterPaymentModal, WompiButton)
│   │   │   │   ├── network/ (DeviceNode, ZoneTabs)
│   │   │   │   └── ui/ (Button, Input, Modal, Sheet, Table, etc.)
│   │   │   └── permissions.js             # RBAC route guard + sidebar filter
│   │   ├── app.css                        # Base styles + clases .btn-*/.input
│   │   └── app.html                       # HTML shell
│   ├── svelte.config.js                   # adapter-static, fallback 200.html
│   ├── vite.config.js                     # proxy /api + /uploads → :3001
│   └── tailwind.config.js                 # Paleta admin (brand.*/text.*/surface.*)
│
├── docker-compose.yml / docker-compose.dev.yml  # Repo únicamente — prod NO usa Docker
├── design-rules.md                        # Paleta admin, botones, contraste WCAG AA
├── README.md                              # Documentación general
├── START.md                               # Guía de arranque rápido
├── Leame.md                               # Este documento
└── .env.example                           # Template de variables de entorno
```

---

## Diseño Visual e Identidad de Marca

> El sistema maneja **dos identidades visuales distintas** que NO deben mezclarse.
> Confundirlas es el error más común al tocar UI o documentos.

### 1. Paleta de la aplicación admin (azules) — `frontend/tailwind.config.js`

Es la UI interna que usa el operador. Detalle completo y reglas de contraste en
[`design-rules.md`](design-rules.md). Resumen:

| Token | Hex | Uso |
|---|---|---|
| `brand-600` | `#2C4EC7` | **Color principal** — login bg, item activo en nav, focus rings, `.btn-primary` |
| `brand-800` | `#1e3a8a` | Fondo del sidebar, hover de botón, badges activos |
| `brand-900` | `#1a2f7a` | Pressed/hover oscuro |
| `brand-100/200` | `#dde8ff` / `#a8c0f4` | Texto y sub-nav sobre fondo oscuro |
| `text-primary` | `#0f172a` | Texto sobre fondo claro |
| `surface-page` | `#f8fafc` | Fondo del área de contenido |
| `surface-card` | `#ffffff` | Cards, modales, topbar |

Reglas clave (ver design-rules.md para el checklist de PR):
- Sistema de botones: `.btn-primary` (brand-600 sólido), `.btn-secondary` (outline brand-600), `.btn-danger` (rojo sólido), `.btn-warning` (ámbar), `.btn-ghost`, `.btn-icon`.
- **Prohibido el verde como fondo de CTA** (`green/emerald/teal`). Verde solo para badges de estado e iconos de KPI.
- Contraste WCAG AA ≥ 4.5:1; nunca `text-slate-400/gray-*` sobre fondo oscuro.
- Botones táctiles `min-h-[44px]` en móvil + `active:scale-[0.98]`.

### 2. Marca de cara al cliente "Internet Online" (navy + gold) — `backend/src/config/brand.js`

Es la identidad comercial que ve el cliente final en **emails transaccionales, PDF
de factura y páginas públicas** (`/update/[token]`, preview Open Graph del enlace).
Los valores se tomaron verbatim de https://internetonline.co para que todo lea como
una sola marca. `brand.js` es la **fuente única**: emails y PDF importan de ahí.

| Token | Hex | Origen (css `:root`) |
|---|---|---|
| `navy` | `#16357E` | `--color-primary` — color principal de marca |
| `navyHover` | `#1E469B` | `--color-primary-hover` |
| `navyDeep` | `#0E255C` | `--color-primary-deep` |
| `navyLight` | `#E9EFFA` | `--color-primary-light` (fondos suaves) |
| `gold` | `#FDB913` | `--color-accent` — acento/CTA |
| `goldHover` | `#ECA600` | `--color-accent-hover` |
| `goldLight` | `#FFF2CE` | `--color-accent-light` |
| `text` / `textMuted` | `#111111` / `#6B7280` | Texto |
| `border` / `divider` | `#E2E8F2` / `#EAEFF7` | Bordes |
| `success` / `danger` | `#15803D` / `#DC2626` | Estados |

**Copy e identidad (verbatim del sitio):**
- Nombre: **Internet Online** · Tagline: *"El internet de nuestra gente"* · Slogan: *"¡Conéctate de verdad!"*
- Promesa: *"Fibra óptica real, rápida y sin interrupciones"* · Zonas: San Vicente y La Estrella
- Contacto: `contacto@internetonline.co` · `+57 323 632 9425` (wa.me `573236329425`) · `www.internetonline.co`
- Tipografía: **Inter** con fallbacks web/email seguros
- Campos fiscales (NIT, dirección) **NO** están en el sitio → salen de las env `COMPANY_*` para que la factura sea un documento fiscal válido.

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
| `FRONTEND_URL` | Sí | URL exacta del frontend (CORS y redirects). **Debe coincidir con el origin del navegador** |
| `CORS_EXTRA_ORIGINS` | No | Orígenes CORS adicionales (separados por coma) |
| `WOMPI_PUBLIC_KEY` | Sí | Llave pública Wompi (`pub_test_*` / `pub_prod_*`) |
| `WOMPI_PRIVATE_KEY` | Sí | Llave privada Wompi (`prv_test_*` / `prv_prod_*`) |
| `WOMPI_EVENTS_KEY` | Sí | Events key para verificar webhooks (`evt_test_*` / `evt_prod_*`) |
| `WOMPI_API_URL` | No (default `https://api.wompi.co/v1`) | Base URL de la API de Wompi |
| `SMTP_HOST` | Sí | Servidor SMTP (ej: smtp.brevo.com) |
| `SMTP_PORT` | No (default 587) | Puerto SMTP |
| `SMTP_USER` / `SMTP_PASS` | Sí | Credenciales SMTP |
| `COMPANY_*` | Sí | Datos fiscales de empresa (nombre, NIT, ciudad, dirección, teléfono, email) — respaldo de `brand.js` |
| `UPLOADS_PATH` | No (default ./uploads) | Ruta para archivos subidos |
| `MAX_FILE_SIZE` | No (default 10485760) | Tamaño máximo de archivo (bytes) |
| `RATE_LIMIT_WINDOW_MS` | No (default 900000) | Ventana de rate limiting (ms) |
| `RATE_LIMIT_MAX_REQUESTS` | No (default 1000) | Máximo de requests por ventana |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | No | Credenciales WhatsApp Cloud API (bootstrap; la config real vive en DB) |
| `TWILIO_*` | No | Credenciales Twilio (scaffold, no implementado) |
| `MIKROTIK_*` | No | Router por defecto (opcional; la config per-router está en DB) |

### Frontend (frontend/.env)

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `PUBLIC_API_URL` | No (vacío en dev → Vite proxy) | URL base del API. Vacío = mismo origen (producción), o `http://localhost:3001` standalone |

---

## Modelo de Datos

**43 modelos** y **11 enums** en `backend/prisma/schema.prisma` (43 migraciones aplicadas).

### Enums

`UserRole` (ADMIN, OPERATOR, TECHNICIAN, VIEWER) · `ClientStatus` (ACTIVE, SUSPENDED, INACTIVE, PENDING) · `InvoiceStatus` · `PaymentStatus` · `PaymentMethod` (CASH, BANK_TRANSFER, CREDIT_CARD, WOMPI, NEQUI, BANCOLOMBIA, OTHER) · `NotificationType` · `NotificationChannel` · `RouterStatus` · `RouteStatus` · `DeviceType` · `DeviceStatus`.

### Modelos por dominio

| Dominio | Modelos |
|---|---|
| Auth admin | `User`, `Session` |
| Clientes | `Client`, `ClientEvidencePhoto`, `ClientUpdateToken`, `ContractAcceptance`, `DeletedClientArchive` |
| Inventario | `InventoryProduct`, `InventoryItem` |
| Portal cliente | `ClientUser`, `ClientSession`, `ClientResetToken`, `ClientNotification` |
| Catálogo | `Plan`, `Zone` |
| Facturación | `Invoice`, `InvoiceItem`, `BillingCycle` |
| Pagos | `Payment`, `PaymentAttempt`, `PaymentLink`, `PaymentLinkCampaign` |
| Red / MikroTik | `Router`, `RouterRoute`, `RouterBackup`, `RouterBackupSchedule`, `MikrotikAccount`, `MikrotikConfig`, `Device`, `NetworkDevice`, `NetworkConnection`, `NetworkEvent`, `NetworkMapView` |
| Notificaciones | `NotificationTemplate`, `NotificationCampaign`, `NotificationLog`, `NotificationSetting` |
| Config | `SmtpConfig`, `WhatsAppConfig`, `TelegramConfig`, `WompiConfig`, `SystemConfig` |
| Operaciones | `BulkOperationLog` |

### Notas sobre el modelo `Client`

- **Precio per-cliente**: `monthlyFee` (centavos) — estilo WispHub, además del `plan`.
- **Cobranza (planilla)**: `reminderSentAt` (fecha del último mensaje de cobro) + `reminderChannel` (`WHATSAPP | EMAIL | SMS | LLAMADA | MANUAL`).
- **Tecnología**: `connectionType` = `FIBER` (default) | `WIRELESS`.
- **PPPoE/servicio**: las columnas se eliminaron en la migración `20260605170000`. La fuente única es ahora `MikrotikAccount` — leer `mikrotikAccount.username / remoteAddress / localAddress`, no `Client.pppoeUsername/serviceIp`.

---

## Planilla de Clientes

Hoja tipo Excel para gestión rápida de la cartera (26 clientes). Ruta admin
`/clients/planilla`. Desplegada en producción.

- **Edición inline** de campos del cliente directamente en la celda.
- **Celdas de mes** (pago / deuda) para llevar el control mensual visual.
- **Foto de comprobante al registrar un pago**: en el modal de la celda (modo pago) se puede adjuntar una foto opcional. Al confirmar, el pago se crea (`sheetCell` devuelve su `paymentId`) y la foto se sube como evidencia del cliente **ligada a ese pago** (`ClientEvidencePhoto.paymentId`, tipo `payment`). Si la subida falla, el pago **no se revierte**. El input no fuerza la cámara → permite elegir screenshot de la galería (útil para consignaciones).
- **Ordenar por IP**: clic en el encabezado **IP** cicla natural → ascendente → descendente. Orden numérico real por octetos (`.10` va después de `.3`); el export a Excel respeta el orden visible.
- **Export / import Excel** con SheetJS (`xlsx`).
- **Registro de cobro por varios medios a la vez** (WhatsApp + Email; SMS reservado a futuro): guarda `reminderSentAt` + `reminderChannel` en el cliente.
- **Solicitud de actualización desde la planilla**: genera el enlace de auto-servicio y envía email branded con el mismo contenido y preview que el modal de la ficha del cliente. El modal distingue **"enviado"** vs **"previsualización (manual)"**.

---

## Archivo de Clientes Eliminados

Al borrar un cliente, **antes** del cascade se archiva un snapshot completo en
`DeletedClientArchive`. Ruta admin `/clients/eliminados`. En producción.

Se congela: identidad, plan, IP PPPoE al momento, `previousStatus`, y un **resumen
financiero** — `outstandingDebt` ("¿quedó debiendo?"), `totalInvoiced`, `totalPaid`,
conteos, y un `detail` JSON con el desglose de facturas y pagos. También `reasonCategory`
(`NO_PAGO | SE_RETIRO | CANCELACION_VOLUNTARIA | OTRO`) + nota, y quién/cuándo lo borró.

> Gotcha: Prisma 5.22 no soporta `omit`; el snapshot se arma con selects explícitos.

---

## Inventario de Equipos

Control de equipos entregados a clientes (ONU, TV Box, Router, Antena). Ruta admin
`/clients/inventory`.

- `InventoryProduct` = catálogo (nombre, categoría, imagen, descripción).
- `InventoryItem` = unidad física con `serial` único opcional. `clientId` null = en bodega; con valor = entregado. `status` = `IN_STOCK | ASSIGNED | RETURNED | FAULTY`.
- Al borrar un producto: `Restrict` (no se puede si tiene items). Al borrar un cliente: `SetNull` (el equipo vuelve a quedar sin dueño, no se pierde).

---

## Auto-servicio del Cliente: Actualización + Pago + Contrato Digital

Página pública `/(public)/update/[token]` (sin login, token de un solo uso). El
operador genera el token desde la ficha del cliente o desde la planilla y lo envía
por Email y/o WhatsApp (mensaje copiable + link `wa.me`).

### Endpoints públicos (`/api/v1/public/client-updates/:token`)

| Método | Propósito |
|---|---|
| `GET /:token` | Devuelve datos actuales del cliente + **texto del contrato** (ON-F-01) con su versión y hash |
| `PUT /:token` | Cliente actualiza sus datos **y** acepta contrato + tratamiento de datos (obligatorio) |
| `POST /:token/pay` | Genera link de pago Wompi de la deuda pendiente |
| `POST /:token/photos` | Cliente sube evidencias fotográficas |

### Contrato digital ON-F-01 (`backend/src/config/contract.js`)

- `CONTRACT_VERSION = 'ON-F-01 v1'`. Si cambia el texto **se sube la versión** para no mezclar aceptaciones.
- El texto se renderiza con los datos del cliente y se calcula su **SHA-256** (`hashContent`).
- La aceptación es **obligatoria** para poder enviar el formulario.
- Se persiste en `ContractAcceptance` con **identidad congelada** (no cambia si el cliente se edita después): nombre, documento, plan, `equipmentMode` (`"A" | "B" | null`), `contentText` (snapshot inmutable), `contentHash`, consentimientos (`acceptedTerms`, `acceptedData` — Ley 1581/2008), y evidencia (`ipAddress`, `userAgent`, `tokenId`, `acceptedAt`).

---

## Integración Wompi — Links de Pago

### Arquitectura General

Wompi es la **única pasarela de pago**. Se implementa mediante **Links de Pago**
(Payment Links), NO mediante el Widget Checkout Web (deprecado por inestabilidad).

```
Frontend (SPA)                         Backend (Express)                  Wompi API
     │  POST /portal/invoices/:id/pay       │                                │
     │─────────────────────────────────────>│  POST /v1/payment_links        │
     │                                      │───────────────────────────────>│
     │  { checkoutUrl }                     │     { data: { id: "xxx" } }   │
     │<─────────────────────────────────────│<───────────────────────────────│
     │  Redirect a checkout.wompi.co/l/{id} │                                │
     │  (Cliente paga)                      │  POST /webhooks/wompi          │
     │                                      │  (transaction.updated)         │
     │                                      │<───────────────────────────────│
     │                                      │  • Verifica firma HMAC-SHA256  │
     │                                      │  • Resuelve factura            │
     │                                      │  • Crea/actualiza Payment      │
     │                                      │  • Actualiza Invoice.status    │
```

### Formas de generar un link de pago

1. **Portal cliente** — `POST /api/v1/portal/invoices/:id/pay`.
2. **Auto-servicio público** — `POST /api/v1/public/client-updates/:token/pay`.
3. **Manual desde la factura** — `POST /api/v1/invoices/:id/payment-link`: el operador **obtiene el link sin enviarlo** (para pegarlo donde quiera). Distinto de `POST /:id/send` (que sí envía).
4. **Campaña masiva** — `NotificationCampaign` / `PaymentLinkCampaign` con `generatePaymentLinks: true`.

### Endpoints Wompi Utilizados

| Endpoint | Método | Propósito |
|----------|--------|-----------|
| `/{env}/v1/payment_links` | `POST` | Crear link de pago |
| `/{env}/v1/payment_links/{id}` | `GET` | Consultar estado del link |

`{env}` = `sandbox.wompi.co` (dev) o `api.wompi.co` (prod). Ver `WOMPI_API_URL`.

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

**Notas:**
- No se envía `reference`, `customer_data`, ni `signature` (no existen en payment_links).
- `amount_in_cents` es el total en centavos ($65.000 COP → 6500000).
- La respuesta trae `data.id` → checkout URL = `https://checkout.wompi.co/l/{id}`.

### Webhook — Confirmación (`POST /api/v1/payments/webhooks/wompi`)

`handleTransactionUpdate` en `wompi.service.js`:
1. **Verifica firma** HMAC-SHA256 con `WOMPI_EVENTS_KEY` (propiedades ordenadas + timestamp), comparación en tiempo constante.
2. **Resuelve factura** por `reference` (`INV-001-{ts}-{rand}` → `INV-001`) o por `payment_link_id` (= `PaymentAttempt.externalId`).
3. Actualiza `PaymentAttempt` (APPROVED/DECLINED/ERROR).
4. **Idempotencia** por `transactionId` (UNIQUE): si existe actualiza, si no crea `Payment`.
5. Crea `Payment` (método `WOMPI`, status `COMPLETED`).
6. `updateInvoiceStatus`: si total pagado ≥ total → `PAID`, `balanceDue = 0`.

### Modelos de Pago

- `PaymentAttempt` — un intento trazable por link (`reference` único, `externalId` = wompiLinkId, `status`, `webhookPayload`).
- `PaymentLink` — link asociado a factura + cliente (`wompiLinkId`, `checkoutUrl`, `status`, `sentAt`).
- `PaymentLinkCampaign` — campaña de cobro masiva con métricas (`sentCount`, `openedCount`, `paidCount`).

### Configuración por Entorno

| Variable | Sandbox (dev) | Producción |
|----------|--------------|------------|
| `WOMPI_API_URL` | `https://sandbox.wompi.co/v1` | `https://api.wompi.co/v1` |
| `WOMPI_PUBLIC_KEY` | `pub_test_*` | `pub_prod_*` |
| `WOMPI_PRIVATE_KEY` | `prv_test_*` | `prv_prod_*` |
| `WOMPI_EVENTS_KEY` | `evt_test_*` | `evt_prod_*` |

**Importante:** las llaves sandbox y prod NO son intercambiables (retorna `INVALID_ACCESS_TOKEN`).

**Webhook a registrar en el dashboard de Wompi:** `https://app.internetonline.co/api/v1/payments/webhooks/wompi` · Evento: `transaction.updated`.

---

## Portal de Cliente

Sección independiente dentro del mismo SPA, bajo `/portal/*`, con auth propia:

- **Cookie:** `client_token` (separada de `token` de admin).
- **Middleware:** `client-auth.middleware.js` (JWT `type: 'client'` + `ClientSession`).
- **Alcance:** solo datos del propio cliente.
- **Modelos:** `ClientUser` (1:1 con `Client`), `ClientSession` (revocable), `ClientResetToken`.

### Flujo de Registro

1. Admin invita → `ClientUser` + `ClientResetToken` → email con link.
2. `GET /portal/register-password/{token}` → cliente establece contraseña (bcryptjs).
3. `POST /client-auth/login` → JWT + cookie `client_token`.

### Endpoints del Portal

| Ruta | Método | Auth | Descripción |
|------|--------|------|-------------|
| `/api/v1/client-auth/login` | POST | No | Login email + password |
| `/api/v1/client-auth/register-password` | POST | No | Primer login |
| `/api/v1/client-auth/forgot-password` · `/reset-password` | POST | No | Recuperación |
| `/api/v1/client-auth/me` | GET | Client | Perfil |
| `/api/v1/portal/dashboard` | GET | Client | Resumen (cards + facturas recientes) |
| `/api/v1/portal/invoices` (+`/:id`) | GET | Client | Facturas |
| `/api/v1/portal/invoices/:id/pay` | POST | Client | Generar link de pago |
| `/api/v1/portal/payments` | GET | Client | Historial de pagos |
| `/api/v1/portal/profile` | GET | Client | Datos + plan |

---

## Inventario de Funcionalidades

### Autenticación y Seguridad
- Login JWT + sesión en DB (revocable) para admin y clientes; logout elimina sesión.
- Registro de usuarios (solo ADMIN); cambio de contraseña invalida otras sesiones.
- Roles: ADMIN, OPERATOR, TECHNICIAN, VIEWER; autorización por ruta (`requireAdmin`, `requireOperational`).
- CSRF defense-in-depth (origin-guard) + rate limiting global y por ruta + helmet.

### Gestión de Clientes
- CRUD con búsqueda, filtros (status/plan/zone/city), paginación.
- Stepper de creación en 2 pasos: zona → datos + PPPoE.
- Vista detalle editable inline, KPI strip, facturas, pagos, galería de fotos (lightbox).
- **Planilla editable** tipo Excel con celdas de mes + export/import + registro de cobro multi-medio.
- **Archivo de eliminados** con snapshot financiero y motivo antes del cascade.
- **Inventario de equipos** asignados a clientes.
- Suspender/activar servicio (MikroTik + notifica) — **siempre manual, nunca automático**.
- Cambio de plan (individual y masivo).
- **Auto-servicio público** con actualización de datos + **contrato digital ON-F-01** + pago.

### Planes y Zonas
- Planes: precio en centavos, velocidades, perfil MikroTik, `isFree`.
- Zonas: 1:1 con router; vista en mapa (SvelteFlow) con viewport persistente por zona.

### MikroTik / RouterOS
- CRUD routers con multi-IP failover (hasta 3 rutas), verificación de conectividad, sync de secrets.
- Perfiles PPPoE, IPs disponibles, import masivo, suspensión/activación de secrets, address-list, logs, backups programados.

### Facturación
- CRUD con items; generación masiva mensual (cron); PDF branded (PDFKit); envío email/WhatsApp.
- Ciclos de facturación (`BillingCycle`) + ventanas de cobro; recordatorios de deuda.
- Estados: DRAFT, PENDING, PARTIAL, PAID, OVERDUE, CANCELLED, REFUNDED.

### Pagos (Wompi Links de Pago)
- Links individuales, manuales (sin enviar), y masivos (campañas).
- `PaymentAttempt` múltiples por factura; webhook con HMAC-SHA256; reconciliación por reference o payment_link_id; idempotencia por transactionId.
- Registro **manual** (CASH, BANK_TRANSFER, CREDIT_CARD, OTHER); reembolsos; conciliación y reenvío desde `/payment-links`.

### Notificaciones y Campañas
- Plantillas con presets + variables: `{{name}}`, `{{email}}`, `{{phone}}`, `{{plan}}`, `{{zone}}`, `{{ip}}`, `{{balance}}`, `{{dueDate}}`, `{{amount}}`, `{{paymentLink}}`.
- Campañas masivas con filtro de audiencia + generación automática de payment links + preview de audiencia/clientes + diagnóstico + reintento de fallidos.
- Canales: EMAIL (SMTP como **fuente única** con gate central de correos a clientes), WhatsApp (Meta Cloud API), Telegram.
- Notificaciones transaccionales (factura creada, pago recibido, servicio suspendido).

### Red / Monitoreo
- Mapa interactivo (SvelteFlow); ICMP con state machine (ONLINE → UNSTABLE → OFFLINE).
- Monitoreo de rutas de routers (failover); eventos en tiempo real (socket.io); alertas Telegram en DOWN/RECOVERY.

### Reportes
- Dashboard KPIs; financiero (ingresos/gastos/P&L); clientes (por plan/ciudad/estado); cobranza (antigüedad de deuda); export JSON/CSV/Excel/PDF.

### Admin / Configuración (`/system`)
- CRUD usuarios; SMTP con test; WhatsApp Cloud API; Telegram Bot; monitoreo de red; config Wompi.

---

## Estado del Proyecto y Pendientes

### Políticas del sistema
- **Suspensión de servicio SIEMPRE manual.** No hay cron ni bulk-suspend flag-gated que corte automáticamente.
- **SMTP es la fuente única de correo** con un gate central que decide qué correos salen a clientes.
- **Tipado**: svelte-check pasó de 1695 → **0 errores** (10 fases).

### Pendientes / mejoras conocidas
- **Cifrado de credenciales de routers** (`routers.password`/`sshPass` hoy en texto plano) → aprobado, pendiente aplicar AES-256-GCM.
- **Plantillas WhatsApp Meta**: falta cablear `templateMap → sendTemplate` y sacar el número de modo prueba.
- **Sin tests automatizados** (ni unit ni e2e) — deuda pendiente.
- **BullMQ cableado pero inactivo**: campañas y facturación corren en proceso.
- **Monitor ICMP in-process**: a 200+ dispositivos podría afectar latencia (hoy 26 clientes, sin problema).
- **Helmet sin CSP completo**; considerar logger estructurado (pino/winston) en lugar de `console.log`.

---

## Despliegue en Producción

### Servidores

| Rol | IP | Servicios |
|-----|-----|-----------|
| Backend + DB + Redis | `10.2.3.6` | PM2 (isp-api), PostgreSQL, Redis |
| Proxy reverso | `157.151.224.139` | Nginx → `app.internetonline.co` |

### Cómo corre producción (importante)

- **No usa Docker.** Aunque el repo tiene `docker-compose.yml`, en prod NO se usa. El stack real es:
  - **Backend:** PM2, proceso `isp-api` = `node /opt/isp-manager/backend/src/server.js` (puerto 3001).
  - **Frontend:** **Nginx del host** sirve el build estático desde `/opt/isp-manager/frontend/build` y hace proxy `/api` → `127.0.0.1:3001`. `server_name app.internetonline.co`.
  - **PostgreSQL** y **Redis** locales en `127.0.0.1`.
- **Ruta del proyecto:** `/opt/isp-manager`. **Acceso:** `ssh root@10.2.3.6` (llave SSH).
- ⚠️ Históricamente se desplegó por rsync de archivos sueltos, por eso el working tree de git en el server suele estar **sucio**. Antes de deploy git-based: `git stash -u`.

### Backups (SIEMPRE antes de un deploy con migraciones)

```bash
ssh root@10.2.3.6 'bash -lc "
TS=$(date +%Y%m%d-%H%M%S); BK=/root/isp-backups/$TS; mkdir -p $BK
DBURL=$(grep -E ^DATABASE_URL= /opt/isp-manager/backend/.env | cut -d= -f2- | tr -d \"\\\"\")
pg_dump \"$DBURL\" > $BK/db.sql
tar czf $BK/source.tgz --exclude node_modules --exclude .git -C /opt isp-manager
tar czf $BK/build.tgz -C /opt/isp-manager/frontend build
ls -lh $BK"'
# Restaurar DB:   psql "$DBURL" < /root/isp-backups/<TS>/db.sql
# Restaurar build: tar xzf /root/isp-backups/<TS>/build.tgz -C /opt/isp-manager/frontend
```

### Despliegue git-based (recomendado)

```bash
ssh root@10.2.3.6
cd /opt/isp-manager
git config --global --add safe.directory /opt/isp-manager   # solo una vez
git stash push -u -m pre-deploy-$(date +%F)                 # guarda cambios sucios (recuperable)
git fetch origin && git checkout <rama> && git pull --ff-only origin <rama>

# Backend
cd backend && npm install --no-audit --no-fund
npx prisma migrate status          # ver pendientes
npx prisma migrate deploy          # aplica solo pendientes (idempotente)
npx prisma generate

# Frontend (genera /opt/isp-manager/frontend/build que sirve nginx)
cd ../frontend && npm install --include=dev --no-audit --no-fund && npm run build

# Reiniciar backend (el frontend es estático, no requiere reinicio)
pm2 restart isp-api --update-env

# Verificar
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/api/health   # -> 200
pm2 status
```

### Comandos útiles

```bash
pm2 status && pm2 logs --lines 50
pm2 restart all
nginx -t && systemctl reload nginx
tail -n 100 /var/log/nginx/error.log
```
