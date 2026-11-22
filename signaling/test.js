'use strict';
/** Starts the server on a spare port and checks the protocol end to end. Run: npm test */
const { spawn } = require('node:child_process');
const http = require('node:http');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

const PORT = 45000 + Math.floor(Math.random() * 1000);
const url = `ws://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: __dirname,
      env: { ...process.env, PORT: String(PORT), ...env },
    });
    child.stdout.on('data', (d) => String(d).includes('listening') && resolve(child));
    child.on('error', reject);
    child.stderr.on('data', (d) => process.stderr.write(d));
  });
}

function client(headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.inbox = [];
    ws.on('message', (d) => ws.inbox.push(JSON.parse(d.toString())));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

const get = (path) =>
  new Promise((resolve) => http.get({ port: PORT, host: '127.0.0.1', path }, (res) => resolve(res.statusCode)));

async function main() {
  let server = await start();
  try {
    assert.equal(await get('/'), 200, 'health check answers');

    const a = await client();
    const b = await client();
    const c = await client();
    a.send(JSON.stringify({ type: 'subscribe', topics: ['room-1'] }));
    b.send(JSON.stringify({ type: 'subscribe', topics: ['room-1'] }));
    c.send(JSON.stringify({ type: 'subscribe', topics: ['room-2'] }));
    await sleep(100);

    a.send(JSON.stringify({ type: 'publish', topic: 'room-1', data: 'hello' }));
    await sleep(100);
    assert.equal(a.inbox.length, 1, 'sender also receives its own publish (y-webrtc expects this)');
    assert.equal(b.inbox.length, 1, 'other subscriber receives it');
    assert.equal(b.inbox[0].data, 'hello');
    assert.equal(b.inbox[0].clients, 2, 'reports how many are in the room');
    assert.equal(c.inbox.length, 0, 'a different room hears nothing');

    // Publishing into a room you have not joined is ignored.
    c.send(JSON.stringify({ type: 'publish', topic: 'room-1', data: 'sneaky' }));
    await sleep(100);
    assert.equal(a.inbox.length, 1, 'cannot publish into a room you did not join');

    // Garbage must not crash the server.
    a.send('this is not json');
    a.send(JSON.stringify({ type: 'subscribe', topics: [123, null, 'x'.repeat(1000)] }));
    a.send(JSON.stringify(null));
    a.send(JSON.stringify({ type: 'ping' }));
    await sleep(100);
    assert.deepEqual(a.inbox.at(-1), { type: 'pong' }, 'still alive after bad input, answers ping');

    // Leaving a room stops delivery.
    b.send(JSON.stringify({ type: 'unsubscribe', topics: ['room-1'] }));
    await sleep(100);
    a.send(JSON.stringify({ type: 'publish', topic: 'room-1', data: 'again' }));
    await sleep(100);
    assert.equal(b.inbox.length, 1, 'unsubscribed client gets nothing more');

    [a, b, c].forEach((w) => w.close());
    console.log('ok   protocol: subscribe, publish, isolation, ping, bad input, unsubscribe');
  } finally {
    server.kill();
  }
  await sleep(200);

  // Origin allow-list
  server = await start({ ALLOWED_ORIGINS: 'https://board.example.com, https://*.vercel.app' });
  try {
    await client({ Origin: 'https://board.example.com' });
    await client({ Origin: 'https://my-board-git-main.vercel.app' });
    await assert.rejects(client({ Origin: 'https://evil.example.org' }), /403/, 'other sites are refused');
    await assert.rejects(client({ Origin: 'https://vercel.app.evil.org' }), /403/, 'look-alike hosts are refused');
    await assert.rejects(client(), /403/, 'no Origin header is refused when a list is configured');
    console.log('ok   ALLOWED_ORIGINS: exact and wildcard accepted, others refused');
  } finally {
    server.kill();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FAIL', err);
    process.exit(1);
  },
);
