# Design Rules — ISP Manager

Reglas de identidad visual y contraste. Todo cambio de UI debe respetar estas
reglas. La paleta vive en
[`frontend/tailwind.config.js`](frontend/tailwind.config.js) como tokens
`brand.*`, `text.*` y `surface.*`.

## Paleta oficial

### Brand (azules)
| Token | Hex | Uso |
|---|---|---|
| `brand-900` | `#1a2f7a` | Hover/pressed de elementos en sidebar |
| `brand-800` | `#1e3a8a` | Fondo de sidebar, botón primario, badges activos |
| `brand-700` | `#2040a0` | Hover de items de sidebar |
| `brand-600` | `#2C4EC7` | **Color principal de marca** — fondo del login, item activo en nav, focus rings |
| `brand-500` | `#3b63d4` | Hover de botones, gradientes |
| `brand-400` | `#6b8fe8` | Iconos sutiles, acentos claros |
| `brand-200` | `#a8c0f4` | Sub-nav inactivo sobre fondo oscuro |
| `brand-100` | `#dde8ff` | Texto secundario sobre fondo oscuro, backgrounds sutiles |
| `brand-50`  | `#f0f4ff` | Casi blanco azulado para fondos de página alternos |

### Texto
| Token | Hex | Uso |
|---|---|---|
| `text-primary` | `#0f172a` | Texto principal sobre fondo blanco/claro |
| `text-secondary` | `#475569` | Subtítulos y descripciones sobre fondo blanco/claro |
| `text-muted` | `#94a3b8` | **Solo sobre blanco** — placeholders, hints discretos |
| `text-inverse` | `#ffffff` | Texto sobre fondo oscuro/brand |
| `text-inverse-muted` | `#bfcfee` | Subtextos sobre fondo `brand-800`/`brand-900` |

### Superficies
| Token | Hex | Uso |
|---|---|---|
| `surface-page` | `#f8fafc` | Fondo general del área de contenido |
| `surface-card` | `#ffffff` | Cards, modales, topbar |
| `surface-sidebar` | `#1e3a8a` | Fondo del sidebar (alias de `brand-800`) |

## Reglas de contraste (WCAG AA — ratio ≥ 4.5:1)

| Fondo | Texto permitido | Prohibido |
|---|---|---|
| `brand-800` / `surface-sidebar` | `text-white`, `text-brand-100`, `text-brand-200` | `text-slate-400`, `text-slate-500`, `text-gray-*` |
| `brand-600` (botón / login) | `text-white`, `text-brand-50` | Cualquier gris |
| `brand-900` (hover oscuro) | `text-white` | Todo lo demás |
| `white` / `surface-card` / `surface-page` | `text-text-primary`, `text-text-secondary`, `text-text-muted` | `text-white`, `text-brand-100`, cualquier color claro |

### Casos típicos prohibidos
- Sidebar con fondo oscuro y `text-slate-400` (ratio insuficiente).
- Subtítulo en card blanco con `text-white` (invisible).
- Placeholder con `text-text-muted` sobre fondo oscuro (ilegible).

## Convenciones de uso

### Sistema de botones (variantes únicas)

| Situación | Clase | Color resultante | Ejemplo |
|---|---|---|---|
| Crear / Guardar / Confirmar / Iniciar Sesión / Pagar | `.btn-primary` | Azul `#2C4EC7` (brand-600) sólido + texto blanco | "+ Nueva Zona", "Registrar Pago" |
| Volver / Cancelar / Acción complementaria | `.btn-secondary` | Outline `brand-600` (border + texto azul, fondo transparente) | "← Volver a Clientes", "Cancelar" |
| Eliminar / Borrar | `.btn-danger` | Rojo `#dc2626` sólido + texto blanco | "Eliminar cliente" |
| Alerta bloqueante / Acción requerida | `.btn-warning` | Ámbar `#f59e0b` sólido + texto blanco | "📍 Ir a Zonas" cuando no hay zonas configuradas |
| Link interno discreto / icono de tabla | `.btn-ghost` | Texto `brand-600` sin fondo, hover azul claro | "Ver detalle" inline |
| Icono cuadrado en tabla | `.btn-icon` | Gris discreto + hover slate | acciones de fila |

Todos los botones deben:
- Tener `min-h-[44px]` en móvil (`<sm`) — guideline táctil Apple/Google.
- Tener feedback táctil `active:scale-[0.98]` (excepto `.btn-icon` que usa `scale-95`).
- Usar `bg-brand-600` para el estado normal del primario, `brand-700` para hover, `brand-800` para pressed (`active:`).

### REGLA GLOBAL: prohibido el verde en botones de acción

