import { goto } from '$app/navigation';
import { authStore } from '$lib/stores/auth.store.js';

const BASE = import.meta.env.PUBLIC_API_URL || '';

// Safety net: no request should hang forever. The backend caps interactive
// MikroTik calls at ~7s×2 ≈ 15s; we give a bit more headroom and then abort so
// the UI surfaces a clear error instead of an infinite spinner. Heavier writes
// (client create runs the full MikroTik flow) get a longer ceiling.
const DEFAULT_TIMEOUT_MS = 20000;
const WRITE_TIMEOUT_MS   = 45000;

/** @param {string} method */
function timeoutFor(method) {
  return method === 'GET' || method === 'DELETE' ? DEFAULT_TIMEOUT_MS : WRITE_TIMEOUT_MS;
}

// Build a human-readable message from an API error payload. For validation
// errors (zod) the backend returns `error.details: [{field, message}]`; we
// surface those instead of the generic "Error de validación" so the operator
// knows exactly what to fix.
/** @param {any} err */
function errorMessage(err) {
  if (!err) return 'Error del servidor';
  if (typeof err === 'string') return err;
  if (Array.isArray(err.details) && err.details.length) {
    return err.details.map((/** @type {any} */ d) => d.message || d.field).filter(Boolean).join(' · ');
  }
  return err.message || 'Error del servidor';
}

/**
 * @param {string} method
 * @param {string} path
 * @param {any} [body]
 * @returns {Promise<any>}
 */
async function request(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutFor(method));

  let res;
  try {
    res = await fetch(`${BASE}/api/v1${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : null,
      signal: controller.signal
    });
  } catch (/** @type {any} */ e) {
    if (e?.name === 'AbortError') {
      throw new Error('La solicitud tardó demasiado y se canceló. Verifica la conexión con el router e inténtalo de nuevo.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    authStore.logout();
    goto('/login');
    throw new Error('Sesión expirada');
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(errorMessage(data.error));
  }
  return data.data ?? data;
}

export const api = {
  /** @template [T=any] @param {string} path @returns {Promise<T>} */
  get:    (path)         => request('GET',    path),
  /** @template [T=any] @param {string} path @param {any} [body] @returns {Promise<T>} */
  post:   (path, body)   => request('POST',   path, body),
  /** @template [T=any] @param {string} path @param {any} [body] @returns {Promise<T>} */
  put:    (path, body)   => request('PUT',    path, body),
  /** @template [T=any] @param {string} path @returns {Promise<T>} */
  delete: (path)         => request('DELETE', path),
  /** @template [T=any] @param {string} path @param {any} [body] @returns {Promise<T>} */
  patch:  (path, body)   => request('PATCH',  path, body),
};

/** @param {string} path */
export async function getRaw(path) {
  const headers = { 'Content-Type': 'application/json' };
  const res = await fetch(`${BASE}/api/v1${path}`, { headers, credentials: 'include' });
  if (res.status === 401) {
    authStore.logout();
    goto('/login');
    throw new Error('Sesión expirada');
  }
  const json = await res.json();
  if (!res.ok) throw new Error(errorMessage(json.error));
  return json;
}
