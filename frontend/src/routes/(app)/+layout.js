import { redirect } from '@sveltejs/kit';
import { get } from 'svelte/store';
import { browser } from '$app/environment';
import { authStore, user } from '$lib/stores/auth.store.js';
import { canAccess } from '$lib/permissions.js';

export function load({ url }) {
  if (!browser) return {};

  // 1. Session check
  if (!authStore.isSessionValid()) {
    authStore.logout();
    throw redirect(307, '/login');
  }

  // 2. Role check — never trust the URL alone; backend enforces the same.
  const currentUser = get(user);
  if (!canAccess(url.pathname, currentUser?.role)) {
    // /forbidden is always allowed, so this won't loop.
    throw redirect(307, '/forbidden');
  }

  return {};
}
