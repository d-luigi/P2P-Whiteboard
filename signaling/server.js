'use strict';
/**
 * Signalling server for the P2P whiteboard.
 *
 * WebRTC peers cannot find each other on their own. This server is the "phone book": a browser
 * subscribes to a topic (the board's room name) and publishes small messages (connection offers
 * and answers) that are relayed to everyone else subscribed to the same topic. After that the
 * browsers talk directly to each other. This server never sees drawing data, and the room
 * name is a hash of the board's secret ID (see frontend/src/sync.ts).
 *
 * Speaks the protocol of the `y-webrtc` client:
 *   {type:'subscribe',   topics:[...]}
 *   {type:'unsubscribe', topics:[...]}
 *   {type:'publish',     topic, ...data}   -> relayed to every subscriber, plus `clients: <count>`
 *   {type:'ping'}                          -> {type:'pong'}
 *
 * Configuration (environment variables):
 *   PORT             port to listen on (default 4444; hosts like Render set it for you)
 *   ALLOWED_ORIGINS  comma-separated list of website origins allowed to connect, e.g.
 *                    https://my-board.vercel.app. A "*" matches anything within one part,
 *                    e.g. https://*.vercel.app. Empty = accept any origin (fine for local use).
 */
const http = require('node:http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 4444;
const MAX_PAYLOAD = 256 * 1024; // bytes per message; offers/answers are a few KB
const MAX_TOPICS_PER_CONN = 32;
const MAX_TOPIC_LENGTH = 256;
const HEARTBEAT_MS = 30_000;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX_MESSAGES = 300; // per connection per window; real traffic is far lower

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((pattern) => new RegExp(`^${pattern.split('*').map(escapeRe).join('[^/]*')}$`, 'i'));

const originAllowed = (origin) =>
  allowedOrigins.length === 0 || (!!origin && allowedOrigins.some((re) => re.test(origin)));

/** topic name -> set of connections subscribed to it */
const topics = new Map();

function send(conn, message) {
  if (conn.readyState !== conn.OPEN) return;
  try {
    conn.send(JSON.stringify(message));
  } catch {
    conn.close();
  }
}

const server = http.createServer((req, res) => {
  // Health check for the hosting platform. Reveals nothing about boards.
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('p2pwb signalling server: ok\n');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

server.on('upgrade', (req, socket, head) => {
  if (!originAllowed(req.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (conn) => {
  const subscribed = new Set();
  let alive = true;
  let windowStart = Date.now();
  let windowCount = 0;

  const heartbeat = setInterval(() => {
    if (!alive) return conn.terminate(); // missed a whole interval: dead connection
    alive = false;
    try {
      conn.ping();
    } catch {
      conn.terminate();
    }
  }, HEARTBEAT_MS);
  conn.on('pong', () => {
    alive = true;
  });
  conn.on('error', () => conn.terminate());

  conn.on('close', () => {
    clearInterval(heartbeat);
    for (const name of subscribed) {
      const subs = topics.get(name);
      if (!subs) continue;
      subs.delete(conn);
      if (subs.size === 0) topics.delete(name);
    }
    subscribed.clear();
  });

  conn.on('message', (data) => {
    alive = true;
    const now = Date.now();
    if (now - windowStart > RATE_WINDOW_MS) {
      windowStart = now;
      windowCount = 0;
    }
    if (++windowCount > RATE_MAX_MESSAGES) return conn.close(1008, 'rate limit');

    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return; // not JSON: ignore it, don't crash
    }
    if (!message || typeof message !== 'object') return;

    switch (message.type) {
      case 'subscribe':
        for (const name of Array.isArray(message.topics) ? message.topics : []) {
          if (typeof name !== 'string' || name.length === 0 || name.length > MAX_TOPIC_LENGTH) continue;
          if (!subscribed.has(name) && subscribed.size >= MAX_TOPICS_PER_CONN) break;
          let subs = topics.get(name);
          if (!subs) topics.set(name, (subs = new Set()));
          subs.add(conn);
          subscribed.add(name);
        }
        break;
      case 'unsubscribe':
        for (const name of Array.isArray(message.topics) ? message.topics : []) {
          if (typeof name !== 'string') continue;
          const subs = topics.get(name);
          if (subs) {
            subs.delete(conn);
            if (subs.size === 0) topics.delete(name);
          }
          subscribed.delete(name);
        }
        break;
      case 'publish': {
        // Only relay into a topic this connection has itself joined.
        if (typeof message.topic !== 'string' || !subscribed.has(message.topic)) break;
        const receivers = topics.get(message.topic);
        if (!receivers) break;
        message.clients = receivers.size;
        for (const receiver of receivers) send(receiver, message);
        break;
      }
      case 'ping':
        send(conn, { type: 'pong' });
        break;
    }
  });
});

server.listen(PORT, () => {
  const where = allowedOrigins.length ? `only for ${process.env.ALLOWED_ORIGINS}` : 'for any origin';
  console.log(`Signalling server listening on port ${PORT}, accepting connections ${where}.`);
});

function shutdown() {
  wss.clients.forEach((c) => c.close(1001, 'server restarting'));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