`green-*`, `emerald-*`, `teal-*` están **prohibidos como fondo de botón CTA**.
Solo se permite verde para:
- Indicadores de estado: badge "Activo", dot "Sistema en línea"
- Iconos de KPI/status tile (`.icon-square-green`)
- Backgrounds soft de notificación (`bg-green-50/border-green-200` en alerts)

**Excepción documentada**: El chip "WhatsApp" en `/clients/[id]` mantiene `bg-emerald-50` porque es el color de marca reconocible del servicio externo, no una acción del sistema.

### Inputs y selects
- Borde inactivo: `border-slate-200`.
- Focus: `border-brand-600` + `ring-brand-600/20`.
- Placeholder: `placeholder:text-text-muted`.

### Sidebar
- Fondo: `bg-brand-800`. **Nunca** negro ni slate oscuro.
- Item activo: `bg-brand-600 text-white font-semibold`.
- Item inactivo: `text-brand-100 hover:bg-brand-700 hover:text-white`.
- Sub-item activo: `text-white bg-brand-600 font-medium`.
- Sub-item inactivo: `text-brand-200 hover:text-white hover:bg-brand-700`.

### Login
- Fondo de pantalla: `bg-brand-600` (#2C4EC7).
- Card centrado: `bg-white max-w-sm rounded-2xl shadow-2xl`.
- Logo dentro del card: cuadrado `bg-brand-600` con icono blanco.
- Botón principal: `bg-brand-800 hover:bg-brand-900`.

## Checklist al revisar PRs

- [ ] ¿Algún `text-slate-400`/`text-slate-500`/`text-gray-*` aparece sobre fondo `brand-800`/`brand-900`/`brand-700`?
- [ ] ¿Algún `text-white`/`text-brand-100` aparece sobre fondo blanco/claro?
- [ ] ¿Los botones nuevos usan `.btn-primary`/`.btn-secondary` (no `bg-blue-*` ni `bg-indigo-*` hardcoded)?
- [ ] ¿Los inputs nuevos usan `.input` (no clases ad-hoc que rompan el focus ring)?
- [ ] ¿Hay hex literales (`bg-[#...]`) que deberían usar tokens?
- [ ] ¿Algún botón usa `bg-green-*`/`bg-emerald-*`/`bg-teal-*` como CTA? → migrar a `.btn-primary` (o `.btn-warning` si es estado bloqueante).
- [ ] ¿Algún botón usa `bg-brand-800` directamente? Solo se justifica para indicadores no interactivos (pagination chip activo, stepper); CTAs deben usar `.btn-primary` (brand-600).

## Herramientas de validación

- **Manual**: Chrome DevTools → Inspect → "Contrast" en el panel Accessibility.
- **CLI** (opcional, no instalado por defecto): `npx pa11y http://localhost:5173` para auditar páginas individuales.
- **Plugin tailwind-eslint**: `eslint-plugin-tailwindcss` valida orden y existencia de clases, pero NO contrast. La validación de contraste sigue siendo manual o vía herramientas axe/Lighthouse.

## Notas de migración (mayo 2026)

- Sidebar antes era `bg-[#0f1117]` (slate-950) con `text-slate-400` → contraste insuficiente. Migrado a `bg-brand-800` con `text-brand-100`/`text-white`.
- Login antes usaba `bg-[#1e3a8a]` (brand-800) → migrado a `bg-brand-600` (#2C4EC7) por consistencia con la referencia visual.
- Hex literales `bg-[#1e3a8a]` reemplazados por `bg-brand-800` en todo el código.
- **Botones de pago (`bg-emerald-600 "Pagar/Registrar Pago"`) → migrados a `.btn-primary` (brand-600)** — la lógica positiva del pago no justifica romper la paleta azul.
- **Botones "+ Nueva Zona" / "+ Crear primera zona" (`bg-green-600`) → `.btn-primary`** — eran los últimos verdes de marca incoherente.
- **`.btn-primary` cambió de `brand-800` a `brand-600`** — todos los CTAs son ahora brand-600 (más vibrante). El `brand-800` queda reservado para sidebar bg, hover states y pressed (`active:`).
- **`.btn-secondary` pasó de "white + border-slate" a "outline brand-600"** — más visible, lee claramente como acción secundaria sin competir con el primario.
- **`.btn-danger` pasó de soft (`bg-red-50`) a sólido (`bg-red-600`)** — acciones destructivas reales (Eliminar) ahora son visualmente más serias.
- **Nueva `.btn-warning`** (`bg-amber-500`) — para estados bloqueantes/acción requerida (ej: "Ir a Zonas" cuando no hay zonas configuradas).
