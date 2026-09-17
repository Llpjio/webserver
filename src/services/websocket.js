const { WebSocketServer, WebSocket } = require('ws');

let wss = null;

function initWebSocketServer(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    // Send immediate hello / ping
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
        }
      } catch (err) {
        // ignore non-json messages
      }
    });

    ws.send(JSON.stringify({ 
      type: 'CONNECTED', 
      payload: { message: 'Connected to E4ALL Coordinator', connectedClients: wss.clients.size } 
    }));
  });

  // Keepalive ping every 25 seconds for Render's WebSocket timeout prevention
  const interval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 25000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  console.log('[WS] WebSocket server initialized on path /ws');
  return wss;
}

function broadcast(eventType, payload) {
  if (!wss) return;
  const message = JSON.stringify({
    type: eventType,
    payload,
    timestamp: new Date().toISOString()
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (err) {
        console.error('[WS] Broadcast send error:', err.message);
      }
    }
  });
}

function getConnectedCount() {
  return wss ? wss.clients.size : 0;
}

module.exports = {
  initWebSocketServer,
  broadcast,
  getConnectedCount
};
