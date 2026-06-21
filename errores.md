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

### Fase 1 — clients/[id]/+page.svelte (291)  ⬜
### Fase 2 — notifications/+page.svelte (159)  ⬜
### Fase 3 — clients/+page.svelte (127)  ⬜
### Fase 4 — network/+page.svelte (116)  ⬜
### Fase 5 — clients/new (57), invoices/[id] (47), dashboard (47)  ⬜
### Fase 6 — RegisterPaymentModal (44), users (43), billing-cycles (40), plans (39)  ⬜
### Fase 7 — payment-links* (37+28+16), invoices (32), system/backups (30), inventory (30)  ⬜
### Fase 8 — (app)/+layout (29), mikrotik/routers* (25+20+6), update/[token] (22), BulkPlanChangeModal (21), zones (19)  ⬜
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
