// Navigation — single source of truth for sidebar + topbar + route guard.
//
// Every leaf navigation item carries:
//   • id          stable identifier used by helpers + tests
//   • label       short label for the sidebar
//   • title       string OR (path) => string used by the topbar / document title
//   • href        canonical URL (the one the sidebar links to)
//   • icon        lucide-svelte component (optional, only for top-level / group)
//   • parentId    id of the parent group (optional)
//   • roles       role array allowed to see this item
//   • match       string OR RegExp OR array of either — patterns that mark
//                 this item as "active" for the current pathname. Strings
//                 are matched STRICTLY (exact equality) so a more specific
//                 sibling always wins over a less specific one. Use a
//                 RegExp for parameterised routes (e.g. /clients/[id]).
//
// Group items have `type: 'group'` and no href; they aggregate children.
//
// Three reasons this file exists:
//   1. The previous layout used Object.entries + startsWith on three
//      separate maps (MENU, ROUTE_ROLES, getTitle table). They drifted.
//   2. startsWith('/clients/') matched /clients/new — multiple items
//      were "active" simultaneously.
//   3. Title lookup via inline {getTitle()} wasn't reactive to $page.

import {
  LayoutDashboard, Users, Router as RouterIcon, Network, CreditCard,
  Building2, Activity
} from 'lucide-svelte';

// ── Roles ──────────────────────────────────────────────────────────────
export const ROLES = {
  ADMIN:      'ADMIN',
  OPERATOR:   'OPERATOR',   // legacy admin-tier
  TECHNICIAN: 'TECHNICIAN',
  VIEWER:     'VIEWER'      // legacy read-only
};

export const ADMIN_TIER       = [ROLES.ADMIN, ROLES.OPERATOR];
export const OPERATIONAL_TIER = [ROLES.ADMIN, ROLES.OPERATOR, ROLES.TECHNICIAN];

export function isAdmin(role) { return ADMIN_TIER.includes(role); }

