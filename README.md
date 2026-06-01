# ISP Manager

Sistema interno de gestión para un ISP pequeño (≈ 26 clientes reales, escala ≤ 200).
Reemplaza a [WispHub](https://wisphub.app) como capa operativa: clientes, planes,
facturación, pagos, integración con MikroTik (RouterOS), notificaciones
(Email/WhatsApp/Telegram) y monitoreo ICMP de la red.

> No es una réplica de WispHub. Adopta sus convenciones de PPPoE/zonas/routers
> pero NO copia su modelo de datos (ej: aquí cada zona tiene un único router
> asignado, y los clientes resuelven el router desde la zona, no lo eligen).

---

## Tabla de contenidos

- [Stack](#stack)
- [Arquitectura](#arquitectura)
- [Estructura del repo](#estructura-del-repo)
- [Modelo de datos](#modelo-de-datos)
- [Módulos / funcionalidades](#módulos--funcionalidades)
- [Roles y permisos](#roles-y-permisos)
- [Integraciones externas](#integraciones-externas)
- [Tareas programadas (cron)](#tareas-programadas-cron)
- [Monitoreo de red](#monitoreo-de-red)
- [Variables de entorno](#variables-de-entorno)
- [Arranque](#arranque)
- [API — endpoints principales](#api--endpoints-principales)
- [Convenciones de UI](#convenciones-de-ui)
- [Herramientas y scripts](#herramientas-y-scripts)
- [Issues conocidos / deuda técnica](#issues-conocidos--deuda-técnica)

---

## Stack

| Capa | Tecnología | Notas |
|---|---|---|
| Runtime | Node.js 18+ (ESM) | `"type": "module"` en backend |
| API | Express 4 | rutas REST bajo `/api/v1/*` |
| ORM | Prisma 5 (cliente 5.22) | 19 migraciones aplicadas |
| DB | PostgreSQL 15 | una sola DB `isp_manager` |
| Tiempo real | socket.io 4 | push de eventos de red al frontend |
| Cache / cola | Redis 7 (ioredis) + BullMQ (dep) | **conectado pero sin uso intensivo todavía** (RedisService listo, BullMQ no instanciado) |
| Auth | JWT (jsonwebtoken) + bcryptjs | sesiones también persistidas en tabla `sessions` |
| Validación | Zod | en schemas de routes y `config/env.js` |
| Mailer | nodemailer | SMTP configurable por DB (`SmtpConfig`) |
| Telegram | node-telegram-bot-api | alertas de monitor |
| WhatsApp | Meta Cloud API (axios directo) | sin SDK de Facebook; patrón "Jasper's Market" |
| RouterOS | node-routeros | API binaria (puerto 8728) |
| ICMP | `ping` (CLI wrapper) | monitor de devices + rutas de routers |
| Frontend | SvelteKit 1 (`adapter-static`) + Vite 4 | SPA estática servida por Nginx en prod |
| UI | TailwindCSS + DaisyUI + lucide-svelte | tokens de marca en [tailwind.config.js](frontend/tailwind.config.js); reglas en [design-rules.md](design-rules.md) |
| PDF | pdfkit | facturas |
| Infra | Docker + Docker Compose | dev y prod separados |

> **No implementado todavía** (presente en deps/env pero solo placeholder):
> SMS vía Twilio — el `notification.service.js` tiene comentado "would integrate
> with Twilio"; las variables `TWILIO_*` deben existir para que `env.js` no
> aborte el arranque, pero ningún envío real ocurre.

---

## Arquitectura

```
┌────────────────────────┐     HTTP/WS      ┌────────────────────────┐
│  SvelteKit SPA (Nginx) │ ───────────────▶ │   Express API (3001)   │
│  http://localhost:5173 │ ◀─── socket.io ──│   /api/v1 + /uploads   │
└────────────────────────┘                  └───────────┬────────────┘
                                                        │
                                  ┌─────────────────────┼──────────────────────┐
                                  ▼                     ▼                      ▼
                          ┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
                          │ PostgreSQL   │    │ Redis (cliente)  │    │ RouterOS API │
                          │ (Prisma)     │    │ ioredis          │    │ puerto 8728  │
                          └──────────────┘    └──────────────────┘    └──────────────┘
                                  ▲                                          ▲
                                  │                                          │
                          ┌───────┴─────────┐                       ┌────────┴──────┐
                          │ cron jobs       │                       │ ICMP monitor  │
                          │ (billing,       │                       │ (network +    │
                          │  overdue)       │                       │  router-routes)│
                          └─────────────────┘                       └───────────────┘

                       Salidas: SMTP (nodemailer) · Meta Cloud (WhatsApp)
                                Telegram Bot · Wompi API
```

Decisiones clave:

- **MikroTik-first en alta de clientes**: el cliente NO se persiste en DB si el
  secret PPPoE no se crea antes en el RouterOS de su zona. Ver
  [clients.controller.js:170+](backend/src/controllers/clients.controller.js#L170).
- **Zona → Router (1:1 lógico)**: el cliente nunca elige router; lo hereda
  de la zona. Si la zona no tiene router, no se puede crear el cliente.
- **Polling ICMP en proceso**: a la escala actual (≤ 200 dispositivos) no se
  justifica un worker dedicado; el sweep corre dentro del proceso del API.

---

## Estructura del repo

```
isp-manager/
├── backend/
│   ├── src/
│   │   ├── app.js                 # Express setup + montaje de rutas
│   │   ├── server.js              # HTTP + socket.io + startMonitor()
│   │   ├── config/env.js          # Zod schema de variables de entorno
│   │   ├── controllers/           # 6 controladores (auth, clients, invoices, mikrotik, payments, reports)
│   │   ├── routes/                # 18 routers (cliente, zonas, planes, routers, redes, etc.)
│   │   ├── services/              # 12 servicios (mikrotik, network-monitor, router-monitor, wompi, whatsapp, telegram, socket, redis, etc.)
│   │   ├── jobs/                  # billing.job.js, overdue.job.js (node-cron)
│   │   └── middleware/            # auth + error
│   ├── prisma/
│   │   ├── schema.prisma          # 25 modelos
│   │   ├── migrations/            # 19 migraciones (mayo 2026)
│   │   ├── seed.js                # usuario admin@demo.com / password123
│   │   └── init.sql
│   ├── scripts/
│   │   ├── import-wisphub.js      # ETL desde export de WispHub (ver wisphub-importer en memoria)
│   │   ├── analyze-wisphub.js
│   │   ├── scrape-wisphub.js
│   │   └── seed-notification-templates.js
│   ├── uploads/                   # evidencias, adjuntos (servido en /uploads)
│   ├── Dockerfile / Dockerfile.dev
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── login/             # /login
│   │   │   └── (app)/             # rutas autenticadas (layout con sidebar)
│   │   │       ├── dashboard/
│   │   │       ├── clients/        (+ /new, /[id])
│   │   │       ├── plans/
│   │   │       ├── zones/
│   │   │       ├── invoices/
│   │   │       ├── payments/
│   │   │       ├── mikrotik/       (+ /routers, /routers/[id], /routers/new, /accounts)
│   │   │       ├── network/        (+ /events, /settings)
│   │   │       ├── notifications/
│   │   │       ├── reports/
│   │   │       ├── users/
│   │   │       └── forbidden/
│   │   ├── lib/
│   │   │   ├── api/                # 14 clients fetch-wrappers
│   │   │   ├── components/ui/      # Button, Input, Card, Modal, Table, Sheet, ResponsiveTable, etc.
│   │   │   ├── components/layout/  # Header, Sidebar
│   │   │   ├── components/network/ # ZoneTabs, DeviceNode (mapa)
│   │   │   ├── stores/             # svelte stores
│   │   │   └── permissions.js
│   │   └── app.css                 # tokens + utilidades base
│   ├── tailwind.config.js          # paleta brand/text/surface (ver design-rules.md)
│   ├── svelte.config.js            # adapter-static
│   ├── nginx.conf                  # servir SPA + proxy
│   ├── Dockerfile
│   └── package.json
│
├── docker-compose.yml              # producción (postgres, redis, backend, frontend, pgadmin)
├── docker-compose.dev.yml          # desarrollo (hot reload)
├── design-rules.md                 # paleta y reglas de UI obligatorias
├── START.md                        # guía rápida de arranque
└── README.md                       # este archivo
```

---

## Modelo de datos

Resumen de los 25 modelos en [schema.prisma](backend/prisma/schema.prisma):

### Núcleo de negocio
- **User** (con enum `UserRole`: TECHNICIAN, ADMIN, OPERATOR\*, VIEWER\*)
- **Session** — sesiones persistidas (JWT + tabla)
- **Client** — abonado; `name`, contacto, `documentType/Number`, `status`, `planId`,
  `zoneId`, `monthlyFee` (override por cliente, en centavos), `installationDate`,
  `contractDate`, `cutoffDate`, `coordinates`, `pppoeUsername/Password/serviceIp/serviceLocalIp`
  (duplicados con `MikrotikAccount` — ver issues), `wisphubId` para idempotencia del importer.
- **ClientEvidencePhoto** — fotos de instalación / soporte / visita
- **Plan** — `downloadSpeed`, `uploadSpeed`, `monthlyPrice` (centavos),
  `mikrotikProfile` (perfil PPPoE técnico, distinto del nombre comercial)
- **Device** — hardware del cliente (MAC, IP, hostname)
- **Invoice** + **InvoiceItem** — `status` (DRAFT/PENDING/PARTIAL/PAID/OVERDUE/CANCELLED/REFUNDED),
  `dueDate`, totales en centavos
- **Payment** — `method` (CASH/BANK_TRANSFER/CREDIT_CARD/WOMPI/OTHER), `status`,
  `invoiceId`, `notes` (permite URLs de comprobante)

### Red y MikroTik
- **Zone** — agrupa clientes y devices; **`routerId` único** define qué RouterOS
  atiende a la zona; `color` para el mapa
- **Router** — RouterOS box; `apiPort`, credenciales, **failover multi-IP**
  (`status` ONLINE/DEGRADED/OFFLINE/UNKNOWN, `activeRouteId`, `failCount`, `alertSent`)
- **RouterRoute** — hasta 3 IPs por router (1 principal + 2 alternativas),
  con `status` por ruta, `latency`, `lastPingAt`
- **MikrotikAccount** — secret PPPoE 1:1 con `Client` (`username`,
  `password`, `remoteAddress`, `localAddress`, `profileName`, `coordinates`, `status`)
- **MikrotikConfig** — config legacy global (DEPRECATED, se usa `Router.*`)
- **NetworkDevice** — nodos del mapa de red (CPE, switch, AP, "Other");
  `failCount`/`alertSent` para gate del alert state machine
- **NetworkConnection** — enlaces entre devices del mapa (etiqueta libre)
- **NetworkEvent** — transiciones efectivas ONLINE↔OFFLINE/UNSTABLE
  (no se persiste el flap suprimido)
- **NetworkMapView** — viewport persistido por zona (zoom/pan del mapa)

### Notificaciones y config
- **NotificationLog** — log de envíos (con `externalId` de WhatsApp/SMTP)
- **NotificationTemplate** — plantillas reusables (incluye `preset` para
  semilla via [seed-notification-templates.js](backend/scripts/seed-notification-templates.js))
- **NotificationCampaign** — envío masivo en proceso (ver protección de
  campañas huérfanas en [server.js](backend/src/server.js))
- **SmtpConfig** — SMTP gestionable desde UI (single-row), test integrado
- **WhatsAppConfig** — token + phoneId + webhook verify de Meta Cloud
- **TelegramConfig** — bot + chatId; **también guarda** los parámetros
  globales del monitor (`probeIntervalSec`, `probeTimeoutSec`, `probeDownCount`)
- **SystemConfig** — kv genérico para flags/config futuros

\* `OPERATOR` y `VIEWER` son legacy (filas viejas). Nuevos usuarios deben
crearse como `ADMIN` o `TECHNICIAN`.

---

## Módulos / funcionalidades

### 1. Clientes (`/clients`)
- Listado con filtros por zona/estado, modal de edición rápida.
- Alta en `/clients/new` — stepper de 2 pasos: zona → datos + PPPoE.
- Detalle `/clients/[id]` — datos personales, facturas, historial de pagos,
  ficha PPPoE (usuario, password con toggle, IP, plan, coordenadas con link
  a Google Maps), evidencias fotográficas.
- Acciones: suspender/activar (afecta el secret en RouterOS), eliminar
  (limpia también MikroTik), cambiar plan, registrar pago manual.

### 2. Planes (`/plans`)
- CRUD; precio en COP, velocidades, perfil técnico PPPoE asociado al router.

### 3. Zonas (`/zones`)
- CRUD; cada zona se asigna a un Router; viewport del mapa se persiste por zona.

### 4. Routers MikroTik (`/mikrotik/routers`)
- Alta con verificación de conectividad por API binaria (8728).
- **Multi-IP failover**: hasta 3 rutas por router con monitor ICMP por ruta.
- Sincronización de secrets, perfiles PPPoE, IP pools disponibles.

### 5. Cuentas MikroTik (`/mikrotik/accounts`)
- Vista de los `MikrotikAccount` (debug / soporte). 1:1 con clientes.

### 6. Facturación (`/invoices`)
- Lista, PDF (pdfkit), generación masiva, registro de cancelación,
  reembolsos, parciales.

### 7. Pagos (`/payments`)
- Manual (CASH/BANK_TRANSFER/etc.), Wompi (checkout + webhook),
  reconciliación con factura.

### 8. Red (`/network`)
- Mapa interactivo de nodos por zona (`ZoneTabs`, `DeviceNode`),
  conexiones libres, badges live de estado (ONLINE/UNSTABLE/OFFLINE/UNKNOWN).
- `/network/events` — feed cronológico de transiciones.
- `/network/settings` — parámetros del polling (probe interval, timeout,
  down-count) — guardados en `TelegramConfig` (single-row).

### 9. Notificaciones (`/notifications`)
- Plantillas, campañas en masa (corre en proceso, con protección de huérfanos
  al reiniciar el server), log de envíos.

### 10. Reportes (`/reports`)
- Financieros, cobranzas, antigüedad de deudas, churn, crecimiento.

### 11. Usuarios (`/users`)
- ADMIN gestiona técnicos; cambio de password forzado, toggle isActive.

### 12. Dashboard (`/dashboard`)
- KPIs en tiempo real: clientes activos, facturas pendientes, ingresos del mes,
  estado de red.

---

## Roles y permisos

Definidos en [app.js](backend/src/app.js) y [middleware/auth.middleware.js](backend/src/middleware/auth.middleware.js).
Dos middlewares se aplican según la ruta:

| Middleware | Roles permitidos | Routes |
|---|---|---|
| `requireOperational` | ADMIN, TECHNICIAN (+ OPERATOR legacy) | `/zones`, `/clients`, `/dashboard`, `/network`, `/evidence-photos` |
| `requireAdmin` | ADMIN (+ OPERATOR legacy) | `/plans`, `/mikrotik/*`, `/invoices`, `/payments`, `/reports`, `/notifications`, `/smtp`, `/telegram`, `/whatsapp` |
| `authMiddleware` (cualquier rol logueado) | ADMIN, TECHNICIAN | `/users` |
| sin auth | — | `/auth/*`, `/whatsapp/webhook` (Meta lo llama sin nuestro header), `/api/health`, `/uploads/*` |

Toda regla se enforce **server-side**; el frontend tiene
[lib/permissions.js](frontend/src/lib/permissions.js) solo para ocultar UI,
no como capa de seguridad.

---

## Integraciones externas

| Servicio | Estado | Notas |
|---|---|---|
| **MikroTik RouterOS** (API binaria 8728) | ✅ producción | Creación/borrado/suspensión de secrets PPPoE, listado de perfiles, IPs disponibles, firewall (`ips_autorizadas_wisphub`) |
| **Wompi** (pasarela de pago Colombia) | ✅ producción | Checkout y webhook (`events_key`) |
| **SMTP / nodemailer** | ✅ producción | Config gestionable desde UI; templates HTML en `services/email-base.template.js` |
| **WhatsApp Cloud API (Meta)** | ✅ producción | Patrón Jasper's Market, sin SDK FB. Plantillas aprobadas + texto libre dentro de la ventana de 24h |
| **Telegram Bot** | ✅ producción | Alertas de monitor de red y de routers (down/recovery) |
| **WispHub** | ⚙️ ETL one-shot | `scripts/import-wisphub.js` (ver memoria `wisphub-importer`) — NO es integración runtime, solo migración inicial |
| **Twilio SMS** | ❌ no implementado | Variables presentes en `env.js` para no romper bootstrap; envío real no codificado |

### Webhooks expuestos
- `POST /api/v1/whatsapp/webhook` — entrada de mensajes y status de Meta.
  Verificación GET con `hub.verify_token`.
- `POST /api/v1/payments/wompi/webhook` — confirmación de pago (verifica firma con `WOMPI_EVENTS_KEY`).

---

## Tareas programadas (cron)

`node-cron` corriendo dentro del proceso del API (timezone del servidor).

### [billing.job.js](backend/src/jobs/billing.job.js)
| Cron | Tarea |
|---|---|
| `0 2 1 * *` | Generar facturas mensuales (día 1 a las 02:00) |
| `0 1 * * *` | Marcar facturas vencidas (01:00 diario) |
| `0 9 * * *` | Recordatorios de pago mañana (09:00) |
| `0 18 * * *` | Recordatorios de pago tarde (18:00) |
| `0 3 * * *` | Limpieza de sesiones expiradas (03:00) |
| `0 23 * * *` | Generación de reportes (chequea si "mañana" es día 1 — corre en el último día del mes a las 23:00) |

### [overdue.job.js](backend/src/jobs/overdue.job.js)
| Cron | Tarea |
|---|---|
| `0 8 * * *` | Suspensiones automáticas por mora |
| `0 10 * * *` | Reactivaciones automáticas (cuando se acredita pago) |
| `0 18 * * *` | Re-check de mora vespertino |
| `0 2 * * 0` | Mantenimiento semanal (domingo 02:00) |

### Monitores in-process (no cron)
- `startMonitor()` — sweep ICMP de NetworkDevices (intervalo de
  `TelegramConfig.probeIntervalSec`, default 30s)
- `startRouterMonitor()` — sweep ICMP por cada `RouterRoute` (misma cadencia)

Ambos releen su intervalo en cada tick: cambios en
`/network/settings` aplican al siguiente ciclo sin reinicio.

---

## Monitoreo de red

State machine de un `NetworkDevice` (ver [network-monitor.service.js](backend/src/services/network-monitor.service.js)):

```
                    ping ok
                    ↓
                  ┌──────────────┐
                  │ ONLINE       │  ←─── recovery → Telegram (si alertSent=true)
                  └──────┬───────┘
                         │ ping loss>50% OR latency≥200ms
                         ▼
                  ┌──────────────┐
                  │ UNSTABLE     │
                  └──────┬───────┘
                         │ fail
                         ▼
                  ┌──────────────┐
        no       │ failing      │
       hay  ────▶│ (silencioso  │── failCount ≥ probeDownCount ──┐
       trace    │  hasta gate) │                                 ▼
                  └──────────────┘                       ┌──────────────┐
                                                         │ OFFLINE      │ → alert Telegram (una vez)
                                                         └──────────────┘
```

Mismo enfoque para routers, pero el **gate de OFFLINE** se evalúa sobre
*todas las RouterRoute juntas*: una sola ruta viva ⇒ DEGRADED en vez de OFFLINE.

`NetworkEvent` solo se escribe en transiciones **efectivas** — un flap aislado
dentro del `probeDownCount` no deja rastro (evita spam en feed y Telegram).

---

## Variables de entorno

Todas validadas por Zod en [config/env.js](backend/src/config/env.js). Faltar
una marcada con `min(1)` aborta el arranque.

### Obligatorias
```env
NODE_ENV=development
PORT=3001
DATABASE_URL="postgresql://postgres:postgres123@localhost:5432/isp_manager"
REDIS_URL="redis://:redis123@localhost:6379"
JWT_SECRET="cambiar_por_uno_de_al_menos_32_caracteres"
JWT_EXPIRES_IN="8h"
FRONTEND_URL="http://localhost:5173"

# Wompi
WOMPI_PUBLIC_KEY="pub_test_..."
WOMPI_PRIVATE_KEY="prv_test_..."
WOMPI_EVENTS_KEY="events_test_..."
WOMPI_API_URL="https://api.wompi.co/v1"

# SMTP (también editable desde UI; estas son fallback / bootstrap)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="..."
SMTP_PASS="..."

# WhatsApp Cloud (Meta)
WHATSAPP_TOKEN="EAAB..."
WHATSAPP_PHONE_ID="123456789012345"
WHATSAPP_VERSION="v18.0"

# Twilio (placeholder — no se usa todavía, pero env.js los exige)
TWILIO_SID="AC..."
TWILIO_AUTH="..."
TWILIO_PHONE="+1234567890"

# Empresa (para PDFs y emails)
COMPANY_NAME="Mi ISP"
COMPANY_NIT="123456789-0"
COMPANY_CITY="Cali"
COMPANY_ADDRESS="Cra 123 #45-67"
COMPANY_PHONE="+57 2 555 1234"
COMPANY_EMAIL="contacto@miisp.com"

# Uploads
UPLOADS_PATH="./uploads"
MAX_FILE_SIZE=10485760

# MikroTik (fallback global; routers reales se gestionan en DB)
MIKROTIK_HOST="192.168.1.1"
MIKROTIK_PORT=8728
MIKROTIK_USER="admin"
MIKROTIK_PASSWORD="..."

# Rate limiting (opcionales; defaults razonables)
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

---

## Arranque

### Desarrollo local (sin Docker)

```bash
# 1. PostgreSQL + Redis arriba (puedes usar docker-compose.dev.yml solo
#    para esos dos servicios, o instalarlos nativos)
docker compose -f docker-compose.dev.yml up -d postgres redis

# 2. Backend
cd backend
npm install
cp .env.example .env       # editar antes
npx prisma migrate deploy  # aplica migraciones
npx prisma generate        # genera el client
npm run prisma:seed        # crea admin@demo.com / password123
npm run dev                # nodemon, puerto 3001

# 3. Frontend (otra terminal)
cd frontend
npm install
npm run dev                # vite, puerto 5173
```

### Producción con Docker Compose

```bash
cp .env.example .env       # editar secrets de verdad
docker compose up -d --build
docker compose logs -f
```

Servicios y puertos en `docker-compose.yml`:
- `postgres` → 5432
- `redis` → 6379
- `backend` → 3001
- `frontend` → 3000 (Nginx)
- `pgadmin` → 5050

### Credenciales por defecto
- App: `admin@demo.com` / `password123` (creado por `prisma seed`)
- PgAdmin: `admin@isp-manager.com` / `admin123`

---

## API — endpoints principales

Todas bajo `/api/v1` salvo `/api/health` y `/uploads/*`.

### Auth
```
POST   /auth/login
POST   /auth/register
POST   /auth/logout
GET    /auth/me
```

### Clientes
```
GET    /clients?status=&zoneId=&q=
GET    /clients/next-pppoe-number          # genera prefijo secuencial
POST   /clients                            # MikroTik-first: crea secret y luego DB
GET    /clients/:id
PUT    /clients/:id
DELETE /clients/:id
POST   /clients/:id/suspend
POST   /clients/:id/activate
POST   /clients/:id/change-plan
POST   /clients/:id/devices                # añadir hardware del abonado
POST   /clients/:id/evidence-photos        # multer (jpg/png)
```

### Zonas, Planes
```
GET|POST|PUT|DELETE /zones
GET|POST|PUT|DELETE /plans
GET    /zones/with-router                  # filtro para el step 0 del alta de cliente
```

### MikroTik Routers
```
GET|POST|PUT|DELETE /mikrotik/routers
GET    /mikrotik/routers/:id/available-ips
GET    /mikrotik/routers/:id/pppoe-profiles
POST   /mikrotik/routers/:id/test          # ping de credenciales
POST   /mikrotik/routers/:id/sync          # sincroniza secrets
```

### Facturas, Pagos
```
GET|POST|PUT|DELETE /invoices
GET    /invoices/:id/pdf
POST   /invoices/bulk-generate
GET|POST            /payments
POST   /payments/wompi/checkout/:invoiceId
POST   /payments/wompi/webhook
```

### Red
```
GET    /network/devices
POST   /network/devices
PUT    /network/devices/:id
POST   /network/connections
GET    /network/events
GET|PUT /network/settings                  # probe interval/timeout/down-count
POST   /network/devices/:id/probe          # sweep manual
```

### Notificaciones / Config
```
GET|POST /notifications/templates
POST   /notifications/campaigns
GET    /notifications/log
GET|POST /smtp/config                      # incluye /smtp/test
GET|POST /telegram/config
GET|POST /whatsapp/config
POST   /whatsapp/webhook                   # público (Meta lo invoca)
GET    /whatsapp/webhook                   # verify_token de Meta
```

### Reportes, Dashboard, Users
```
GET    /reports/financial
GET    /reports/clients
GET    /reports/network
GET    /dashboard/summary
GET|POST|PUT|DELETE /users
```

---

## Convenciones de UI

Las reglas viven en [design-rules.md](design-rules.md) — son **obligatorias**.
Resumen mínimo:

- Paleta de tokens en [tailwind.config.js](frontend/tailwind.config.js):
  `brand.*` (azules), `text.*`, `surface.*`.
- Sistema de botones: `.btn-primary` (azul `brand-600`), `.btn-secondary`
  (outline), `.btn-danger` (rojo), `.btn-warning` (ámbar), `.btn-ghost`,
  `.btn-icon`. **Verde prohibido para CTAs.**
- Sidebar `bg-brand-800`; nunca slate ni negro.
- Inputs: focus con `border-brand-600` + `ring-brand-600/20`.
- Contraste WCAG AA en todas las superficies (ver matriz en design-rules.md).

Componentes base reusables en
[frontend/src/lib/components/ui/](frontend/src/lib/components/ui/):
`Button`, `Input`, `Select`, `Textarea`, `Checkbox`, `Label`, `Card`,
`Modal`, `Sheet`, `Table`, `ResponsiveTable`, `Badge`, `Alert`.

---

## Herramientas y scripts

### Backend
```bash
npm run dev               # nodemon
npm start                 # producción
npm run prisma:generate   # regenerar client (necesario tras migrar)
npm run prisma:migrate    # crear nueva migración (dev)
npm run prisma:studio     # GUI de la DB
npm run prisma:seed       # admin@demo.com / password123
```

### Importador WispHub (one-shot)
```bash
cd backend
node scripts/import-wisphub.js
```
Detalles, mapeos y manejo de conflictos en la nota interna de memoria
`wisphub-importer.md`. **No es una integración runtime** — solo se corre
durante la migración inicial.

### Frontend
```bash
npm run dev               # vite (5173)
npm run dev:clean         # limpia .svelte-kit y rearranca
npm run build             # bundle estático
npm run preview           # previsualiza build
npm run check             # svelte-check
npm run lint              # prettier + eslint
npm run format            # prettier --write
```

---

## Issues conocidos / deuda técnica

Detectados durante exploración del repo — no son urgentes pero conviene
trackearlos antes de seguir agregando features.

1. **`city` hardcoded a `"Cali"`** en el alta de clientes
   ([clients.controller.js:181](backend/src/controllers/clients.controller.js#L181)).
   El form de `/clients/new` no pide ciudad; toda alta nueva nace con `Cali`
   aunque la zona sea de otra ciudad.

2. **Columnas duplicadas Client ↔ MikrotikAccount**:
   `pppoeUsername`, `pppoePassword`, `serviceIp`, `serviceLocalIp` viven en
   ambos modelos. El alta actual escribe sólo en `MikrotikAccount`; las
   columnas del lado `Client` quedan NULL para clientes nuevos (pero el
   importer WispHub sí las pobló). El detalle hace `client.X || mikrotikAccount.Y`
   para tolerarlo. Conviene deduplicar y dejar `MikrotikAccount` como única
   fuente.

3. **Edit del detalle es pobre** —
   [formPersonal](frontend/src/routes/(app)/clients/[id]/+page.svelte#L55-L64)
   sólo edita 8 campos. El backend (`PUT /clients/:id`) acepta más
   (name, notes, contractDate, installationDate, planId, mikrotik.*).

4. **`mikrotik.status` del create no afecta al Client**: si el operador
   elige "Suspendido" en el paso PPPoE, el `MikrotikAccount` queda
   suspendido pero `Client.status = 'ACTIVE'` → estado divergente.

5. **Modal de edición del listado pisa `profileName` con `plan.name`**
   ([+page.svelte:388](frontend/src/routes/(app)/clients/+page.svelte#L388)):
   debería usar `mikrotikAccount.profileName`.

6. **Twilio SMS**: las env vars son obligatorias en `env.js` pero no hay
   código real. Cualquiera de dos caminos: implementar el envío, o quitar
   la obligatoriedad y borrar el placeholder.

7. **Redis está cableado pero infrautilizado**: `RedisService` existe y
   BullMQ está en deps, pero las campañas de notificaciones corren en
   proceso. A esta escala (≤ 200 clientes) no es problema; al crecer
   conviene migrar a workers.

8. **2 migraciones quedaron sin aplicar** en alguna sesión anterior
   (`add_monitor_polling_settings` y `router_multi_ip_failover`) — ya se
   aplicaron, pero es recordatorio de correr `prisma migrate deploy`
   tras cada `git pull` antes de arrancar el backend.

---

## Notas para desarrollar sobre este sistema

- **MikroTik es la fuente de verdad operativa**, no la DB. Antes de
  cualquier mutación de cliente que afecte el servicio (alta, suspensión,
  cambio de plan), valida que el router acepta la operación; rollback si
  falla.
- **Las zonas son rígidas** (1 zona ↔ 1 router). Si un cliente se mueve
  de zona, su `MikrotikAccount` debe migrar al router de la nueva zona.
  Aún no hay endpoint dedicado; hoy se haría borrando y recreando.
- **El polling de red es in-process y no escala horizontalmente** — si en
  el futuro se levantan múltiples instancias del backend, hay que mover
  el monitor a un worker dedicado (lock distribuido en Redis o BullMQ).
- **Telegram es alerts-only**, no es un canal cliente-facing. WhatsApp
  Cloud sí es cliente-facing (notificaciones de facturación, soporte).
