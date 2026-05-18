// Singleton socket.io server. Attached in server.js to the same HTTP server
// that Express listens on, so it shares the port (3001). The network monitor
// emits "device:update" and "device:event" — the frontend subscribes via
// socket.io-client to keep the map and history live without polling.
import { Server } from 'socket.io';

let io = null;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: ['http://localhost:5173', 'http://localhost:5174'],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  io.on('connection', (socket) => {
    console.log(`[socket] client connected: ${socket.id}`);
    socket.on('disconnect', () => {
      console.log(`[socket] client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO() {
  return io;
}

/** Safe emit — no-op if socket.io was never initialized (e.g. during tests). */
export function emit(event, payload) {
  if (!io) return;
  io.emit(event, payload);
}
