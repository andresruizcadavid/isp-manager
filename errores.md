# Saneamiento de tipos (svelte-check) — plan por fases

> Objetivo: reducir los **1695 errores / 68 warnings** que reporta
> `npm run check` (svelte-check con `strict + checkJs`) a la menor cantidad
> posible, **sin introducir bugs**, mediante **tipado real incremental** (JSDoc
> + typedefs de dominio). NO se afloja la config (`strict`/`checkJs` se quedan).

Este archivo es la **memoria del trabajo**: se actualiza al cerrar cada fase
(conteo antes/después, qué se tocó, decisiones). Si se pierde contexto, leer
esto primero.

---

## Punto de partida (baseline)

- Fecha: 2026-06-20
- `svelte-check`: **1695 errores, 68 warnings, 91 archivos**.
- Config: [tsconfig.json](frontend/tsconfig.json) → `strict:true`, `checkJs:true`.

### Distribución por tipo de error (top)
| nº | tipo | causa raíz |
|----|------|------------|
| ~685 | `Variable 'X' implicitly has 'any'` | `let x = null` / `let x = []` sin anotar |
| ~505 | `Parameter 'X' implicitly has 'any'` | callbacks de `.map/.filter/.reduce` y handlers |
| ~152 | `'e' is of type 'unknown'` | bloques `catch (e)` |
| ~155 | `Property 'X' does not exist on type '{}'` | objetos iniciados como `{}` / acumuladores |
| ~50  | `Element implicitly any … can't index type {…}` | `MAP[key]` con const objeto |
| resto | `'X' expected`, `Cannot find name`, `not assignable`, comma operator… | **posibles bugs reales** — revisar caso a caso |

---

## Infraestructura (hecho)

- **[frontend/src/lib/types.d.ts](frontend/src/lib/types.d.ts)** — typedefs de
  dominio (Client, Invoice, Payment, Plan, Zone, Router, User, NetworkDevice,
  NotificationTemplate/Campaign, etc.) derivados de `schema.prisma`. Fuente de
  verdad para `@type {import('$lib/types').X}`.

---

## Convenciones de tipado (aplicar igual en todos los archivos)

1. **Estado de componente**: anotar al declarar.
   `/** @type {import('$lib/types').Client | null} */ let client = null;`
   `/** @type {import('$lib/types').Invoice[]} */ let invoices = [];`
2. **catch**: `catch (/** @type {any} */ e)` o, mejor, comprobar
   `e instanceof Error ? e.message : String(e)`. Se usa el helper
   `errMessage(e)` de `$lib/api/client.js` cuando aplique.
3. **Maps indexados por string**:
   `/** @type {Record<string,string>} */ const CLS = {…}` (evita el error de
   índice). Para enums, `Record<ClientStatus,string>` cuando el key es típado.
4. **Callbacks**: tipar parámetros vía el tipo del array fuente (si el array
   está bien tipado, `m`/`inv`/`p` se infieren solos). Si no, anotar:
   `(inv) => …` → `(/** @type {Invoice} */ inv) => …`.
5. **Eventos DOM**: `on:input={(e) => …}` → usar
   `(/** @type {Event & { currentTarget: HTMLInputElement }} */ e)` o
   `e.currentTarget.value` (currentTarget está tipado por Svelte).
6. **API wrappers**: castear el retorno al tipo de dominio:
   `getClient: (id) => /** @type {Promise<Client>} */ (api.get('/clients/'+id))`.
7. **No cambiar comportamiento en runtime.** Solo anotaciones y refactors
   seguros (p.ej. `?.`/`??`). Cualquier corrección de lógica se marca como BUG
   en la bitácora.

---

## Plan de fases (orden: mayor nº de errores primero)

Marcas: ⬜ pendiente · 🟦 en curso · ✅ hecho

