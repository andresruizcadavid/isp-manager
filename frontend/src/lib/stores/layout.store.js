// Layout state: density + focus mode.
//
// The drawer-style sidebar is binary (open/closed) and lives in
// `ui.store.sidebarOpen` so the existing call sites keep working.
// There is no longer any persistent-on-desktop sidebar mode — the
// shell is uniformly "drawer overlay" across all viewports per the
// app-wide layout refactor.
//
// Persists density and focusMode in localStorage so user preference
// survives reloads. `sidebarOpen` does NOT persist on purpose: the
// app should always boot with the drawer closed, maximising the
// workspace immediately on entry.

import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { sidebarOpen } from './ui.store.js';

const LS_KEY = 'isp:layout';

const DEFAULT_STATE = {
  density:   'comfortable',  // 'comfortable' | 'compact'
  focusMode: false
};

function load() {
  if (!browser) return { ...DEFAULT_STATE };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_STATE }; }
}

/** @param {any} state */
function persist(state) {
  if (!browser) return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {}
}

function createLayoutStore() {
  const { subscribe, set, update } = writable(load());

  return {
    subscribe,

    /** @param {string} d */
    setDensity(d) {
      update(s => { const next = { ...s, density: d }; persist(next); applyDensityAttr(d); return next; });
    },
    toggleDensity() {
      update(s => {
        const next = { ...s, density: s.density === 'comfortable' ? 'compact' : 'comfortable' };
        persist(next); applyDensityAttr(next.density);
        return next;
      });
    },

    /** @param {boolean} on */
    setFocus(on) {
      update(s => { const next = { ...s, focusMode: !!on }; persist(next); return next; });
    },
    toggleFocus() {
      update(s => { const next = { ...s, focusMode: !s.focusMode }; persist(next); return next; });
    },

    reset() { set({ ...DEFAULT_STATE }); persist(DEFAULT_STATE); applyDensityAttr(DEFAULT_STATE.density); }
  };
}

/** @param {string} density */
function applyDensityAttr(density) {
  if (!browser) return;
  document.documentElement.setAttribute('data-density', density);
}

export const layout = createLayoutStore();

if (browser) {
  applyDensityAttr(load().density);
}

export const density   = derived(layout, $l => $l.density);
export const focusMode = derived(layout, $l => $l.focusMode);

// Re-export so consumers import from one place.
export { sidebarOpen };
