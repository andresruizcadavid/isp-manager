import { writable, readable } from 'svelte/store';
import { browser } from '$app/environment';

// Sidebar drawer state (only relevant on < md viewports).
export const sidebarOpen = writable(false);

// Reactive media-query store. Pass a query string ("(min-width: 768px)") —
// the store emits true/false and updates on viewport changes.
/** @param {string} query */
export function mediaQuery(query) {
  return readable(false, (set) => {
    if (!browser) return;
    const mql = window.matchMedia(query);
    set(mql.matches);
    const onChange = (/** @type {MediaQueryListEvent} */ e) => set(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  });
}

// Common breakpoint stores (match tailwind config).
export const isMd = mediaQuery('(min-width: 768px)');   // tablet+
export const isLg = mediaQuery('(min-width: 1024px)');  // desktop+