### Fase 0 — Capa de datos (api/ + client.js + stores)  ✅
Se hizo primero porque **tipar los wrappers de API propaga tipos a las páginas**.
- ✅ `src/lib/api/client.js` — `request`/`api.*` con genéricos `@template T`, `catch` tipado.
- ✅ `src/lib/api/*.js` — todos los wrappers con `@param`/`@returns` a tipos de dominio. **Capa api 100% limpia.**
- ✅ `src/lib/stores/*.js` — toast, socket, layout, auth, client-auth, ui.
- ✅ `src/lib/navigation.js` (typedef `NavItem`) + `src/lib/permissions.js`.

> Resultado: **1695 → 1441** (−254 errores), 91 → 62 archivos (29 limpios). La
> caída en las páginas grandes llega en sus propias fases (al anotar su estado),
> ahora ya con los tipos de retorno del API disponibles.

### Fase 1 — clients/[id]/+page.svelte (290 → 0)  ✅
- Anotado `client` (`Client|null`) + ~30 vars de estado y ~25 funciones helper.
- `catch (e)` → `catch (/** @type {any} */ e)` (18).
- Mapas de clases/labels → `Record<string,string>`.
- Null-safety: como `client` es un `let` reasignado en closures (TS no estrecha),
  se captura `const c = client; if (!c) return;` en los handlers; en `toggleStatus`
  se reasigna `client = {...c, status}` para preservar la reactividad de Svelte.
- Restas de fechas → `.getTime()`. Props de `RegisterPaymentModal` tipadas.
- `isAdmin(role)` en navigation.js acepta `string|null|undefined`.
- **Sin cambios de runtime** salvo `toggleStatus` (reasignación equivalente). Build ✓.
### Fase 2 — notifications/+page.svelte (158 → 0)  ✅
- Mismo patrón: estado tipado (templates/campaigns/history/settings, Sets, msgs),
  catch (27), mapas → `Record`, params de funciones, `saved`/`created` tipados.
- `smtpForm`/`waForm` como `any` (se fusionan con datos del server).
- `settings` como `any[]` (la UI le añade label/desc/security de metadata).
- **BUG corregido**: `toggleSmtpPassword` llamaba `smtpApi.reveal()` (endpoint
  inexistente; el backend nunca devuelve la contraseña → write-only). Lanzaba
  "is not a function" atrapado por el catch (el ojo nunca revelaba). Simplificado
  a toggle de visibilidad. Build ✓.
### Fase 3 — clients/+page.svelte (126 → 0)  ✅
- Estado tipado (clients/zones/plans/routers, Sets, modal/pago, ips/profiles,
  import), 12 catch, params de funciones, mapas inline → cast `Record`.
- `params` de búsqueda como `Record<string,any>` (se les añaden claves dinámicas).
- Se añadió `ip?` al tipo `Router` (el API lo deriva de la ruta principal). Build ✓.
### Fase 4 — network/+page.svelte (117 → 0)  ✅
- Estado tipado (stores nodes/edges, devices/connections/zones, Maps, viewport,
  form/editing como any), 10 catch, params (incl. destructuring de SvelteFlow).
- Mapas/objetos dinámicos (`byZone`, `savedViews`) → `Record`.
- Props de SvelteFlow con tipos estrictos: `nodeTypes`/`CANVAS_EXTENT`/`SMOOTH`
  casteados; `snapToGrid` (no existe en los tipos de la versión) pasado por spread.
- `createConnection(...,null)` → `undefined` (el wrapper espera `string|undefined`).
- types.d.ts: `Zone._count?`. ZoneTabs: props `activeId`(string|number)/zones/counts
  tipados (de paso bajó de 15 a 11; resto en Fase 9). Build ✓.
### Fase 5 — clients/new (57→0), invoices/[id] (47→0), dashboard (47→0)  ✅
- clients/new: `form` como any (campo dinámico `mikrotik.reuseExisting`), estado
  (zonas/plans/routers/ips/profiles/lookup) tipado, 5 catch, params.
- invoices/[id]: invoice `Invoice|null` con captura const en handlers, maps→Record,
  catch, `e.currentTarget` en on:focus, `evidencePhotos ?? []` en template.
- dashboard: `stats` any, casts `any[]` en derivaciones (`?? []` colapsaba a never[]),
  maps→Record, params de reduce/map/sort.
