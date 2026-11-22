/**
 * SHA-256 (synchronous, UTF-8 input, hex output).
 *
 * Used to turn the secret board ID into the room name the signalling server sees, so whoever
 * runs that server never learns the ID itself. `crypto.subtle` would do it too, but it is
 * async and missing on plain-http LAN addresses; this works everywhere.
 */
const PRIMES: number[] = [];
for (let n = 2; PRIMES.length < 64; n++) {
  let prime = true;
  for (let d = 2; d * d <= n; d++) {
    if (n % d === 0) {
      prime = false;
      break;
    }
  }
  if (prime) PRIMES.push(n);
}
// First 32 bits of the fractional parts of the cube roots (K) / square roots (H) of the primes.
const frac32 = (x: number) => Math.floor((x - Math.floor(x)) * 4294967296) >>> 0;
const K = PRIMES.map((p) => frac32(Math.cbrt(p)));
const H0 = PRIMES.slice(0, 8).map((p) => frac32(Math.sqrt(p)));

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const len = bytes.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((len * 8) / 4294967296));
  view.setUint32(padded.length - 4, (len * 8) >>> 0);

  const h = Uint32Array.from(H0);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}
