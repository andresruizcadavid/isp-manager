import { api } from './client.js';

/**
 * @typedef {import('$lib/types').InventoryProduct} InventoryProduct
 * @typedef {import('$lib/types').InventoryItem} InventoryItem
 */

const BASE = import.meta.env.PUBLIC_API_URL || '';

export const inventoryApi = {
  // ── Catálogo de productos ──
  /** @returns {Promise<InventoryProduct[]>} */
  listProducts:  ()         => api.get('/inventory/products'),
  /** @param {any} data @returns {Promise<InventoryProduct>} */
  createProduct: (data)     => api.post('/inventory/products', data),
  /** @param {string} id @param {any} data @returns {Promise<InventoryProduct>} */
  updateProduct: (id, data) => api.put(`/inventory/products/${id}`, data),
  /** @param {string} id */
  removeProduct: (id)       => api.delete(`/inventory/products/${id}`),

  // Sube la imagen del producto y devuelve { imageUrl }
  /** @param {File} file @returns {Promise<string>} */
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
  /** @param {Record<string, any>} [params] @returns {Promise<InventoryItem[]>} */
  listItems:   (params)   => {
    const q = new URLSearchParams(params || {}).toString();
    return api.get(`/inventory/items${q ? '?' + q : ''}`);
  },
  /** @param {any} data @returns {Promise<InventoryItem>} */
  createItem:  (data)     => api.post('/inventory/items', data),
  /** @param {string} id @param {any} data @returns {Promise<InventoryItem>} */
  updateItem:  (id, data) => api.put(`/inventory/items/${id}`, data),
  /** @param {string} id */
  unassign:    (id)       => api.post(`/inventory/items/${id}/unassign`),
  /** @param {string} id */
  removeItem:  (id)       => api.delete(`/inventory/items/${id}`)
};