- types.d.ts: `Invoice.wisphubId?`, `InvoiceItem.unitPrice?/amount?`, `Payment.createdBy?`. Build ✓.
### Fase 6 — RegisterPaymentModal (39→0), users (33→0), billing-cycles (40→0), plans (39→0)  ✅
- Mismo patrón: estado tipado (listas a tipos de dominio o any[], editing/form/
  payload como any donde se mutan dinámicamente), catch, mapas→Record, params.
- RegisterPaymentModal: `selected:string[]`, `payFile/payFilePreview`, captura
  `const c = client` en loadMonths/generateMonth, `onFile` con currentTarget,
  quitado `inv.number` (Invoice usa invoiceNumber). Build ✓.
### Fase 7 — payment-links* (37+28+16), invoices (32), system/backups (30), inventory (31) → todos 0  ✅
- Mismo patrón en los 6: estado tipado, catch, mapas→Record, params de helpers.
- types.d.ts: `InventoryItem.client?`. Build ✓.
### Fase 8 — (app)/+layout (23), mikrotik/routers (25)+[id] (20)+page.ts, update/[token] (22), BulkPlanChangeModal (21), zones (19) → todos 0  ✅
- layout: estado tipado, maps→Record, `$user?.role || ''` para isAdmin/canAccess/
  menuForRole, handlers de teclado/click con `e` tipado + cast de e.target.
- routers/[id]/+page.ts: `@type Load` + catch tipado. routers/[id]: `data` any.
- update/[token]: helpers public* tipados, `err` any (campo code), payload Record.
- BulkPlanChangeModal: props Client[]/Plan[], excluded Set, callbacks. Build ✓.
### Fase 9 — componentes ui/ + network/ + layout/ (≤15 c/u) y resto de páginas portal/  ⬜
### Fase 10 — barrido final: archivos con 1–6 errores y warnings a11y (68)  ⬜

> Los conteos por archivo cambian a medida que avanza la Fase 0 (cascada). Tras
> cada fase se re-mide con `npm run check` y se actualiza esta tabla.

---

## Bitácora

| Fecha | Fase | Antes | Después | Notas |
|-------|------|-------|---------|-------|
| 2026-06-20 | infra | 1695 | 1695 | Creado `types.d.ts` + `errores.md`. Sin cambios de conteo aún. |
| 2026-06-20 | 0 (api/) | 1695 | 1520 | Tipada toda la capa `api/*.js` + `client.js`. Capa api limpia. |
| 2026-06-20 | 0 (stores/nav) | 1520 | 1441 | Tipados stores, `navigation.js`, `permissions.js`. Build ✓. 62 archivos restantes. |
| 2026-06-21 | 1 | 1441 | 1150 | clients/[id] 290→0. + props RegisterPaymentModal e isAdmin. Build ✓. |
| 2026-06-21 | 2 | 1150 | 994 | notifications 158→0. Bug toggleSmtpPassword (reveal inexistente) corregido. Build ✓. |
| 2026-06-21 | 3 | 994 | 878 | clients/+page 126→0. + tipo Router.ip. Build ✓. |
| 2026-06-21 | 4 | 878 | 761 | network/+page 117→0. + Zone._count, ZoneTabs props, props SvelteFlow casteados. Build ✓. |
| 2026-06-21 | 5 | 761 | 614 | clients/new + invoices/[id] + dashboard a 0. + Invoice.wisphubId, InvoiceItem.unitPrice/amount, Payment.createdBy. Build ✓. |
| 2026-06-21 | 6 | 614 | 470 | RegisterPaymentModal + users + billing-cycles + plans a 0. Build ✓. |
| 2026-06-21 | 7 | 470 | 331 | payment-links(+[id]+attempt) + invoices/+page + system/backups + inventory a 0. + InventoryItem.client. Build ✓. |
| 2026-06-21 | 8 | 331 | 222 | (app)/+layout + mikrotik/routers(+[id]+page.ts) + update/[token] + BulkPlanChangeModal + zones a 0. Build ✓. |
