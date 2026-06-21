import { writable, derived, get } from 'svelte/store';

/** @type {import('svelte/store').Writable<any>} */
export const clientUser = writable(null);
export const isClientAuthenticated = derived(clientUser, $u => !!$u);

const BASE = import.meta.env.PUBLIC_API_URL || '';

export const clientAuthStore = {
  clientUser, isClientAuthenticated,

  /** @param {any} u */
  setUser(u) {
    clientUser.set(u);
  },

  /** @param {string} email @param {string} password */
  async login(email, password) {
    const res = await fetch(`${BASE}/api/v1/client-auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Credenciales incorrectas');
    }
    const { data } = await res.json();
    clientUser.set(data.client);
    return data.client;
  },

  async logout() {
    await fetch(`${BASE}/api/v1/client-auth/logout`, { method: 'POST' }).catch(() => {});
    clientUser.set(null);
  },

  async checkSession() {
    try {
      const res = await fetch(`${BASE}/api/v1/client-auth/me`);
      if (res.ok) {
        const { data } = await res.json();
        clientUser.set(data);
        return true;
      }
    } catch {}
    clientUser.set(null);
    return false;
  }
};
