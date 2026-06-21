import { error, redirect } from '@sveltejs/kit';
import { api } from '$lib/api/client.js';

/** @type {import('@sveltejs/kit').Load} */
export async function load({ params }) {
  // The literal segment "new" has its own dedicated page for creation.
  // SvelteKit static routes win over dynamic ones, so this is just a
  // defensive guard in case someone links here directly.
  if (params.id === 'new' || !/^\d+$/.test(params.id)) {
    throw redirect(307, '/mikrotik/routers/new');
  }

  try {
    const router = await api.get(`/mikrotik/routers/${params.id}`);
    if (!router?.id) {
      error(404, 'Router no encontrado');
    }
    return { router };
  } catch (e: any) {
    if (e.message?.includes('404') || e.message?.includes('no encontrado')) {
      error(404, 'Router no encontrado');
    }
    error(500, e.message || 'Error al cargar el router');
  }
}