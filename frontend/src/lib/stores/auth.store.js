import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';

export const user = writable(null);
export const isAuthenticated = derived(user, $user => !!$user);

export const authStore = {
  user, isAuthenticated,

  setUser(u) {
    user.set(u);
  },

  async login({ email, password }) {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Credenciales incorrectas');
    }
    const { data } = await res.json();
    user.set(data.user);
  },

  async logout() {
    await fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
    user.set(null);
  },

  isSessionValid() {
    return get(user) !== null;
  }
};
