import { api } from './client.js';

const BASE = import.meta.env.PUBLIC_API_URL || '';

export const inventoryApi = {
  // ── Catálogo de productos ──
  listProducts:  ()         => api.get('/inventory/products'),
  createProduct: (data)     => api.post('/inventory/products', data),
  updateProduct: (id, data) => api.put(`/inventory/products/${id}`, data),
  removeProduct: (id)       => api.delete(`/inventory/products/${id}`),

  // Sube la imagen del producto y devuelve { imageUrl }
  uploadImage: async (file) => {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch(`${BASE}/api/v1/inventory/products/upload-image`, {
      method: 'POST', credentials: 'include', headers: { Accept: 'application/json' }, body: form
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || json.error || 'Error al subir imagen');
    return (json.data ?? json).imageUrl;
  },

  // ── Items físicos (con serial) ──
  listItems:   (params)   => {
    const q = new URLSearchParams(params || {}).toString();
    return api.get(`/inventory/items${q ? '?' + q : ''}`);
  },
  createItem:  (data)     => api.post('/inventory/items', data),
  updateItem:  (id, data) => api.put(`/inventory/items/${id}`, data),
  unassign:    (id)       => api.post(`/inventory/items/${id}/unassign`),
  removeItem:  (id)       => api.delete(`/inventory/items/${id}`)
};
