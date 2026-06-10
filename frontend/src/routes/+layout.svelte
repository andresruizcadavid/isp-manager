<script>
  import '../app.css';
  import { Toaster } from 'svelte-sonner';
</script>

<slot />
<Toaster richColors closeButton position="top-right" />
