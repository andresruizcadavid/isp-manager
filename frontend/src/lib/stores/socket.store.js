// Singleton socket.io-client connection.
//
// `deviceUpdates` and `deviceEvents` are Svelte stores that the Network
// Monitor pages subscribe to — each broadcast from the backend pushes to
// every subscriber, so the map and history stay live without polling.
import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { io } from 'socket.io-client';

// Updates pushed every sweep (status + latency).
/** @type {import('svelte/store').Writable<any>} */
export const deviceUpdates = writable(null);
// Transitions (state change). Carries the same payload as a NetworkEvent row.
/** @type {import('svelte/store').Writable<any>} */
export const deviceEvents  = writable(null);
// Connection state — useful to show "Live" / "Reconnecting" in the UI.
export const socketStatus  = writable('disconnected');

/** @type {import('socket.io-client').Socket | null} */
let socket = null;

function backendOrigin() {
  // The API client uses PUBLIC_API_URL (or same origin proxy). In dev the
  // backend lives on :3001 — we hardcode that here when the API base is empty
  // (= same-origin path-only). In prod the env will point to the public host.
  const base = import.meta.env.PUBLIC_API_URL;
  if (base) return base;
  if (browser && location.port === '5173') return 'http://localhost:3001';
  return location.origin;
}

export function ensureSocket() {
  if (!browser || socket) return socket;
  socket = io(backendOrigin(), {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1500
  });
  socket.on('connect',       () => socketStatus.set('connected'));
  socket.on('disconnect',    () => socketStatus.set('disconnected'));
  socket.on('reconnect_attempt', () => socketStatus.set('reconnecting'));
  socket.on('device:update', (/** @type {any} */ p) => deviceUpdates.set(p));
  socket.on('device:event',  (/** @type {any} */ p) => deviceEvents.set(p));
  return socket;
}

export function getSocket() { return socket; }
