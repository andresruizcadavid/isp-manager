import { redirect } from '@sveltejs/kit';
import { get } from 'svelte/store';
import { browser } from '$app/environment';
import { authStore, user } from '$lib/stores/auth.store.js';
import { canAccess } from '$lib/permissions.js';

export async function load({ url }) {
  if (!browser) return {};

  let currentUser = get(user);

  if (!currentUser) {
    try {
      const res = await fetch('/api/v1/auth/me');
      if (res.ok) {
        const json = await res.json();
        const u = json.data?.user ?? json.user;
        if (u) {
          authStore.setUser(u);
          currentUser = u;
        }
      }
    } catch {}
  }

  if (!currentUser) {
    authStore.logout();
    throw redirect(307, '/login');
  }

  if (!canAccess(url.pathname, currentUser.role)) {
    throw redirect(307, '/forbidden');
  }

  return {};
}
