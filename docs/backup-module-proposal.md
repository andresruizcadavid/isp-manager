# Módulo Backup — Propuesta técnica

> Reemplaza "Cuentas MikroTik" en el sidebar. Sub-sección de **Sistema**.
> Decisiones tomadas (vía AskUserQuestion 2026-06-07):
> - Transferencia: **SSH/SCP desde el server**
> - Formato: **Export `.rsc` texto** (no binary)
> - Retención: **últimos 30 por router, filesystem local**

---

## 1. Cómo funciona en RouterOS (verificable)

Comandos relevantes (RouterOS API ≥ 6, validado en docs oficiales):

```
/export file=isp-mgr-2026-06-07-153012 compact          # texto, sin defaults
```

Esto genera `isp-mgr-2026-06-07-153012.rsc` en el filesystem del router. Es **texto plano**, legible y diffable; **NO** incluye contraseñas wifi ni certificados (para esos hace falta backup binario, descartado en esta iteración).

Para sacarlo del router por SSH/SCP (el método aprobado): RouterOS tiene SSH server (`/ip ssh enabled=yes`). El server pull con:

```
scp -P 22 -i /opt/isp-manager/secrets/router_<id>.key admin@<routerIp>:isp-mgr-<ts>.rsc /opt/isp-manager/backups/router-<id>/<ts>.rsc
```

Una vez copiado, el server borra el archivo del router (`/file remove isp-mgr-<ts>.rsc` vía API) para no llenar el disco del MikroTik.

---

## 2. Modelo de datos

### Migración `20260608_add_router_backups`

```prisma
model RouterBackup {
  id           String   @id @default(cuid())
  routerId     Int
  fileName     String                          // "20260607-153012.rsc"
  filePath     String                          // ruta absoluta en /opt/isp-manager/backups
  sizeBytes    Int      @default(0)
  startedAt    DateTime @default(now())
  completedAt  DateTime?
  status       String                          // 'pending' | 'success' | 'failed'
  errorMessage String?
  triggeredBy  String                          // 'cron' | 'manual'
  createdById  String?                         // operator if manual

  router    Router @relation(fields: [routerId], references: [id], onDelete: Cascade)
  createdBy User?  @relation(fields: [createdById], references: [id], onDelete: SetNull)

  @@index([routerId, startedAt])
  @@map("router_backups")
}

model RouterBackupSchedule {
  id              String   @id @default(cuid())
  routerId        Int      @unique             // 1:1 — un schedule por router
  isActive        Boolean  @default(true)
  cronExpression  String                       // "0 3 * * *" → 03:00 diario
  lastRunAt       DateTime?
  nextRunAt       DateTime?
  retentionCount  Int      @default(30)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  router Router @relation(fields: [routerId], references: [id], onDelete: Cascade)
  @@map("router_backup_schedules")
}
```

`Router.sshPort` y `Router.sshKeyPath` ya existen (o se agregan en la migración) — credenciales para SCP.

---

## 3. Endpoints

| Método | Ruta | Quién la consume |
|---|---|---|
| `GET` | `/api/v1/backups` | Listado paginado con filtro `?routerId=` |
| `GET` | `/api/v1/backups/:id` | Detalle |
| `GET` | `/api/v1/backups/:id/download` | Stream del `.rsc` (Content-Disposition attachment) |
| `POST` | `/api/v1/backups/run/:routerId` | Trigger manual desde UI |
| `DELETE` | `/api/v1/backups/:id` | Borrar manualmente |
| `GET` | `/api/v1/backups/schedules` | Listado de schedules |
| `PUT` | `/api/v1/backups/schedules/:routerId` | Editar (cron, retentionCount, isActive) |

Permisos: `requireAdmin` en todas. Backups contienen credenciales que el operador-base no debería ver.

---

## 4. Servicio + cron

### `backend/src/services/backup.service.js`

```js
export async function runBackup(routerId, triggeredBy = 'manual', userId = null) {
  // 1. Lookup router + SSH credentials.
  // 2. Insert RouterBackup row with status='pending'.
  // 3. Call /export via RouterOS API → returns once file exists on router.
  // 4. SCP from router → /opt/isp-manager/backups/router-<id>/<ts>.rsc
  //    (uses node-ssh or child_process.spawn('scp', [...])).
  // 5. /file remove on router via RouterOS API.
  // 6. Update row: status='success', sizeBytes, completedAt.
  // 7. Rotate: keep only retentionCount most recent, delete files + DB rows.
  // On any failure → status='failed', errorMessage set, no cleanup of partial files.
}

export async function rotateBackups(routerId, keep) { /* drop oldest beyond `keep` */ }
```

