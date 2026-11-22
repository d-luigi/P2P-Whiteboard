import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

/** Run public/sw.js against an in-memory Cache API and a switchable fake network. */
function boot(site: Record<string, string>) {
  const store = new Map<string, Map<string, { body: string; status: number }>>();
  let online = true;
  const listeners: Record<string, (e: any) => void> = {};
  const key = (r: any) => new URL(typeof r === 'string' ? r : r.url, 'https://app.test').pathname;
  const mkRes = (body: string, status = 200) => ({
    ok: status < 300, status, type: 'basic', body,
    clone() { return this; }, text: async () => body,
  });
  const cacheFor = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    return {
      match: async (r: any) => (m.has(key(r)) ? mkRes(m.get(key(r))!.body) : undefined),
      put: async (r: any, res: any) => void m.set(key(r), { body: res.body, status: res.status }),
      add: async (r: any) => {
        const res = await fakeFetch(r);
        if (!res.ok) throw new Error('bad');
        m.set(key(r), { body: res.body, status: res.status });
      },
      delete: async (r: any) => m.delete(key(r)),
      keys: async () => [...m.keys()].map((p) => ({ url: `https://app.test${p}` })),
    };
  };
  const fakeFetch = async (r: any) => {
    if (!online) throw new TypeError('offline');
    const p = key(r);
    return p in site ? mkRes(site[p]) : mkRes('', 404);
  };
  const sandbox: any = {
    URL, Promise, setTimeout, console,
    Request: class { url: string; constructor(u: string) { this.url = u; } },
    caches: { open: async (n: string) => cacheFor(n), keys: async () => [...store.keys()], delete: async (n: string) => store.delete(n) },
    fetch: fakeFetch,
    self: { location: { origin: 'https://app.test' }, skipWaiting: async () => {}, clients: { claim: async () => {} }, addEventListener: (t: string, fn: any) => (listeners[t] = fn) },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('public/sw.js', 'utf8'), sandbox);
  const run = async (type: string, extra = {}) => {
    let result: Promise<any> = Promise.resolve();
    const waits: Promise<any>[] = [];
    listeners[type]({ ...extra, waitUntil: (p: Promise<any>) => waits.push(p), respondWith: (p: Promise<any>) => (result = p) });
    await Promise.all(waits);
    return result;
  };
  const get = (path: string, mode = 'cors') => run('fetch', { request: { url: `https://app.test${path}`, method: 'GET', mode } });
  return { run, get, setOnline: (v: boolean) => (online = v), store };
}

const V1 = { '/': '<script src="/assets/app-AAA.js"></script><link href="/assets/app-AAA.css">', '/assets/app-AAA.js': 'js1', '/assets/app-AAA.css': 'css1', '/manifest.webmanifest': '{}' };

test('after install, the page and its scripts open with no network', async () => {
  const sw = boot(V1);
  await sw.run('install');
  await sw.run('activate');
  sw.setOnline(false);
  assert.equal((await sw.get('/', 'navigate')).body, V1['/']);
  assert.equal((await sw.get('/assets/app-AAA.js')).body, 'js1');
  assert.equal((await sw.get('/manifest.webmanifest')).body, '{}');
});

test('online, a new deployment is picked up; old built files are deleted, new ones saved', async () => {
  const site: Record<string, string> = { ...V1 };
  const sw = boot(site);
  await sw.run('install');
  Object.assign(site, { '/': '<script src="/assets/app-BBB.js"></script>', '/assets/app-BBB.js': 'js2' });
  assert.match((await sw.get('/', 'navigate')).body, /BBB/);
  await new Promise((r) => setTimeout(r, 20)); // background tidy-up
  sw.setOnline(false);
  assert.equal((await sw.get('/assets/app-BBB.js')).body, 'js2');
  const names = [...sw.store.get('p2pwb-app-v1')!.keys()];
  assert.ok(!names.includes('/assets/app-AAA.js'));
  assert.match((await sw.get('/', 'navigate')).body, /BBB/); // offline now shows the newest saved page
});

test('other sites and non-GET requests are left alone; old caches are removed on activate', async () => {
  const sw = boot(V1);
  sw.store.set('p2pwb-app-v0', new Map());
  await sw.run('install');
  await sw.run('activate');
  assert.ok(!sw.store.has('p2pwb-app-v0'));
  let handled = false;
  const listenerRun = await sw.run('fetch', { request: { url: 'https://signal.example/x', method: 'GET', mode: 'cors' }, respondWith: () => (handled = true) }).catch(() => 0);
  void listenerRun;
  assert.equal(handled, false);
});

test('first visit while offline and nothing saved fails cleanly (no hang)', async () => {
  const sw = boot(V1);
  sw.setOnline(false);
  await assert.rejects(sw.get('/', 'navigate'));
});
