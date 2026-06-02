import { browser } from '$app/environment';

const BASE = import.meta.env.PUBLIC_API_URL || '';

function headers() {
  return { 'Content-Type': 'application/json' };
}

export const evidenceApi = {
  list: async (clientId) => {
    const res = await fetch(`${BASE}/api/v1/clients/${clientId}/evidence-photos`, {
      headers: headers()
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
      headers: { 'Accept': 'application/json' },
      body: form
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || json.error || 'Error al subir evidencia');
    return json.data ?? [];
  },

  remove: async (clientId, photoId) => {
    const res = await fetch(`${BASE}/api/v1/clients/${clientId}/evidence-photos/${photoId}`, {
      method: 'DELETE',
      headers: headers()
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error?.message || json.error || 'Error al eliminar evidencia');
    return true;
  }
};
