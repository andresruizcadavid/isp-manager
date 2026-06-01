<script>
  // Public layout: rutas accesibles SIN sesión (cliente final con un
  // token público). Sin sidebar, sin header autenticado, sin auth guard.
  // Marca visual mínima para que el cliente identifique el proveedor.
  import { Wifi } from 'lucide-svelte';
</script>

<div class="min-h-screen flex flex-col bg-surface-page">
  <!-- Branded header -->
  <header class="bg-brand-800 text-white">
    <div class="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
      <div class="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
        <Wifi size={18} />
      </div>
      <div>
        <div class="text-sm font-semibold leading-tight">ISP Manager</div>
        <div class="text-xs text-brand-100">Portal del cliente</div>
      </div>
    </div>
  </header>

  <main class="flex-1 w-full max-w-3xl mx-auto px-4 py-6 sm:py-10">
    <slot />
  </main>

  <footer class="border-t border-slate-200 bg-white">
    <div class="max-w-3xl mx-auto px-4 py-4 text-center text-xs text-text-muted">
      Este es un enlace seguro y de un solo uso. Si no esperabas recibirlo, ciérralo.
    </div>
  </footer>
</div>
