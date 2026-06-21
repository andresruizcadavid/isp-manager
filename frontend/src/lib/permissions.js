/**
 * Permissions — thin wrapper over `navigation.js`.
 *
 * Historical surface for callers that import { canAccess, sidebarFor, ROLES,
 * isAdmin, ADMIN_TIER, OPERATIONAL_TIER } from '$lib/permissions.js'. The
 * actual source of truth (route → roles, sidebar tree, page titles) lives
 * in `navigation.js`. This file just re-exports + adapts shapes so existing
 * imports keep working without a sweep.
 *
 * NEW CODE should import from `$lib/navigation.js` directly.
 */

import {
  ROLES,
  ADMIN_TIER,
  OPERATIONAL_TIER,
  isAdmin,
  canAccess,
  menuForRole
} from './navigation.js';

export { ROLES, ADMIN_TIER, OPERATIONAL_TIER, isAdmin, canAccess };

/** Legacy adapter — the old layout iterated `[{ key, label, items: [...] }, ...]`.
 *  Map our flat tree onto that shape so any leftover callers keep working.
 *  @param {string} role */
export function sidebarFor(role) {
  const tree = menuForRole(role);
  const out = [];
  for (const node of tree) {
    if (node.type === 'item') {
      // Wrap standalone items in a section with key:null (old contract).
      const last = out[out.length - 1];
      if (last && last.key === null) {
        last.items.push({ href: node.item.href, label: node.item.label, roles: node.item.roles });
      } else {
        out.push({ key: null, items: [{ href: node.item.href, label: node.item.label, roles: node.item.roles }] });
      }
    } else if (node.type === 'group') {
      out.push({
        key:   node.group.id.replace(/^group-/, ''), // 'group-clients' → 'clients'
        label: node.group.label,
        roles: node.group.roles,
        items: node.items.map((/** @type {import('./navigation.js').NavItem} */ it) => ({ href: it.href, label: it.label, roles: it.roles }))
      });
    }
  }
  return out;
}
