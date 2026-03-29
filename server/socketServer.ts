// ── Socket.io server — CLVRQuantAI ────────────────────────────────────────────
// Initialised once in index.ts and shared across the application via getIO().
// The Finnhub WebSocket message handler in routes.ts calls getIO().emit()
// on every tick so connected browsers receive market_update events instantly.

import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "http";

let _io: SocketIOServer | null = null;

export function initSocketIO(httpServer: HTTPServer): SocketIOServer {
  _io = new SocketIOServer(httpServer, {
    path: "/socket.io",
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
    // Reuse the existing HTTP server — no extra port needed
    serveClient: false,
  });

  _io.on("connection", (socket) => {
    console.log(`[socket.io] client connected: ${socket.id}`);
    socket.on("disconnect", (reason) => {
      console.log(`[socket.io] client disconnected: ${socket.id} (${reason})`);
    });
  });

  console.log("[socket.io] server attached to HTTP server");
  return _io;
}

export function getIO(): SocketIOServer | null {
  return _io;
}
