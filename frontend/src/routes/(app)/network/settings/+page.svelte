<script>
  import { onMount } from 'svelte';
  import { telegramApi } from '$lib/api/network.api.js';
  import { toastStore as toasts } from '$lib/stores/toast.store.js';
  import { ArrowLeft, Send, Save, Bot } from 'lucide-svelte';

  let form = {
    botToken: '',
    chatId: '',
    isActive: true,
    alertOnDown: true,
    alertOnRecovery: true
  };
  let lastTestedAt = null;
  let lastTestResult = null;
  let loading = true;
  let saving = false;
  let testing = false;

  onMount(async () => {
    try {
      const cfg = await telegramApi.get();
      if (cfg) {
        form = {
          botToken: cfg.botToken,
          chatId: cfg.chatId,
          isActive: cfg.isActive,
          alertOnDown: cfg.alertOnDown,
          alertOnRecovery: cfg.alertOnRecovery
        };
        lastTestedAt = cfg.lastTestedAt;
        lastTestResult = cfg.lastTestResult;
      }
    } catch (e) {
      toasts.error(e.message);
    } finally {
      loading = false;
    }
  });

  async function save() {
    saving = true;
    try {
      await telegramApi.save(form);
      toasts.success('Configuración guardada');
    } catch (e) {
      toasts.error(e.message);
    } finally {
      saving = false;
    }
  }

  async function sendTest() {
    if (!form.botToken || !form.chatId) {
      toasts.error('Llena el token y el chat_id antes de probar.');
      return;
    }
    testing = true;
    try {
      await telegramApi.test(form.botToken, form.chatId);
      toasts.success('Mensaje de prueba enviado ✓');
      lastTestedAt = new Date().toISOString();
      lastTestResult = 'success';
    } catch (e) {
      lastTestedAt = new Date().toISOString();
      lastTestResult = 'error: ' + e.message;
      toasts.error('No se pudo enviar: ' + e.message);
    } finally {
      testing = false;
    }
  }
</script>

<svelte:head>
  <title>Configuración Telegram — ISP Manager</title>
</svelte:head>

<div class="page">
  <a href="/network" class="back"><ArrowLeft size={14} /> Mapa</a>
  <header>
    <div class="head-icon"><Bot size={28} /></div>
    <div>
      <h1>Configuración de Telegram</h1>
      <p class="subtitle">El monitor envía alertas a este chat cuando un dispositivo cae o se recupera.</p>
    </div>
  </header>

  {#if loading}
    <div class="card">Cargando…</div>
  {:else}
    <div class="grid">
      <!-- Form -->
      <div class="card">
        <h2>Credenciales del bot</h2>
        <p class="hint">
          Crea un bot con <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> y
          pega el token aquí. Para obtener el <code>chat_id</code> de un grupo, agrega el bot al grupo y consulta
          <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code>.
        </p>

        <form on:submit|preventDefault={save} class="form">
          <label>
            <span>Bot token</span>
            <input type="password" bind:value={form.botToken}
                   placeholder="123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" required />
          </label>
          <label>
            <span>Chat ID</span>
            <input bind:value={form.chatId} placeholder="-1001234567890 o @mi_canal" required />
          </label>

          <div class="switches">
            <label class="switch">
              <input type="checkbox" bind:checked={form.isActive} />
              <span>Activo</span>
            </label>
            <label class="switch">
              <input type="checkbox" bind:checked={form.alertOnDown} />
              <span>Alertar al caer</span>
            </label>
            <label class="switch">
              <input type="checkbox" bind:checked={form.alertOnRecovery} />
              <span>Alertar al recuperarse</span>
            </label>
          </div>

          <div class="actions">
            <button type="button" class="btn-ghost" on:click={sendTest} disabled={testing}>
              <Send size={14} /> {testing ? 'Enviando…' : 'Enviar prueba'}
            </button>
            <button type="submit" class="btn-primary" disabled={saving}>
              <Save size={14} /> {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>

      <!-- Status card -->
      <div class="card">
        <h2>Estado</h2>
        <dl>
          <div>
            <dt>Estado</dt>
            <dd class={form.isActive ? 'ok' : 'off'}>{form.isActive ? 'Activo' : 'Inactivo'}</dd>
          </div>
          <div>
            <dt>Última prueba</dt>
            <dd>{lastTestedAt ? new Date(lastTestedAt).toLocaleString() : 'Nunca'}</dd>
          </div>
          <div>
            <dt>Resultado</dt>
            <dd class={lastTestResult === 'success' ? 'ok' : lastTestResult ? 'off' : ''}>
              {lastTestResult ?? '—'}
            </dd>
          </div>
        </dl>
        <div class="preview">
          <h3>Vista previa de alerta</h3>
          <pre>🔴 ALERTA — Dispositivo caído
Nombre: Torre-Centro
IP: 192.168.10.5
Zona: La Estrella
Hora: 17/05/2026 23:15</pre>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .page { padding: 1.5rem; max-width: 1100px; margin: 0 auto; }
  .back { display: inline-flex; align-items: center; gap: 4px; font-size: 0.8rem; color: #64748b; text-decoration: none; }
  .back:hover { color: #0f172a; }
  header { display: flex; gap: 14px; align-items: center; margin: 12px 0 1.5rem; }
  .head-icon { width: 52px; height: 52px; background: #2C4EC7; color: white; display: grid; place-items: center; border-radius: 12px; }
  h1 { font-size: 1.5rem; font-weight: 700; color: #0f172a; }
  .subtitle { font-size: 0.85rem; color: #64748b; }

  .grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 1rem; }
  @media (max-width: 880px) { .grid { grid-template-columns: 1fr; } }

  .card { background: white; padding: 1.25rem; border-radius: 12px; border: 1px solid #e2e8f0; }
  .card h2 { font-size: 1rem; font-weight: 600; color: #0f172a; margin-bottom: 0.5rem; }
  .hint { font-size: 0.78rem; color: #64748b; margin-bottom: 1rem; line-height: 1.5; }
  .hint code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 0.75rem; }
  .hint a { color: #2C4EC7; }

  .form { display: flex; flex-direction: column; gap: 12px; }
  .form label { display: flex; flex-direction: column; gap: 4px; font-size: 0.78rem; font-weight: 500; color: #334155; }
  .form input[type="text"], .form input[type="password"], .form input:not([type]) {
    padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px;
    font-size: 0.85rem; color: #0f172a; background: white;
  }
  .form input:focus { outline: none; border-color: #2C4EC7; box-shadow: 0 0 0 3px rgba(44, 78, 199, 0.15); }

  .switches { display: flex; gap: 16px; flex-wrap: wrap; font-size: 0.8rem; padding: 8px 0; }
  .switch { display: inline-flex; align-items: center; gap: 6px; flex-direction: row !important; }

  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  .btn-ghost, .btn-primary {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 14px; border-radius: 8px; font-size: 0.8rem; font-weight: 500;
    border: 1px solid #e2e8f0; background: white; color: #334155; cursor: pointer;
  }
  .btn-primary { background: #2C4EC7; color: white; border-color: #2C4EC7; }
  .btn-primary:hover { background: #233dab; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }

  dl > div { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
  dl > div:last-child { border: none; }
  dt { font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
  dd { font-size: 0.85rem; color: #0f172a; }
  dd.ok { color: #15803d; font-weight: 600; }
  dd.off { color: #b91c1c; font-weight: 600; }

  .preview { margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed #cbd5e1; }
  .preview h3 { font-size: 0.78rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
  pre {
    background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px;
    font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.78rem; white-space: pre-wrap;
  }
</style>
