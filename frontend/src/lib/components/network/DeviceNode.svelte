<script>
  import { Handle, Position } from '@xyflow/svelte';
  import {
    Router, Antenna, Network, Wifi, Server, HardDrive,
    Circle
  } from 'lucide-svelte';

  export let data;

  const ICONS = {
    ROUTER:  Router,
    ANTENNA: Antenna,
    SWITCH:  Network,
    ONT:     Wifi,
    SERVER:  Server,
    OTHER:   HardDrive
  };
  // Short labels shown as a chip in the upper-right of each card.
  const TYPE_LABELS = {
    ROUTER:  'Router',
    ANTENNA: 'AP',
    SWITCH:  'SW',
    ONT:     'ONT',
    SERVER:  'SRV',
    OTHER:   '·'
  };

  $: icon = ICONS[data.type] || HardDrive;
  $: status = (data.status || 'UNKNOWN').toLowerCase();
  $: typeLabel = TYPE_LABELS[data.type] || '·';
  $: ipMissing = !data.ip || data.ip === '0.0.0.0';
  $: latencyDisplay = data.latency != null && data.status === 'ONLINE'
       ? `${data.latency < 1 ? data.latency.toFixed(2) : Math.round(data.latency)} ms`
       : null;
</script>

<div class="device-card {status}" class:placeholder={ipMissing} title="Doble-clic para editar">
  <Handle type="target" position={Position.Top} class="hd hd-target" />

  <!-- Status indicator dot (top-left, always visible) -->
  <span class="status-dot" aria-hidden="true">
    <Circle size={8} fill="currentColor" strokeWidth={0} />
  </span>

  <!-- Type chip (top-right) -->
  <span class="type-chip">{typeLabel}</span>

  <!-- Icon -->
  <div class="icon">
    <svelte:component this={icon} size={20} strokeWidth={1.75} />
  </div>

  <!-- Meta -->
  <div class="meta">
    <div class="name" title={data.name}>{data.name}</div>
    <div class="row">
      <span class="ip" class:missing={ipMissing}>
        {ipMissing ? 'IP pendiente' : data.ip}
      </span>
      {#if latencyDisplay}
        <span class="latency">{latencyDisplay}</span>
      {/if}
    </div>
  </div>

  <Handle type="source" position={Position.Bottom} class="hd hd-source" />
</div>

<style>
  /* ---------- Card shell ---------- */
  .device-card {
    --c-border: #cbd5e1;
    --c-icon-bg: #f1f5f9;
    --c-icon-fg: #475569;
    --c-dot: #94a3b8;
    --c-glow: rgba(148, 163, 184, 0);

    position: relative;
    width: 180px;
    display: grid;
    grid-template-columns: 38px 1fr;
    align-items: center;
    gap: 10px;
    padding: 10px 12px 10px 10px;
    background: #ffffff;
    border: 1.5px solid var(--c-border);
    border-radius: 12px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.06);
    font-family: 'Inter', system-ui, sans-serif;
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
    cursor: pointer;
  }
  .device-card:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(15, 23, 42, 0.06), 0 8px 20px rgba(15, 23, 42, 0.10);
    border-color: #94a3b8;
  }

  /* ---------- Icon ---------- */
  .icon {
    width: 38px; height: 38px;
    display: grid; place-items: center;
    background: var(--c-icon-bg);
    color: var(--c-icon-fg);
    border-radius: 9px;
    transition: background 0.15s ease, color 0.15s ease;
  }

  /* ---------- Meta ---------- */
  .meta { min-width: 0; }
  .name {
    font-weight: 600;
    font-size: 0.83rem;
    color: #0f172a;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 2px;
  }
  .ip {
    font-size: 0.72rem;
    color: #64748b;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .ip.missing {
    color: #b45309;
    font-style: italic;
  }
  .latency {
    font-size: 0.7rem;
    font-weight: 600;
    color: #15803d;
    margin-left: auto;
    padding: 1px 5px;
    background: #dcfce7;
    border-radius: 4px;
    font-variant-numeric: tabular-nums;
  }

  /* ---------- Status dot (top-left) ---------- */
  .status-dot {
    position: absolute;
    top: -4px;
    left: -4px;
    width: 14px; height: 14px;
    display: grid; place-items: center;
    background: white;
    border-radius: 50%;
    color: var(--c-dot);
    box-shadow: 0 0 0 2px white;
  }

  /* ---------- Type chip (top-right) ---------- */
  .type-chip {
    position: absolute;
    top: -8px;
    right: 10px;
    padding: 2px 7px;
    background: #f8fafc;
    border: 1px solid var(--c-border);
    border-radius: 999px;
    font-size: 0.62rem;
    font-weight: 700;
    color: #475569;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    transition: all 0.15s ease;
  }

  /* ---------- Handles (smaller, less intrusive) ---------- */
  :global(.svelte-flow .device-card .hd) {
    width: 8px !important;
    height: 8px !important;
    background: #fff !important;
    border: 1.5px solid #94a3b8 !important;
    opacity: 0.6;
    transition: opacity 0.15s ease, border-color 0.15s ease;
  }
  .device-card:hover :global(.hd) {
    opacity: 1;
    border-color: #2C4EC7 !important;
  }

  /* ---------- States ---------- */
  .device-card.online {
    --c-border: #16a34a;
    --c-icon-bg: #dcfce7;
    --c-icon-fg: #15803d;
    --c-dot: #16a34a;
  }
  .device-card.offline {
    --c-border: #dc2626;
    --c-icon-bg: #fee2e2;
    --c-icon-fg: #b91c1c;
    --c-dot: #dc2626;
    animation: pulse-red 1.8s ease-in-out infinite;
  }
  .device-card.unstable {
    --c-border: #f59e0b;
    --c-icon-bg: #fef3c7;
    --c-icon-fg: #b45309;
    --c-dot: #f59e0b;
  }
  .device-card.unknown {
    --c-border: #cbd5e1;
    --c-icon-bg: #f1f5f9;
    --c-icon-fg: #94a3b8;
    --c-dot: #cbd5e1;
  }

  /* IP placeholder devices get a striped border to nudge the operator. */
  .device-card.placeholder {
    border-style: dashed;
  }

  @keyframes pulse-red {
    0%, 100% { box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.06), 0 0 0 0 rgba(220, 38, 38, 0.45); }
    50%      { box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.06), 0 0 0 6px rgba(220, 38, 38, 0); }
  }
</style>
