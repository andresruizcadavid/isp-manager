import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';

const TOKEN_KEY = 'isp_token';
const USER_KEY = 'isp_user';
const EXPIRES_KEY = 'isp_token_expires_at';

function readExpiresAt() {
  if (!browser) return null;
  const raw = localStorage.getItem(EXPIRES_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

// Parse server `expiresIn` ("8h", "30m", "3600s", or number of seconds) to ms.
function expiresInToMs(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value * 1000;
  const m = String(value).trim().match(/^(\d+)\s*([smhd]?)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  const mult = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return n * mult;
}

export const token = writable(browser ? localStorage.getItem(TOKEN_KEY) : null);
export const user = writable(
  browser ? JSON.parse(localStorage.getItem(USER_KEY) || 'null') : null
);
export const expiresAt = writable(readExpiresAt());
export const isAuthenticated = derived(
  [token, expiresAt],
  ([$t, $exp]) => !!$t && (!$exp || $exp > Date.now())
);

token.subscribe(v => {
  if (!browser) return;
  v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY);
});
user.subscribe(v => {
  if (!browser) return;
  v ? localStorage.setItem(USER_KEY, JSON.stringify(v)) : localStorage.removeItem(USER_KEY);
});
expiresAt.subscribe(v => {
  if (!browser) return;
  v ? localStorage.setItem(EXPIRES_KEY, String(v)) : localStorage.removeItem(EXPIRES_KEY);
});

function clearSession() {
  token.set(null);
  user.set(null);
  expiresAt.set(null);
}

export const authStore = {
  token, user, expiresAt, isAuthenticated,

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
    token.set(data.token);
    user.set(data.user);
    const ms = expiresInToMs(data.expiresIn);
    expiresAt.set(ms ? Date.now() + ms : null);
  },

  async logout() {
    const t = get(token);
    if (t) {
      // Best-effort: invalidate session server-side. Don't block UI on errors.
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${t}` }
      }).catch(() => {});
    }
    clearSession();
  },

  isSessionValid() {
    const t = get(token);
    if (!t) return false;
    const exp = get(expiresAt);
    return !exp || exp > Date.now();
  }
};
