import { browser } from '$app/environment';

const BASE = import.meta.env.PUBLIC_API_URL || '';
const TOKEN_KEY = 'isp_token';

function authHeader() {
  if (!browser) return {};
  const t = localStorage.getItem(TOKEN_KEY);
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export const evidenceApi = {
  list: async (clientId) => {
    const res = await fetch(`${BASE}/api/v1/clients/${clientId}/evidence-photos`, {
      headers: authHeader()
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || json.error || 'Error al listar evidencias');
    return json.data ?? [];
  },

  upload: async (clientId, files, meta = {}) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    if (meta.type)        form.append('type', meta.type);
    if (meta.description) form.append('description', meta.description);

    const res = await fetch(`${BASE}/api/v1/clients/${clientId}/evidence-photos`, {
      method: 'POST',
      headers: authHeader(),    // do NOT set Content-Type; browser sets multipart boundary
      body: form
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || json.error || 'Error al subir evidencia');
    return json.data ?? [];
  },

  remove: async (clientId, photoId) => {
    const res = await fetch(`${BASE}/api/v1/clients/${clientId}/evidence-photos/${photoId}`, {
      method: 'DELETE',
      headers: authHeader()
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error?.message || json.error || 'Error al eliminar evidencia');
    return true;
  }
};
