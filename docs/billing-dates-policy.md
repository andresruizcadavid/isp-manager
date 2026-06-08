# Política de fechas de facturación — Propuesta técnica

> Las facturas de cada mes vencen el último día del mes (ej. junio → 30).
> El cliente tiene plazo del 25 al último día para pagar.
> Decisiones tomadas vía AskUserQuestion 2026-06-07:
> - Alcance: **GLOBAL** (no per-plan)
> - Migración: **retroactiva sobre PENDING/OVERDUE existentes**
> - Ventana de cobro 25→fin: **auto-crear CollectionWindow recurrente**

---

## 1. Estado actual (lo que rompe esto)

[backend/src/services/billing.service.js:88](backend/src/services/billing.service.js#L88):
```js
const dueDate = new Date(year, month - 1, 15);
```

Hardcoded al **día 15** del mes del período. Sin parámetro de operador. Igual para todos los clientes y planes.

[backend/src/services/auto-collection.service.js](backend/src/services/auto-collection.service.js):
La cobranza automática requiere una `CollectionWindow` activa. Hoy el operador la crea manualmente cada mes — fricción operativa innecesaria si las fechas son siempre las mismas.

---

## 2. Modelo propuesto

### Migración `20260608_add_billing_policy`

```prisma
model BillingPolicy {
  id        String  @id @default("singleton")  // único registro
  // Política de vencimiento:
  //   'LAST_DAY_OF_MONTH' → 30 jun, 31 jul, 28/29 feb, etc.
  //   'DAY_OF_MONTH'      → siempre día N (con clamp si N no existe en el mes)
  dueDateRule        String @default("LAST_DAY_OF_MONTH")
  // Sólo usado cuando dueDateRule = 'DAY_OF_MONTH'. Si el mes no tiene
  // ese día (ej. 31 en febrero), se clampa al último día válido.
  dueDateDayOfMonth  Int    @default(30)

  // Ventana de pago oportuno (parametrizable):
  //   paymentWindowStartDay = 25 → empieza el día 25 del mes del período
  //   paymentWindowEndsAtDueDate = true → termina el día del vencimiento
  paymentWindowStartDay      Int     @default(25)
  paymentWindowEndsAtDueDate Boolean @default(true)

  // Auto-crear CollectionWindow cada mes durante la ventana de cobro.
  // Cuando true, un cron diario chequea si existe la ventana del período
  // corriente y la crea si falta.
  autoCreateCollectionWindow Boolean @default(true)

  // Canales y plantilla por defecto que la auto-window usa al crearse.
  // El operador puede ajustar después si quiere.
  defaultChannels         String[] @default(["WHATSAPP","EMAIL"])
  defaultMessageTemplate  String   @default("Hola {name}, tu factura por {amount} vence el {dueDate}. Recordá realizar tu pago antes de fin de mes para evitar inconvenientes.")
  defaultSendFrequencyHours Int    @default(24)

  updatedAt DateTime @updatedAt
  updatedById String?
  updatedBy   User?  @relation(fields: [updatedById], references: [id], onDelete: SetNull)

  @@map("billing_policies")
}
```

**Por qué un singleton y no `SystemConfig` key-value**: el group de fields está acoplado (cambiar `dueDateRule` puede invalidar `dueDateDayOfMonth`). Un row dedicado tipa todo en Prisma y se valida en una sola transacción.

---

## 3. Cálculo del `dueDate`

```js
// backend/src/services/billing-policy.service.js
function computeDueDate({ year, month, policy }) {
  if (policy.dueDateRule === 'LAST_DAY_OF_MONTH') {
    // Day 0 del próximo mes = último día del mes actual.
    // Funciona automáticamente con bisiestos en febrero.
    return new Date(year, month, 0);
  }
  // DAY_OF_MONTH con clamp para meses cortos (31 → 28/29/30 según mes)
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(policy.dueDateDayOfMonth, lastDay);
  return new Date(year, month - 1, day);
}
```

Reemplaza la línea hardcoded en `billing.service.generateInvoices` por una llamada a este helper. El servicio carga la `BillingPolicy` una vez al inicio y la reutiliza para todo el batch.

---

## 4. Migración retroactiva de facturas pendientes

Script one-shot que corre como parte de la migración Prisma:

```sql
-- Recalcular dueDate de PENDING/OVERDUE/PARTIAL: último día del periodo.
-- Solo si la política nueva es LAST_DAY_OF_MONTH (la del operador).
UPDATE invoices
SET "dueDate" = (DATE_TRUNC('month', make_date("periodYear", "periodMonth", 1))
                 + interval '1 month' - interval '1 day')::date
WHERE status IN ('PENDING', 'OVERDUE', 'PARTIAL')
  AND "periodYear" IS NOT NULL
  AND "periodMonth" IS NOT NULL;
```

**Efectos**:
- Cliente con factura de junio creada el 15-jun con dueDate=15-jun (vencida bajo la política vieja) ahora tiene dueDate=30-jun (al día bajo la nueva)
- Esto puede **sacar** clientes del bucket "OVERDUE" y dejarlos en "PENDING" — el cron `markOverdueInvoices` los re-marcará si llega el 1-jul sin pago. Cambio esperable y bienvenido (la política vieja era injusta).

---

## 5. Auto-creación de `CollectionWindow` recurrente

### Nuevo job: `backend/src/jobs/billing-policy.job.js`

```js
// Cron diario a las 00:05 hora local
cron.schedule('5 0 * * *', async () => {
  const policy = await prisma.billingPolicy.findUnique({ where: { id: 'singleton' } });
  if (!policy?.autoCreateCollectionWindow) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startDay = policy.paymentWindowStartDay;        // 25
  const lastDay = new Date(year, month, 0).getDate();   // 30/31/28
  // Hoy debe estar dentro de la ventana del período actual para que valga la pena
  if (now.getDate() < startDay) return;

  const windowStart = new Date(year, month - 1, startDay, 0, 0, 0);
  const windowEnd   = new Date(year, month - 1, lastDay, 23, 59, 59);

  // Idempotente: si ya existe una ventana cubriendo este rango, no duplicar.
  const existing = await prisma.collectionWindow.findFirst({
    where: { startDate: { lte: windowStart }, endDate: { gte: windowEnd } }
  });
  if (existing) return;

  await prisma.collectionWindow.create({
    data: {
      name: `Cobro ${monthName(month)} ${year}`,
      startDate: windowStart,
      endDate: windowEnd,
      targetStatuses: ['PENDING','OVERDUE','PARTIAL'],
      channels: policy.defaultChannels,
      sendFrequencyHours: policy.defaultSendFrequencyHours,
      messageTemplate: policy.defaultMessageTemplate,
      isActive: true
    }
  });
});
```

**Idempotencia**: el job corre cada día durante la ventana pero solo crea la `CollectionWindow` una vez por período (el query verifica solapamiento).

**Interacción con cron existente** ([auto-collection.job.js](backend/src/jobs/auto-collection.job.js)): este job corre cada hora @ :05 buscando `findActiveNow()`. Una vez creada la ventana, el cron de cobranza la encuentra y empieza a notificar normalmente.

---

## 6. UI — `/invoices/billing-policy`

Nuevo item en Finanzas, **admin-tier only**:

```
┌─────────────────────────────────────────────────────────────────┐
│ Política de facturación                                         │
│ Reglas globales aplicadas a todas las facturas nuevas.          │
├─────────────────────────────────────────────────────────────────┤
│ Vencimiento de factura                                          │
│   ◉ Último día del mes  (Junio → 30, Febrero → 28/29)           │
│   ○ Día específico:  [30 ▾]   (clampa si el mes es más corto)   │
│                                                                 │
│ Ventana de pago oportuno                                        │
│   Inicio: día [25] del mes del período                          │
│   Fin:    día del vencimiento (calculado arriba)                │
│                                                                 │
│ Campaña automática                                              │
│   ☑ Crear CollectionWindow automáticamente cada mes             │
│   Canales por defecto:  [WhatsApp] [Email]                      │
│   Frecuencia min entre recordatorios: [24] h                    │
│   Plantilla del mensaje: [textarea con {name} {amount} {dueDate}]│
├─────────────────────────────────────────────────────────────────┤
│ Próxima ventana automática:                                     │
│   25 de junio 2026 00:00 → 30 de junio 2026 23:59               │
│                                                                 │
│                                       [Guardar]  [Aplicar ya]   │
└─────────────────────────────────────────────────────────────────┘
```

"Aplicar ya" = ejecuta el job de auto-creación de inmediato para no esperar al cron diario.

---

## 7. Roadmap por fases

| Fase | Tareas | Estimado |
|---|---|---|
| 1 | Modelo `BillingPolicy` + migración retroactiva + helper `computeDueDate` + reemplazo en `billing.service` | 2 h |
| 2 | Endpoint GET/PUT `/api/v1/billing-policy` (admin) + zod + service | 1 h |
| 3 | UI editor `/invoices/billing-policy` + nav item | 2 h |
| 4 | Cron `billing-policy.job` + idempotencia + boot test | 1.5 h |
| 5 | Smoke E2E: cambiar política → ver dueDate nuevo en próxima factura → ver CollectionWindow auto-creada el día 25 | 1 h |
| **Total** | | **~7.5 h** |

---

## 8. Riesgos + mitigaciones

| Riesgo | Mitigación |
|---|---|
| Migración retroactiva cambia la realidad de los clientes vencidos | Único momento donde sucede; logueamos cantidad afectada antes de commit. Operador comunica el cambio (cron de cobranza eventualmente cuenta la verdad de nuevo) |
| Operador cambia `dueDateRule` a mitad de mes | Solo afecta a facturas FUTURAS — las existentes mantienen su `dueDate`. UI lo aclara explícitamente |
| Auto-window se crea durante el período pero con plantilla vacía | Defaults en el schema son no-vacíos. Validación zod los exige ≥ 10 chars |
| Cron job corre dos veces a las 00:05 | Idempotencia garantizada por query de solapamiento antes de crear |
| `paymentWindowStartDay` > `lastDay` (ej. 31 en febrero) | Pre-flight clamp en el job: `Math.min(startDay, lastDay - 1)` |

---

## 9. Interacciones con otras features

| Feature existente | Cómo se entera del cambio |
|---|---|
| `bulk-billing` (/invoices/bulk-billing) | Reusa `generateInvoices` → automáticamente toma el nuevo `dueDate` |
| `/clients` (in-row modal Pagar) | El modal no calcula `dueDate`; usa el de la factura ya creada — no requiere cambios |
| Wompi webhook | Lee `Invoice.balanceDue` y `status` — agnóstico de `dueDate` |
| `markOverdueInvoices` cron | Sigue funcionando: marca OVERDUE cuando `now > dueDate` Y `status='PENDING'`. El nuevo dueDate puede mover esta transición pero la lógica no cambia |
| `auto-collection.job` | Sigue buscando `CollectionWindow` activa — ahora la encuentra ya creada por el nuevo cron |
| KPIs en `/invoices` | El KPI `overdueAmount` ya calcula `dueDate < now` server-side — refleja la nueva realidad sin tocar nada |