// ── NAV registry ───────────────────────────────────────────────────────
// Helpers for compact match expressions. Strings match strict-equal.
// `under(prefix)` matches the prefix exactly OR any sub-route. Use this
// for index pages whose subroutes (/[id], /edit) should keep the parent
// item active, but NOT when there's a sibling that already covers the
// sub-route (the resolver handles disambiguation — see below).
const under = (prefix) => new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/[^?]*)?$`);

export const NAV_ITEMS = [
  // ── Standalone top-level ─────────────────────────────────────────
  { id: 'dashboard', type: 'item',
    label: 'Dashboard', title: 'Dashboard',
    href: '/dashboard', icon: LayoutDashboard, roles: OPERATIONAL_TIER,
    match: ['/dashboard'] },

  // ── Clientes ─────────────────────────────────────────────────────
  { id: 'group-clients', type: 'group',
    label: 'Clientes', icon: Users, roles: OPERATIONAL_TIER },

  { id: 'clients', type: 'item', parentId: 'group-clients',
    label: 'Lista de Clientes',
    // Title is contextual: list page vs detail page.
    title: (p) => p === '/clients' ? 'Clientes' : 'Detalle del Cliente',
    href: '/clients', roles: OPERATIONAL_TIER,
    // Match: /clients exactly, OR /clients/<id> (NOT /clients/new).
    // The negative lookahead excludes /clients/new so its sibling wins.
    match: ['/clients', /^\/clients\/(?!new)[^/]+(\/.*)?$/] },

  { id: 'clients-new', type: 'item', parentId: 'group-clients',
    label: 'Agregar Cliente', title: 'Agregar Cliente',
    href: '/clients/new', roles: OPERATIONAL_TIER,
    match: ['/clients/new'] },

  { id: 'zones', type: 'item', parentId: 'group-clients',
    label: 'Zonas / Sectores', title: 'Zonas / Sectores',
    href: '/zones', roles: OPERATIONAL_TIER,
    match: ['/zones', under('/zones')] },

  // Moved from Clientes → Finanzas (objective 3 of the collections sweep):
  // bulk operations on customers are financial flows operationally; their
  // history belongs alongside Facturas / Pagos / Ventanas de cobranza.
  { id: 'invoices-bulk-history', type: 'item', parentId: 'group-finance',
    label: 'Historial masivo', title: 'Historial de cobros masivos',
    href: '/invoices/bulk-history', roles: ADMIN_TIER,
    match: ['/invoices/bulk-history'] },

  // ── Finanzas ─────────────────────────────────────────────────────
  { id: 'group-finance', type: 'group',
    label: 'Finanzas', icon: CreditCard, roles: ADMIN_TIER },

  { id: 'invoices', type: 'item', parentId: 'group-finance',
    label: 'Facturas',
    title: (p) => p === '/invoices' ? 'Facturas' : 'Detalle de Factura',
    href: '/invoices', roles: ADMIN_TIER,
    match: ['/invoices', /^\/invoices\/[^/]+(\/.*)?$/] },

  { id: 'billing-cycles', type: 'item', parentId: 'group-finance',
    label: 'Ciclos de cobro', title: 'Ciclos de cobro',
    href: '/invoices/billing-cycles', roles: ADMIN_TIER,
    match: ['/invoices/billing-cycles'] },

  { id: 'collection-windows', type: 'item', parentId: 'group-finance',
    label: 'Ventanas de cobranza', title: 'Ventanas de cobranza',
    href: '/invoices/collection-windows', roles: ADMIN_TIER,
    match: ['/invoices/collection-windows', /^\/invoices\/collection-windows\/[^/]+$/] },

  // Month-driven mass billing flow (FASE 2 hybrid — selection-driven
  // version remains in /clients via the modal). Strict match so the
  // parent /invoices regex doesn't shadow it.
  { id: 'bulk-billing', type: 'item', parentId: 'group-finance',
    label: 'Cobro masivo', title: 'Cobro masivo por mes',
    href: '/invoices/bulk-billing', roles: ADMIN_TIER,
    match: ['/invoices/bulk-billing'] },

  // ── Sistema ──────────────────────────────────────────────────────
  { id: 'group-system', type: 'group',
    label: 'Sistema', icon: RouterIcon, roles: ADMIN_TIER },

  { id: 'routers', type: 'item', parentId: 'group-system',
    label: 'Routers / NOC',
    title: (p) => {
      if (p === '/mikrotik/routers')           return 'Routers / NOC';
      if (p === '/mikrotik/routers/new')       return 'Agregar Router';
      return 'Detalle Router';
    },
    href: '/mikrotik/routers', roles: ADMIN_TIER,
    match: ['/mikrotik/routers', under('/mikrotik/routers')] },

  { id: 'plans', type: 'item', parentId: 'group-system',
    label: 'Planes de Servicio', title: 'Planes de Servicio',
    href: '/plans', roles: ADMIN_TIER,
    match: ['/plans', under('/plans')] },

  { id: 'backups', type: 'item', parentId: 'group-system',
    label: 'Backup', title: 'Backup MikroTik',
    href: '/system/backups', roles: ADMIN_TIER,
    match: ['/system/backups'] },

  // ── Monitor de Red ───────────────────────────────────────────────
  { id: 'group-monitor', type: 'group',
    label: 'Monitor de Red', icon: Activity, roles: OPERATIONAL_TIER },

  { id: 'network', type: 'item', parentId: 'group-monitor',
    label: 'Mapa de Red', title: 'Mapa de Red',
    href: '/network', roles: OPERATIONAL_TIER,
    match: ['/network'] },

  { id: 'network-events', type: 'item', parentId: 'group-monitor',
    label: 'Historial de Eventos', title: 'Historial de Eventos',
    href: '/network/events', roles: OPERATIONAL_TIER,
    match: ['/network/events'] },

  { id: 'network-settings', type: 'item', parentId: 'group-monitor',
    label: 'Alertas Telegram', title: 'Alertas Telegram',
    href: '/network/settings', roles: ADMIN_TIER,
    match: ['/network/settings'] },

  // ── Administración ───────────────────────────────────────────────
  { id: 'group-admin', type: 'group',
    label: 'Administración', icon: Building2, roles: ADMIN_TIER },

  { id: 'users', type: 'item', parentId: 'group-admin',
    label: 'Usuarios del Sistema', title: 'Usuarios del Sistema',
    href: '/users', roles: ADMIN_TIER,
    match: ['/users', under('/users')] },

  { id: 'notifications', type: 'item', parentId: 'group-admin',
    label: 'Centro de Notificaciones', title: 'Centro de Notificaciones',
    href: '/notifications', roles: ADMIN_TIER,
    match: ['/notifications', under('/notifications')] },

  { id: 'payment-links', type: 'item', parentId: 'group-admin',
    label: 'Trazabilidad Wompi', title: 'Trazabilidad Wompi',
    href: '/payment-links', roles: ADMIN_TIER,
    match: ['/payment-links', under('/payment-links')] },

  { id: 'reports', type: 'item', parentId: 'group-admin',
    label: 'Reportes', title: 'Reportes',
    href: '/reports', roles: ADMIN_TIER,
    match: ['/reports', under('/reports')] },

  // ── Routes that are NOT in the sidebar but still need a title ───
  // Pure title-only entries. type:'alias' is skipped by menuForRole.
  { id: 'mikrotik-hub', type: 'alias',
    title: 'MikroTik', match: ['/mikrotik'] },
  { id: 'forbidden', type: 'alias',
    title: 'Acceso denegado', match: ['/forbidden'] }
];

// ── Resolution helpers ────────────────────────────────────────────────

/** Test whether a given match pattern (string or RegExp) matches a path. */
function matches(pattern, pathname) {
  if (typeof pattern === 'string') return pathname === pattern;
  if (pattern instanceof RegExp)   return pattern.test(pathname);
  return false;
}

/** Test whether an item's `match` patterns cover the given pathname. */
export function isItemActive(item, pathname) {
  if (!item?.match) return false;
  const list = Array.isArray(item.match) ? item.match : [item.match];
  for (const p of list) if (matches(p, pathname)) return true;
  return false;
}

/**
 * Find the most specific item that matches the pathname. "Most specific"
 * = the longest string-match; if no string match, the first RegExp match
 * in declaration order. This is what makes sibling specialisations (e.g.
 * /clients/new beating /clients) work — we pick the literal-string match
 * before falling back to the broader RegExp.
 */
export function resolveActive(pathname) {
  if (!pathname) return null;
  let bestStrict = null;
  let bestStrictLen = -1;
  let firstRegex = null;
  for (const item of NAV_ITEMS) {
    if (item.type === 'group') continue;
    if (!item.match) continue;
    const list = Array.isArray(item.match) ? item.match : [item.match];
    for (const p of list) {
      if (typeof p === 'string' && pathname === p) {
        if (p.length > bestStrictLen) {
          bestStrictLen = p.length;
          bestStrict = item;
        }
      } else if (p instanceof RegExp && p.test(pathname) && !firstRegex) {
        firstRegex = item;
      }
    }
  }
  return bestStrict || firstRegex || null;
}

/** Resolve the parent group of an item (for sidebar auto-expand). */
export function resolveParent(item) {
  if (!item?.parentId) return null;
  return NAV_ITEMS.find(i => i.id === item.parentId) || null;
}

/** Page title from the active item, falling back to a sane default. */
export function resolveTitle(pathname) {
  const item = resolveActive(pathname);
  if (!item) return 'ISP Manager';
  if (typeof item.title === 'function') return item.title(pathname);
  if (typeof item.title === 'string')   return item.title;
  return item.label || 'ISP Manager';
}

// ── Sidebar tree builder ──────────────────────────────────────────────

/** Build the menu tree the sidebar renders, filtered by role.
 *  Output is a flat array of "sections" preserving NAV_ITEMS order:
 *    { type:'item',  item }                 — standalone top-level
 *    { type:'group', group, items: [...]  } — collapsible group
 */
export function menuForRole(role) {
  if (!role) return [];
  const items = NAV_ITEMS.filter(i => i.type !== 'alias' && i.roles?.includes(role));
  const groups = new Map();
  const out = [];
  for (const item of items) {
    if (item.type === 'group') {
      groups.set(item.id, { type: 'group', group: item, items: [] });
      out.push(groups.get(item.id));
    } else if (item.parentId) {
      const g = groups.get(item.parentId);
      if (g) g.items.push(item);
    } else {
      out.push({ type: 'item', item });
    }
  }
  // Drop empty groups (a group with no role-allowed children stays hidden).
  return out.filter(s => s.type !== 'group' || s.items.length > 0);
}

// ── Route guard ───────────────────────────────────────────────────────

/** True if the role can navigate to the pathname. Derived from NAV_ITEMS
 *  so it's always in sync with the menu visibility. Unmapped paths are
 *  permitted (e.g. /forbidden, /update/[token]). */
export function canAccess(pathname, role) {
  if (!role) return false;
  const item = resolveActive(pathname);
  if (!item) return true;             // unmapped — no policy, allow
  return item.roles?.includes(role) ?? true;
}
