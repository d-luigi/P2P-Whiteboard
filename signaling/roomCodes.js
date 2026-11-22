'use strict';
const { randomInt } = require('node:crypto');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TTL = 24 * 60 * 60 * 1000;

function createRoomCodes() {
  const rooms = new Map();
  const byFragment = new Map();
  function prune(now) {
    for (const [code, room] of rooms) {
      if (room.expires <= now) { rooms.delete(code); byFragment.delete(room.fragment); }
    }
  }
  return {
    register(fragment, now = Date.now()) {
      if (typeof fragment !== 'string' || !/^[A-Za-z0-9_-]{4,64}(?:\.pw)?(?:\.view)?$/.test(fragment)) return null;
      prune(now);
      const existing = byFragment.get(fragment);
      if (existing) { rooms.get(existing).expires = now + TTL; return existing; }
      if (rooms.size >= 10000) return null;
      let code;
      do { code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''); } while (rooms.has(code));
      rooms.set(code, { fragment, expires: now + TTL });
      byFragment.set(fragment, code);
      return code;
    },
    resolve(code, now = Date.now()) {
      if (typeof code !== 'string') return null;
      const room = rooms.get(code.toUpperCase());
      if (!room || room.expires <= now) return null;
      return room.fragment;
    },
  };
}
module.exports = { createRoomCodes };
