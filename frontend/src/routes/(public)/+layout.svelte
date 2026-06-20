<script>
  // Public layout: rutas accesibles SIN sesión (cliente final con un
  // token público). Sin sidebar, sin header autenticado, sin auth guard.
  // Identidad visual de Internet Online — mismo sistema que los correos
  // transaccionales (navy #16357E / gold #FDB913, lockup "Internet Online",
  // tagline y contacto). Fuente de verdad: backend/src/config/brand.js.
</script>

<div class="min-h-screen flex flex-col bg-[#F5F7FA]">
  <!-- ░░ Brand header (navy gradient + lockup) ░░ -->
  <header class="text-white" style="background:linear-gradient(135deg,#0E255C 0%,#16357E 60%,#1E469B 100%);">
    <div class="max-w-3xl mx-auto px-4 py-5 flex items-center gap-3.5">
      <!-- Power-button "O" icon (igual al logo del sitio) -->
      <svg viewBox="0 0 48 48" class="w-11 h-11 shrink-0" aria-hidden="true">
        <circle cx="24" cy="26" r="13" fill="none" stroke="#FDB913" stroke-width="5.5"
                stroke-linecap="round" stroke-dasharray="64 18" stroke-dashoffset="9"
                transform="rotate(-90 24 26)"/>
        <rect x="21.3" y="11" width="5.4" height="14" rx="2.7" fill="#FDB913"/>
      </svg>
      <div class="leading-none">
        <span class="inline-block bg-white text-[#16357E] font-bold italic text-[11px] px-2.5 py-0.5 rounded-full tracking-wide">Internet</span>
        <div class="text-[26px] font-extrabold text-[#FDB913] -tracking-wide mt-0.5">Online</div>
        <div class="text-[11px] italic text-[#DCE5F7] mt-1">El internet de nuestra gente</div>
      </div>
    </div>
    <!-- gold accent rule -->
    <div class="h-1 bg-[#FDB913]"></div>
  </header>

  <main class="flex-1 w-full max-w-3xl mx-auto px-4 py-6 sm:py-10">
    <slot />
  </main>

  <!-- ░░ Brand footer (navy + contacto real) ░░ -->
  <footer class="text-white" style="background:#16357E;">
    <div class="h-1 bg-[#FDB913]"></div>
    <div class="max-w-3xl mx-auto px-4 py-5 text-center space-y-1.5">
      <p class="text-[13px] font-bold italic text-[#FDB913]">El internet de nuestra gente</p>
      <p class="text-xs text-white/90">
        <a href="mailto:contacto@internetonline.co" class="hover:underline font-medium">contacto@internetonline.co</a>
        <span class="mx-1.5 text-white/40">·</span>
        <a href="tel:+573236329425" class="hover:underline font-medium">+57 323 632 9425</a>
        <span class="mx-1.5 text-white/40">·</span>
        <a href="https://internetonline.co" target="_blank" rel="noopener" class="hover:underline font-medium">www.internetonline.co</a>
      </p>
      <p class="text-[11px] text-[#AEBEDC]">Fibra óptica de alta calidad para tu hogar en San Vicente y La Estrella.</p>
      <p class="text-[11px] text-[#8FA3CB]">Este es un enlace seguro y de un solo uso. Si no esperabas recibirlo, ciérralo.</p>
    </div>
  </footer>
</div>
