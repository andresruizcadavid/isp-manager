// Telegram alerting for Network Monitor.
//
// Reads the active TelegramConfig row from DB on each send (cheap, infrequent)
// so the operator can update token/chat without restarting the API. When no
// active config exists the send is a no-op, logged once, so the rest of the
// monitor keeps working unchanged.
import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../server.js';

let warnedNoConfig = false;

/** Get the single active config row, or null. */
async function loadActive() {
  return prisma.telegramConfig.findFirst({ where: { isActive: true } });
}

/** Send a raw message. Returns { ok, error? }. */
export async function sendMessage(text, { parseMode = 'HTML' } = {}) {
  const cfg = await loadActive();
  if (!cfg) {
    if (!warnedNoConfig) {
      console.warn('[telegram] no active config — alerts are disabled');
      warnedNoConfig = true;
    }
    return { ok: false, error: 'no_active_config' };
  }
  warnedNoConfig = false;

  try {
    const bot = new TelegramBot(cfg.botToken, { polling: false });
    await bot.sendMessage(cfg.chatId, text, { parse_mode: parseMode });
    return { ok: true };
  } catch (e) {
    const msg = e?.response?.body?.description || e.message;
    console.error('[telegram] send failed:', msg);
    return { ok: false, error: msg };
  }
}

/** Test send used by the settings page. Persists result on the config row. */
export async function sendTest({ botToken, chatId }) {
  try {
    const bot = new TelegramBot(botToken, { polling: false });
    await bot.sendMessage(
      chatId,
      '✅ <b>ISP Manager</b>\nMensaje de prueba — Telegram conectado correctamente.',
      { parse_mode: 'HTML' }
    );
    return { ok: true };
  } catch (e) {
    const msg = e?.response?.body?.description || e.message;
    return { ok: false, error: msg };
  }
}

function fmtTime(d = new Date()) {
  // Local time, dd/MM/yyyy HH:mm — matches the spec format.
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'menos de 1 minuto';
  if (m < 60) return `${m} minuto${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `${h}h ${rest}m`;
}

/** Alert for a device that just went down. zoneName is optional. */
export async function alertDown(device, zoneName) {
  const lines = [
    '🔴 <b>ALERTA — Dispositivo caído</b>',
    `Nombre: <b>${device.name}</b>`,
    `IP: <code>${device.ip}</code>`
  ];
  if (zoneName) lines.push(`Zona: ${zoneName}`);
  lines.push(`Hora: ${fmtTime()}`);
  return sendMessage(lines.join('\n'));
}

/** Alert for a device that just came back. downSince is a Date or ms timestamp. */
export async function alertRecovery(device, downSince) {
  const downMs = downSince ? (Date.now() - new Date(downSince).getTime()) : 0;
  const lines = [
    '✅ <b>RECUPERADO — Dispositivo activo</b>',
    `Nombre: <b>${device.name}</b>`,
    `IP: <code>${device.ip}</code>`
  ];
  if (downMs > 0) lines.push(`Tiempo caído: ${fmtDuration(downMs)}`);
  lines.push(`Hora: ${fmtTime()}`);
  return sendMessage(lines.join('\n'));
}
