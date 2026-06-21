<script>
  import { onMount } from 'svelte';
  import { telegramApi } from '$lib/api/network.api.js';
  import { toastStore as toasts } from '$lib/stores/toast.store.js';
  import { ArrowLeft, Send, Save, Bot, Activity } from 'lucide-svelte';

  let form = {
    botToken: '',
    chatId: '',
    isActive: true,
    alertOnDown: true,
    alertOnRecovery: true,
    probeIntervalSec: 30,
    probeTimeoutSec: 5,
    probeDownCount: 2
  };
  let lastTestedAt = null;
  let lastTestResult = null;
  let loading = true;
  let saving = false;
  let testing = false;

  // Selector options (style: MikroTik The Dude — Probe Interval / Timeout / Down Count).
  const intervalOptions = [
    { value: 5,   label: '5 segundos'  },
    { value: 10,  label: '10 segundos' },
    { value: 15,  label: '15 segundos' },
    { value: 30,  label: '30 segundos' },
    { value: 60,  label: '1 minuto'    },
    { value: 120, label: '2 minutos'   },
    { value: 300, label: '5 minutos'   }
  ];
  const timeoutOptions = [
    { value: 1,  label: '1 segundo'   },
    { value: 2,  label: '2 segundos'  },
    { value: 5,  label: '5 segundos'  },
    { value: 10, label: '10 segundos' },
    { value: 15, label: '15 segundos' },
    { value: 30, label: '30 segundos' }
  ];
  const downCountOptions = [
    { value: 1,  label: '1 intento'   },
    { value: 2,  label: '2 intentos'  },
    { value: 3,  label: '3 intentos'  },
    { value: 4,  label: '4 intentos'  },
    { value: 5,  label: '5 intentos'  },
    { value: 8,  label: '8 intentos'  },
    { value: 10, label: '10 intentos' }
  ];

  onMount(async () => {
    try {
      const cfg = await telegramApi.get();
      if (cfg) {
        form = {
          botToken: cfg.botToken,
          chatId: cfg.chatId,
          isActive: cfg.isActive,
          alertOnDown: cfg.alertOnDown,
          alertOnRecovery: cfg.alertOnRecovery,
          probeIntervalSec: cfg.probeIntervalSec ?? 30,
          probeTimeoutSec: cfg.probeTimeoutSec ?? 5,
          probeDownCount: cfg.probeDownCount ?? 2
        };
        lastTestedAt = cfg.lastTestedAt;
        lastTestResult = cfg.lastTestResult;
      }
    } catch (/** @type {any} */ e) {
      toasts.error(e.message);
    } finally {
      loading = false;
    }
  });

  async function save() {
    saving = true;
    try {
      await telegramApi.save({
        ...form,
        probeIntervalSec: Number(form.probeIntervalSec),
        probeTimeoutSec: Number(form.probeTimeoutSec),
        probeDownCount: Number(form.probeDownCount)
      });
      toasts.success('Configuración guardada');
    } catch (/** @type {any} */ e) {
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
    } catch (/** @type {any} */ e) {
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
    <form on:submit|preventDefault={save}>
      <div class="grid">
        <!-- Block 1: Credenciales del bot -->
        <div class="card">
          <h2>Credenciales del bot</h2>
          <p class="hint">
            Crea un bot con <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> y
            pega el token aquí. Para obtener el <code>chat_id</code> de un grupo, agrega el bot al grupo y consulta
            <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code>.
          </p>

          <div class="fields">
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
          </div>
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

      <!-- Block 2: Configuración de sondeo (polling engine) -->
      <div class="card polling">
        <div class="card-head">
          <div class="card-head-icon"><Activity size={18} /></div>
          <div>
            <h2>Configuración de sondeo</h2>
            <p class="hint">
              Define cuándo el sistema considera que un dispositivo está caído antes de
              enviar la alerta a Telegram. Mismos parámetros que MikroTik The Dude
              (Probe Interval, Probe Timeout, Probe Down Count).
            </p>
          </div>
        </div>

        <div class="probe-grid">
          <label>
            <span>Intervalo de sondeo</span>
            <select bind:value={form.probeIntervalSec}>
              {#each intervalOptions as opt (opt.value)}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
            <small>Cada cuánto tiempo se hace ping a cada dispositivo.</small>
          </label>

          <label>
            <span>Tiempo de espera</span>
            <select bind:value={form.probeTimeoutSec}>
              {#each timeoutOptions as opt (opt.value)}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
            <small>Tiempo máximo para esperar respuesta del ping.</small>
          </label>

          <label>
            <span>Intentos antes de alertar</span>
            <select bind:value={form.probeDownCount}>
              {#each downCountOptions as opt (opt.value)}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
            <small>Fallos consecutivos para considerar el dispositivo caído.</small>
          </label>
        </div>

        <div class="probe-summary">
          Con esta configuración el dispositivo se reporta como caído tras
          <b>{form.probeDownCount}</b> fallos consecutivos
          (~{form.probeDownCount * form.probeIntervalSec}s de silencio) y la alerta a Telegram se envía una sola vez por caída.
        </div>
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

  .fields { display: flex; flex-direction: column; gap: 12px; }
  .fields label { display: flex; flex-direction: column; gap: 4px; font-size: 0.78rem; font-weight: 500; color: #334155; }
  .fields input[type="text"], .fields input[type="password"], .fields input:not([type]) {
    padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px;
    font-size: 0.85rem; color: #0f172a; background: white;
  }
  .fields input:focus { outline: none; border-color: #2C4EC7; box-shadow: 0 0 0 3px rgba(44, 78, 199, 0.15); }

  .switches { display: flex; gap: 16px; flex-wrap: wrap; font-size: 0.8rem; padding: 8px 0; }
  .switch { display: inline-flex; align-items: center; gap: 6px; flex-direction: row !important; }

  /* Polling card */
  .polling { margin-top: 1rem; }
  .card-head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 0.5rem; }
  .card-head-icon {
    width: 32px; height: 32px; border-radius: 8px;
    background: #eef2ff; color: #2C4EC7;
    display: grid; place-items: center; flex-shrink: 0;
  }
  .card-head h2 { margin-bottom: 4px; }
  .card-head .hint { margin-bottom: 0; }

  .probe-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1rem;
    margin-top: 0.75rem;
  }
  @media (max-width: 760px) { .probe-grid { grid-template-columns: 1fr; } }

  .probe-grid label {
    display: flex; flex-direction: column; gap: 4px;
    font-size: 0.78rem; font-weight: 500; color: #334155;
  }
  .probe-grid select {
    padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px;
    font-size: 0.85rem; color: #0f172a; background: white;
  }
  .probe-grid select:focus {
    outline: none; border-color: #2C4EC7; box-shadow: 0 0 0 3px rgba(44, 78, 199, 0.15);
  }
  .probe-grid small {
    font-size: 0.72rem; color: #64748b; font-weight: 400; line-height: 1.4;
  }

  .probe-summary {
    margin-top: 1rem;
    padding: 10px 12px;
    border-radius: 8px;
    background: #f8fafc;
    border: 1px dashed #cbd5e1;
    font-size: 0.78rem;
    color: #475569;
    line-height: 1.5;
  }
  .probe-summary b { color: #0f172a; }

  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 1rem; }
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
