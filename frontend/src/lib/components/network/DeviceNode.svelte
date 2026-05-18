<script>
  import { Handle, Position } from '@xyflow/svelte';
  import { Router, Antenna, Network, Wifi, Server, HardDrive } from 'lucide-svelte';

  export let data;

  const ICONS = {
    ROUTER:  Router,
    ANTENNA: Antenna,
    SWITCH:  Network,
    ONT:     Wifi,
    SERVER:  Server,
    OTHER:   HardDrive
  };

  $: icon = ICONS[data.type] || HardDrive;
  $: statusClass = (data.status || 'UNKNOWN').toLowerCase();
</script>

<div class="device-card {statusClass}">
  <Handle type="target" position={Position.Top} />
  <div class="icon">
    <svelte:component this={icon} size={20} />
  </div>
  <div class="meta">
    <div class="name">{data.name}</div>
    <div class="ip">{data.ip}</div>
    {#if data.latency != null && data.status === 'ONLINE'}
      <div class="latency">{Math.round(data.latency)} ms</div>
    {/if}
  </div>
  <Handle type="source" position={Position.Bottom} />
</div>

<style>
  .device-card {
    min-width: 150px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: #ffffff;
    border: 2px solid #cbd5e1;
    border-radius: 10px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
    font-family: 'Inter', system-ui, sans-serif;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .icon {
    width: 36px; height: 36px;
    display: grid; place-items: center;
    background: #f1f5f9;
    border-radius: 8px;
    color: #475569;
  }
  .name { font-weight: 600; font-size: 0.875rem; color: #0f172a; }
  .ip   { font-size: 0.75rem; color: #64748b; font-variant-numeric: tabular-nums; }
  .latency { font-size: 0.7rem; color: #16a34a; margin-top: 2px; font-weight: 500; }

  .device-card.online   { border-color: #16a34a; }
  .device-card.online :global(.icon)  { background: #dcfce7; color: #15803d; }

  .device-card.offline  { border-color: #dc2626; animation: pulse 1.6s ease-in-out infinite; }
  .device-card.offline :global(.icon) { background: #fee2e2; color: #b91c1c; }

  .device-card.unstable { border-color: #f59e0b; }
  .device-card.unstable :global(.icon) { background: #fef3c7; color: #b45309; }

  .device-card.unknown  { border-color: #cbd5e1; }

  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.5); }
    50%      { box-shadow: 0 0 0 8px rgba(220, 38, 38, 0);   }
  }
</style>
