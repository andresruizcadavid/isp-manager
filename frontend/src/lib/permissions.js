/**
 * Permissions — single source of truth for role-based access control.
 *
 * Two real roles drive the system:
 *   • ADMIN       — full access (and legacy OPERATOR rows map here).
 *   • TECHNICIAN  — field user: clients, zones, evidence, dashboard.
 *
 * Permission decisions happen in three places:
 *   1. Sidebar (which items render)         — sidebarFor(role)
 *   2. Route guard (which URLs allowed)     — canAccess(path, role)
 *   3. Backend (enforced regardless of UI)  — see auth.middleware.js
 *
 * The frontend MUST NOT be the source of truth — every gated UI action
 * also has a server-side role check. This file just keeps the UX coherent.
 */

export const ROLES = {
  ADMIN:      'ADMIN',
  OPERATOR:   'OPERATOR',   // legacy, treated as ADMIN-tier
  TECHNICIAN: 'TECHNICIAN',
  VIEWER:     'VIEWER',     // legacy, read-only
};

// "Admin-tier" — full access. Includes legacy OPERATOR for back-compat.
export const ADMIN_TIER = [ROLES.ADMIN, ROLES.OPERATOR];

// "Operational tier" — admins + technicians.
export const OPERATIONAL_TIER = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.TECHNICIAN];

/** Returns true if the user has admin-level privileges. */
export function isAdmin(role) {
  return ADMIN_TIER.includes(role);
}

/** Route → roles map. Longest-prefix wins. Paths NOT listed are public. */
const ROUTE_ROLES = {
  '/dashboard':         OPERATIONAL_TIER,
  '/clients':           OPERATIONAL_TIER,
  '/zones':             OPERATIONAL_TIER,
  '/invoices':          ADMIN_TIER,
  '/payments':          ADMIN_TIER,
  '/plans':             ADMIN_TIER,
  '/mikrotik':          ADMIN_TIER,
  '/reports':           ADMIN_TIER,
  '/settings':          ADMIN_TIER,
  '/users':             ADMIN_TIER,
  '/notifications':     ADMIN_TIER,
  '/network':           OPERATIONAL_TIER,
};

/** Decide if a role can navigate to a path. */
export function canAccess(path, role) {
  if (!role) return false;
  const matches = Object.keys(ROUTE_ROLES)
    .filter(p => path === p || path.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length);
  if (matches.length === 0) return true; // unmapped → permitted (e.g. /forbidden)
  return ROUTE_ROLES[matches[0]].includes(role);
}

/**
 * Sidebar menu definition. Each section + each item carries its role list.
 * The sidebar component filters by the current user's role at render time.
 */
export const MENU = [
  // Top-level (no section grouping)
  {
    key: null,
    items: [
      { href: '/dashboard', label: 'Dashboard', roles: OPERATIONAL_TIER }
    ]
  },
  {
    key: 'clientes', label: 'Clientes',
    roles: OPERATIONAL_TIER,
    items: [
      { href: '/clients',     label: 'Lista de Clientes', roles: OPERATIONAL_TIER },
      { href: '/clients/new', label: 'Agregar Cliente',   roles: OPERATIONAL_TIER },
      { href: '/zones',       label: 'Zonas / Sectores',  roles: OPERATIONAL_TIER },
    ]
  },
  {
    key: 'finanzas', label: 'Finanzas',
    roles: ADMIN_TIER,
    items: [
      { href: '/invoices',     label: 'Facturas',         roles: ADMIN_TIER },
      { href: '/payments',     label: 'Pagos Recibidos',  roles: ADMIN_TIER },
      { href: '/payments/new', label: 'Registrar Pago',   roles: ADMIN_TIER },
    ]
  },
  {
    key: 'sistema', label: 'Sistema',
    roles: ADMIN_TIER,
    items: [
      { href: '/mikrotik/routers',  label: 'Routers / NOC',     roles: ADMIN_TIER },
      { href: '/plans',             label: 'Planes de Servicio', roles: ADMIN_TIER },
      { href: '/mikrotik/accounts', label: 'Cuentas MikroTik',  roles: ADMIN_TIER },
    ]
  },
  {
    key: 'monitor', label: 'Monitor de Red',
    roles: OPERATIONAL_TIER,
    items: [
      { href: '/network',          label: 'Mapa de Red',           roles: OPERATIONAL_TIER },
      { href: '/network/events',   label: 'Historial de Eventos',  roles: OPERATIONAL_TIER },
      { href: '/network/settings', label: 'Alertas Telegram',      roles: ADMIN_TIER },
    ]
  },
  {
    key: 'empresa', label: 'Administración',
    roles: ADMIN_TIER,
    items: [
      { href: '/users',         label: 'Usuarios del Sistema',      roles: ADMIN_TIER },
      { href: '/notifications', label: 'Centro de Notificaciones',  roles: ADMIN_TIER },
    ]
  },
];

/** Filter the MENU tree to only what the given role can see. */
export function sidebarFor(role) {
  return MENU
    .map(section => {
      // Section visibility: if role list given, gate it.
      if (section.roles && !section.roles.includes(role)) return null;
      const items = (section.items || []).filter(it => !it.roles || it.roles.includes(role));
      if (items.length === 0) return null;
      return { ...section, items };
    })
    .filter(Boolean);
}