### `backend/src/jobs/backup.job.js`

```js
// Tick cada minuto: lista RouterBackupSchedule donde isActive=true AND
// nextRunAt <= NOW(). Por cada uno: dispara runBackup en background y
// actualiza lastRunAt + nextRunAt (calculado vía cron-parser).
cron.schedule('* * * * *', tick);
```

Overlap-guarded con un `Set<routerId>` en memoria — si una corrida tarda 90 segundos, los ticks intermedios skipean ese router.

---

## 5. UI — `/system/backups`

```
┌──────────────────────────────────────────────────────────────────┐
│ Backup MikroTik                                                  │
├──────────────────────────────────────────────────────────────────┤
│ Router: [10.2.2.2 ▾]                                             │
│                                                                  │
│ Programación:                                                    │
│   ☑ Activa                                                       │
│   Cron: [0 3 * * *  ▾]   (preset: diario 03:00, semanal, custom) │
│   Retención: últimos [30] archivos                               │
│   Último run: 2026-06-07 03:00 · OK · 14 KB                      │
│   Próximo:    2026-06-08 03:00                                   │
│   [ Guardar ]  [ Lanzar ahora ]                                  │
├──────────────────────────────────────────────────────────────────┤
│ Historial (últimos 30)                                           │
│ Fecha               Estado    Tamaño   Acción                    │
│ 2026-06-07 03:00    ✓ OK      14.2 KB  [↓ Descargar] [Eliminar]  │
│ 2026-06-06 03:00    ✓ OK      14.1 KB  [↓ Descargar] [Eliminar]  │
│ 2026-06-05 03:00    ✗ Falló   —        Ver error                 │
│ ...                                                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## 6. Estructura de archivos en disco

```
/opt/isp-manager/backups/
  router-1/
    20260607-030001.rsc
    20260606-030002.rsc
    ...
  router-2/
    20260607-030005.rsc
    ...
```

- Permisos: `chown isp:isp`, `chmod 600` (solo el usuario que corre PM2)
- Mounted en el volumen del server, no en `/tmp`
- Backup del propio Postgres con `pg_dump` ya cubre la DB; los `.rsc` se respaldan junto con el resto del filesystem del server vía herramientas externas (no scope acá)

---

## 7. Nav + permisos

- `navigation.js`: nuevo item `{ id: 'backups', label: 'Backup', href: '/system/backups', parentId: 'group-system', roles: ADMIN_TIER }`
- Reemplaza `mikrotik-accounts` actual o vive al lado — TBD según uso real de Cuentas MikroTik
- Solo ADMIN_TIER ve la sección (los backups contienen credenciales)

---

## 8. Esfuerzo estimado

| Fase | Tareas | Estimado |
|---|---|---|
| 1 | Schema + migración + service + endpoint `POST /backups/run/:routerId` + UI "Lanzar ahora" + descarga | 4 h |
| 2 | Schedule + cron + UI editor (cron-parser para next-run preview) | 3 h |
| 3 | Listado + filtros + paginación + delete | 2 h |
| 4 | Rotation + tests + smoke con un router real | 2 h |
| **Total** | | **~11 h** |

---

## 9. Riesgos + mitigaciones

| Riesgo | Mitigación |
|---|---|
| SSH credenciales en DB | Los keys quedan en `/opt/isp-manager/secrets/`, la DB solo guarda la ruta. Permisos 600 |
| Router sin SSH habilitado | Pre-flight check al guardar el schedule; mensaje claro |
| Disco lleno por backups acumulados | `retentionCount` por defecto 30, validar en pre-flight que hay espacio |
| Cron solapado con backup en curso | `Set<routerId>` en memoria como mutex |
| Backup parcial si SCP falla a mitad | `status='failed'` + el `.rsc` parcial en disco se borra en cleanup; el siguiente tick reintenta |
| Network glitch entre server y router | Reintento exponencial 3 veces dentro del job antes de marcar failed |

---

## 10. Por qué `.rsc` y no `.backup` binario

Pros del `.rsc` texto (elegido):
- **Legible y auditable** — el operador puede ver qué cambió entre dos backups con `diff`
- **Restauración selectiva** — copiar/pegar sólo una sección en otro router
- **Versionable** — guardar en git si se quisiera (no se hará en esta iter)
- **Liviano** — típicamente 5–50 KB

Cons (asumidos):
- **NO** restaura wifi keys ni certificados — operador los re-emite si hace falta
- **NO** restaura logs ni estadísticas — sólo config

Esto es lo correcto para nuestro use case: restaurar config tras un cambio fallido, no DR completo del router.
