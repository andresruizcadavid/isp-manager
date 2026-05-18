import { browser } from '$app/environment';
import { goto } from '$app/navigation';

const BASE = import.meta.env.PUBLIC_API_URL || '';

async function request(method, path, body = null) {
  const token = browser ? localStorage.getItem('isp_token') : null;
  
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });
  
  if (res.status === 401) {
    if (browser) {
      localStorage.removeItem('isp_token');
      localStorage.removeItem('isp_user');
      localStorage.removeItem('isp_token_expires_at');
      goto('/login');
    }
    throw new Error('Sesión expirada');
  }
  
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || data.error || 'Error del servidor');
  }
  return data.data ?? data;
}

export const api = {
  get:    (path)         => request('GET',    path),
  post:   (path, body)   => request('POST',   path, body),
  put:    (path, body)   => request('PUT',    path, body),
  delete: (path)         => request('DELETE', path),
  patch:  (path, body)   => request('PATCH',  path, body),
};

// Raw variant: returns the full envelope { data, meta, ... } without unwrapping.
export async function getRaw(path) {
  const token = browser ? localStorage.getItem('isp_token') : null;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api/v1${path}`, { headers });
  if (res.status === 401) {
    if (browser) {
      localStorage.removeItem('isp_token');
      localStorage.removeItem('isp_user');
      localStorage.removeItem('isp_token_expires_at');
      goto('/login');
    }
    throw new Error('Sesión expirada');
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || json.error || 'Error del servidor');
  return json;
}
